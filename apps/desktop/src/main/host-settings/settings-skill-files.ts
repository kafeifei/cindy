import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const SETTINGS_SKILL_NAME = 'cindy-settings';

/** The caller supplies profile/native roots at call time, under the single-name mutation lease. */
export interface SettingsSkillLayout {
  profileDir: string;
  homeDir: string;
  claudeConfigDir: string;
}
export interface SettingsSkillResult {
  changed: boolean;
  status: 'ready' | 'conflict' | 'unavailable';
  source?: string;
  entries?: string[];
}
interface Identity { dev: number; ino: number; birthtimeMs: number }
interface OwnedSkill {
  format: 1;
  version: number;
  hash: string;
  directory: Identity;
  file: Identity;
  links: Record<string, { target: string; identity: Identity }>;
  /** Prepared inode is recorded before publication, so an interrupted upgrade is recognizable. */
  pending?: { version: number; hash: string; file: Identity; temporary: string };
}

export function settingsSkillPaths(layout: SettingsSkillLayout) {
  const root = path.join(layout.profileDir, 'host-settings-skills');
  return {
    root,
    source: path.join(root, SETTINGS_SKILL_NAME),
    marker: path.join(root, '.cindy-settings-owner.json'),
    entries: [...new Set([
      path.join(layout.homeDir, '.agents', 'skills', SETTINGS_SKILL_NAME),
      path.join(layout.claudeConfigDir, 'skills', SETTINGS_SKILL_NAME),
    ])],
  };
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const identity = (stat: fs.Stats): Identity => ({ dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs });
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
function statOrNull(file: string): fs.Stats | null {
  try { return fs.lstatSync(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function physicalDir(dir: string): boolean {
  const stat = statOrNull(dir);
  return !!stat?.isDirectory() && !stat.isSymbolicLink();
}
function readOwned(layout: SettingsSkillLayout): OwnedSkill | null {
  const paths = settingsSkillPaths(layout);
  if (!physicalDir(layout.profileDir) || !physicalDir(paths.root) || !physicalDir(paths.source)) return null;
  const marker = statOrNull(paths.marker);
  const file = statOrNull(path.join(paths.source, 'SKILL.md'));
  if (!marker?.isFile() || marker.isSymbolicLink() || marker.size > 64_000 || !file?.isFile() || file.isSymbolicLink() || file.nlink !== 1) return null;
  try {
    const record = JSON.parse(fs.readFileSync(paths.marker, 'utf8')) as OwnedSkill;
    if (record.format !== 1 || !Number.isSafeInteger(record.version) || record.version < 1
      || !record.directory || !record.file || !record.links || typeof record.links !== 'object'
      || !same(record.directory, identity(fs.lstatSync(paths.source))) || file.size > 128_000
      || fs.readdirSync(paths.source).some(name => name !== 'SKILL.md')) return null;
    const actualHash = hash(fs.readFileSync(path.join(paths.source, 'SKILL.md'), 'utf8'));
    const pending = record.pending;
    if (pending && (!Number.isSafeInteger(pending.version) || pending.version <= record.version || !pending.file
      || !/^\.cindy-settings-content-[a-f0-9-]+$/.test(pending.temporary))) return null;
    if (same(record.file, identity(file)) && record.hash === actualHash) return record;
    if (pending && same(pending.file, identity(file)) && pending.hash === actualHash) {
      return { ...record, version: pending.version, file: pending.file, hash: pending.hash };
    }
    return null;
  } catch { return null; }
}

/** Exact source identity, not a name/prefix ban and not plugin ownership. */
export function isOwnedSettingsSkill(source: string, layout: SettingsSkillLayout): boolean {
  if (!readOwned(layout)) return false;
  try {
    let target = fs.realpathSync.native(source);
    if (path.basename(target) === 'SKILL.md') target = path.dirname(target);
    return target === fs.realpathSync.native(settingsSkillPaths(layout).source);
  } catch { return false; }
}

/** Do not walk through foreign parent links. The existing Claude whole-root alias is the sole exception. */
function ensureEntryParent(entry: string, layout: SettingsSkillLayout, create: boolean): boolean {
  const canonicalRoot = path.join(layout.homeDir, '.agents', 'skills');
  const roots = entry === path.join(canonicalRoot, SETTINGS_SKILL_NAME)
    ? [layout.homeDir, path.join(layout.homeDir, '.agents'), canonicalRoot]
    : [layout.claudeConfigDir, path.join(layout.claudeConfigDir, 'skills')];
  for (const root of roots) {
    const stat = statOrNull(root);
    if (!stat) {
      if (create) fs.mkdirSync(root, { mode: 0o700 });
      continue;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) continue;
    if (root === path.join(layout.claudeConfigDir, 'skills') && stat.isSymbolicLink()
      && physicalDir(canonicalRoot) && fs.realpathSync.native(root) === fs.realpathSync.native(canonicalRoot)) continue;
    return false;
  }
  return true;
}
function currentLink(entry: string, source: string, record: OwnedSkill | null): boolean {
  const stat = statOrNull(entry);
  if (!stat) return true;
  // A whole-root Claude alias resolves to the canonical entry itself.
  return stat.isSymbolicLink() && fs.readlinkSync(entry) === source
    && Object.entries(record?.links ?? {}).some(([alias, owned]) => {
      if (!same(owned.identity, identity(stat)) || owned.target !== source) return false;
      try { return alias === entry || fs.realpathSync.native(path.dirname(alias)) === fs.realpathSync.native(path.dirname(entry)); }
      catch { return false; }
    });
}
function replaceFile(file: string, text: string, mayPublish: () => boolean): boolean {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}`);
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    if (!mayPublish()) return false;
    fs.renameSync(temporary, file);
    return true;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

/** Revalidate immediately before each publication; never use a stale source/marker snapshot. */
function saveRecord(layout: SettingsSkillLayout, record: OwnedSkill): boolean {
  const paths = settingsSkillPaths(layout);
  const previous = readOwned(layout);
  if (!previous || !same(previous.directory, record.directory) || !same(previous.file, record.file)
    || previous.hash !== record.hash || previous.version !== record.version) return false;
  const marker = identity(fs.lstatSync(paths.marker));
  const markerText = fs.readFileSync(paths.marker, 'utf8');
  return replaceFile(paths.marker, JSON.stringify(record), () => {
    const current = readOwned(layout);
    return !!current && same(previous.directory, current.directory) && same(previous.file, current.file)
      && previous.hash === current.hash && previous.version === current.version
      && same(marker, identity(fs.lstatSync(paths.marker))) && fs.readFileSync(paths.marker, 'utf8') === markerText;
  });
}

/** Reconcile precisely two single entries. Never scan/sync other Skills or adopt an existing entity. */
export function reconcileSettingsSkill(layout: SettingsSkillLayout, content: string, version: number): SettingsSkillResult {
  const paths = settingsSkillPaths(layout);
  const conflict: SettingsSkillResult = { changed: false, status: 'conflict' };
  if (!physicalDir(layout.profileDir)) return conflict;
  const rootStat = statOrNull(paths.root);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) return conflict;
  const existingSource = statOrNull(paths.source);
  const existingMarker = statOrNull(paths.marker);
  let record = readOwned(layout);
  if ((existingSource || existingMarker) && !record) return conflict;
  // Read-only preflight: a user entity or even a broken external link wins. No explicit-path fallback.
  for (const entry of paths.entries) {
    if (!ensureEntryParent(entry, layout, false) || !currentLink(entry, paths.source, record)) return conflict;
  }
  if (record && (record.version > version || record.version === version && record.hash !== hash(content))) return conflict;
  let changed = false;
  if (record?.pending) {
    // Only recover the exact prepared inode, never an equal-content user replacement.
    const temporary = path.join(paths.root, record.pending.temporary);
    const staged = statOrNull(temporary);
    if (staged && (!staged.isFile() || staged.isSymbolicLink() || !same(record.pending.file, identity(staged))
      || hash(fs.readFileSync(temporary, 'utf8')) !== record.pending.hash)) return conflict;
    if (staged) fs.unlinkSync(temporary);
    record = { ...record, pending: undefined };
    if (!saveRecord(layout, record)) return conflict;
    changed = true;
  }
  if (!record) {
    fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(paths.source, { mode: 0o700 });
    fs.writeFileSync(path.join(paths.source, 'SKILL.md'), content, { flag: 'wx', mode: 0o600 });
    record = { format: 1, version, hash: hash(content), directory: identity(fs.lstatSync(paths.source)),
      file: identity(fs.lstatSync(path.join(paths.source, 'SKILL.md'))), links: {} };
    // Persist before creating aliases; interrupted installs retain an identifiable source.
    fs.writeFileSync(paths.marker, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    changed = true;
  } else if (record.version < version) {
    const temporary = `.cindy-settings-content-${randomUUID()}`;
    const prepared = path.join(paths.root, temporary);
    fs.writeFileSync(prepared, content, { flag: 'wx', mode: 0o600 });
    const pending = { version, hash: hash(content), file: identity(fs.lstatSync(prepared)), temporary };
    try {
      record = { ...record, pending };
      if (!saveRecord(layout, record)) return { changed, status: 'conflict' };
      const current = readOwned(layout);
      if (!current || !same(current.file, record.file) || !same(current.directory, record.directory)
        || current.hash !== record.hash || JSON.stringify(current.pending) !== JSON.stringify(pending)) return { changed, status: 'conflict' };
      // The source directory stays stable for activation keys. Prepared identity is already recorded.
      fs.renameSync(prepared, path.join(paths.source, 'SKILL.md'));
      record = { ...record, version, hash: pending.hash, file: pending.file, pending: undefined };
      changed = true;
      if (!saveRecord(layout, record)) return { changed, status: 'conflict' };
    } finally {
      const staged = statOrNull(prepared);
      if (staged?.isFile() && same(pending.file, identity(staged))) fs.unlinkSync(prepared);
    }
  }
  for (const entry of paths.entries) {
    if (!ensureEntryParent(entry, layout, true) || !currentLink(entry, paths.source, record)) return { changed, status: 'conflict' };
    if (!statOrNull(entry)) {
      fs.symlinkSync(paths.source, entry, process.platform === 'win32' ? 'junction' : 'dir');
      changed = true;
    }
    const linkIdentity = identity(fs.lstatSync(entry));
    if (!record.links[entry] || !same(record.links[entry]!.identity, linkIdentity)) {
      record.links[entry] = { target: paths.source, identity: linkIdentity };
      if (!saveRecord(layout, record)) return { changed, status: 'conflict' };
    }
  }
  return { changed, status: 'ready', source: paths.source, entries: paths.entries };
}
