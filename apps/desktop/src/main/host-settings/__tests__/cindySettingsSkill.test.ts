import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileSettingsSkill, settingsSkillPaths, isOwnedSettingsSkill, type SettingsSkillLayout } from '../settings-skill-files.js';
import content from '../skills/cindy-settings/SKILL.md?raw';

const host = vi.hoisted(() => ({ home: '', userData: '', appData: '', pilot: false, packaged: true }));
vi.mock('electron', () => ({ app: {
  getPath: (name: string) => name === 'appData' ? host.appData : host.userData,
  get isPackaged() { return host.packaged; },
} }));
vi.mock('../../cloudPilotDistribution.js', () => ({ cindyManagedHomeDir: () => host.home, isCloudPilotDistribution: () => host.pilot }));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
vi.mock('../../logger', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
import { hostSettingsSkillLayout, prepareHostSettingsSkill, prepareHostSettingsSkillDiscovery } from '../cindy-settings-skill.js';
import { inspectLocalSkillTarget } from '../../skillhub/localSkillTarget.js';
import { prepareSharedGlobalSkillLinks } from '../../maker-host/shared-global-skills.js';
import { prepareCodexGlobalSkillsLinks } from '../../maker-host/codex-global-skills.js';
import { isCindySkillEnabled, setCindySkillEnabled, readDisabledSkillPaths } from '../../skillhub/activationPreferences.js';

let root: string;
let layout: SettingsSkillLayout;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-settings-skill-'));
  host.home = path.join(root, 'home'); host.userData = path.join(root, 'profile'); host.appData = path.join(root, 'appData');
  host.pilot = false; host.packaged = true;
  fs.mkdirSync(host.home); fs.mkdirSync(host.userData); fs.mkdirSync(host.appData);
  vi.stubEnv('CLAUDE_CONFIG_DIR', ''); vi.stubEnv('XDT_USER_DATA_DIR', '');
  layout = { profileDir: host.userData, homeDir: host.home, claudeConfigDir: path.join(host.home, '.claude') };
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const link = (source: string, target: string) => fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
const install = () => reconcileSettingsSkill(layout, content, 1);

it('materializes only cindy-settings and is byte/inode/mtime-idempotent', () => {
  const unrelated = path.join(host.home, '.agents', 'skills', 'personal');
  fs.mkdirSync(unrelated, { recursive: true }); fs.writeFileSync(path.join(unrelated, 'SKILL.md'), 'untouched');
  const first = install();
  expect(first.status).toBe('ready'); expect(first.changed).toBe(true);
  const paths = settingsSkillPaths(layout);
  const before = fs.statSync(path.join(paths.source, 'SKILL.md'));
  expect(install()).toMatchObject({ status: 'ready', changed: false, source: paths.source });
  expect(fs.statSync(path.join(paths.source, 'SKILL.md')).mtimeMs).toBe(before.mtimeMs);
  expect(fs.statSync(paths.source).isDirectory()).toBe(true);
  for (const entry of paths.entries) expect(fs.realpathSync(entry)).toBe(fs.realpathSync(paths.source));
  expect(fs.readFileSync(path.join(unrelated, 'SKILL.md'), 'utf8')).toBe('untouched');
  expect(fs.existsSync(path.join(host.home, '.claude', 'skills', 'personal'))).toBe(false);
  expect(fs.existsSync(path.join(host.home, '.codex'))).toBe(false);
});

it('retains ownership through existing shared projection and the Codex root bridge', async () => {
  const installed = await prepareHostSettingsSkill();
  expect(installed.status).toBe('ready');
  const codexHome = path.join(host.userData, 'codex-home');
  await prepareSharedGlobalSkillLinks({ homeDir: host.home, isCrossAgentSyncEnabled: () => false });
  await prepareCodexGlobalSkillsLinks(codexHome, { homeDir: host.home });
  expect(fs.realpathSync(path.join(codexHome, 'skills', 'xdt-agents', 'cindy-settings'))).toBe(fs.realpathSync(installed.source!));
  expect(await prepareHostSettingsSkill()).toMatchObject({ status: 'ready', changed: false });
});

it('upgrades the stable physical directory and keeps disabled intent across aliases', async () => {
  const first = install();
  const paths = settingsSkillPaths(layout);
  const directoryInode = fs.statSync(paths.source).ino;
  await setCindySkillEnabled(first.entries![1]!, false, () => true, first.entries);
  const result = reconcileSettingsSkill(layout, `${content}\nUpdated static guidance.\n`, 2);
  expect(result).toMatchObject({ changed: true, status: 'ready', source: first.source });
  expect(fs.statSync(paths.source).ino).toBe(directoryInode);
  expect(isCindySkillEnabled(paths.source)).toBe(false);
  expect(readDisabledSkillPaths()).toContain(fs.realpathSync(paths.source));
  expect(isCindySkillEnabled(first.entries![0]!)).toBe(false);
  await setCindySkillEnabled(paths.source, true);
  expect(isCindySkillEnabled(first.entries![1]!)).toBe(true);
  expect(reconcileSettingsSkill(layout, content, 1).status).toBe('conflict');
});

describe.each(['canonical', 'claude'] as const)('%s discovery conflict', kind => {
  it.each(['directory', 'file', 'live-link', 'broken-link', 'unrecorded-own-target'] as const)('preserves %s and never publishes a fallback', async type => {
    const paths = settingsSkillPaths(layout);
    const entry = paths.entries[kind === 'canonical' ? 0 : 1]!;
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    if (type === 'directory') { fs.mkdirSync(entry); fs.writeFileSync(path.join(entry, 'SKILL.md'), 'personal'); }
    if (type === 'file') fs.writeFileSync(entry, 'personal');
    if (type === 'live-link') { const external = path.join(root, 'external'); fs.mkdirSync(external); link(external, entry); }
    if (type === 'broken-link') link(path.join(root, 'absent'), entry);
    if (type === 'unrecorded-own-target') link(paths.source, entry);
    const before = fs.lstatSync(entry);
    expect(install()).toEqual({ status: 'conflict', changed: false });
    expect(fs.lstatSync(entry).ino).toBe(before.ino);
    expect(await prepareHostSettingsSkillDiscovery('pi')).toMatchObject({ paths: [], changed: false });
    expect(await prepareHostSettingsSkillDiscovery('claude-code')).toMatchObject({ paths: [] });
    expect(await prepareHostSettingsSkillDiscovery('codex')).toMatchObject({ paths: [] });
    expect(fs.existsSync(paths.source)).toBe(false);
  });
});

it.each(['content', 'file', 'directory', 'symlink', 'marker-link'] as const)('preserves a replaced own %s rather than upgrading it', kind => {
  install();
  const paths = settingsSkillPaths(layout); const file = path.join(paths.source, 'SKILL.md');
  if (kind === 'content') fs.writeFileSync(file, 'user edits');
  if (kind === 'file') { fs.renameSync(file, path.join(root, 'old-file')); fs.writeFileSync(file, content); }
  if (kind === 'directory' || kind === 'symlink') {
    fs.renameSync(paths.source, path.join(root, 'old-source'));
    if (kind === 'directory') { fs.mkdirSync(paths.source); fs.writeFileSync(file, content); }
    else link(path.join(root, 'old-source'), paths.source);
  }
  if (kind === 'marker-link') {
    const marker = path.join(root, 'external-marker'); fs.renameSync(paths.marker, marker);
    fs.symlinkSync(marker, paths.marker);
  }
  const before = fs.lstatSync(paths.source);
  expect(reconcileSettingsSkill(layout, `${content}\nnew`, 2)).toEqual({ status: 'conflict', changed: false });
  expect(fs.lstatSync(paths.source).ino).toBe(before.ino);
  expect(fs.readFileSync(file, 'utf8')).toBe(kind === 'content' ? 'user edits' : content);
});

it('does not retarget a replaced own discovery link, even to the same physical source', () => {
  install(); const paths = settingsSkillPaths(layout); const entry = paths.entries[0]!;
  fs.renameSync(entry, path.join(root, 'old-link')); link(paths.source, entry);
  expect(install().status).toBe('conflict');
  expect(fs.readlinkSync(entry)).toBe(paths.source);
});

it('preserves foreign parent links and supports an existing Claude whole-root canonical alias', () => {
  const external = path.join(root, 'external'); fs.mkdirSync(external);
  link(external, path.join(host.home, '.agents'));
  expect(install().status).toBe('conflict'); expect(fs.readdirSync(external)).toEqual([]);
  fs.unlinkSync(path.join(host.home, '.agents'));
  const canonical = path.join(host.home, '.agents', 'skills'); fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(layout.claudeConfigDir); link(canonical, path.join(layout.claudeConfigDir, 'skills'));
  expect(install().status).toBe('ready'); expect(install().changed).toBe(false);
});

it('records a repaired link identity and supports switching to a Claude whole-root alias', () => {
  install(); const paths = settingsSkillPaths(layout);
  fs.renameSync(paths.entries[0]!, path.join(root, 'old-canonical-link'));
  expect(install()).toMatchObject({ status: 'ready', changed: true });
  expect(install()).toMatchObject({ status: 'ready', changed: false });
  const claudeRoot = path.dirname(paths.entries[1]!);
  fs.renameSync(claudeRoot, path.join(root, 'old-claude-skills'));
  link(path.dirname(paths.entries[0]!), claudeRoot);
  expect(install().status).toBe('ready');
  expect(install()).toMatchObject({ status: 'ready', changed: false });
});

it.each(['file', 'directory', 'marker'] as const)('revalidates ownership after staging, preserving a concurrent %s replacement', kind => {
  install(); const paths = settingsSkillPaths(layout); const file = path.join(paths.source, 'SKILL.md');
  const write = fs.writeFileSync;
  const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
    write(target, data, options);
    if (typeof target !== 'string' || !path.basename(target).startsWith('.cindy-settings-content-')) return;
    if (kind === 'file') { fs.renameSync(file, path.join(root, 'old-content')); write(file, 'user replacement'); }
    if (kind === 'directory') {
      fs.renameSync(paths.source, path.join(root, 'old-source'));
      fs.mkdirSync(paths.source); write(file, 'user replacement');
    }
    if (kind === 'marker') { fs.renameSync(paths.marker, path.join(root, 'old-marker')); write(paths.marker, '{}'); }
  });
  try {
    expect(reconcileSettingsSkill(layout, `${content}\nRevision two.`, 2).status).toBe('conflict');
    expect(fs.readFileSync(file, 'utf8')).toBe(kind === 'marker' ? content : 'user replacement');
  } finally { spy.mockRestore(); }
});

it.each(['content', 'marker'] as const)('recovers an interrupted upgrade at %s publication using only recorded inode identity', phase => {
  install(); const paths = settingsSkillPaths(layout); const file = path.join(paths.source, 'SKILL.md');
  const next = `${content}\nRevision two.`;
  const rename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (phase === 'content' && to === file || phase === 'marker' && to === paths.marker && fs.readFileSync(file, 'utf8') === next) {
      throw new Error('simulated publication failure');
    }
    return rename(from, to);
  });
  try { expect(() => reconcileSettingsSkill(layout, next, 2)).toThrow('simulated publication failure'); }
  finally { spy.mockRestore(); }
  expect(isOwnedSettingsSkill(paths.source, layout)).toBe(true);
  expect(reconcileSettingsSkill(layout, next, 2).status).toBe('ready');
  expect(fs.readFileSync(file, 'utf8')).toBe(next);
  expect(reconcileSettingsSkill(layout, next, 2)).toMatchObject({ status: 'ready', changed: false });
  expect(fs.readdirSync(paths.root).sort()).toEqual(['.cindy-settings-owner.json', 'cindy-settings']);
});

it('does not recover pending ownership onto an equal-content user replacement', () => {
  install(); const paths = settingsSkillPaths(layout); const file = path.join(paths.source, 'SKILL.md');
  const next = `${content}\nRevision two.`; const rename = fs.renameSync;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === paths.marker && fs.readFileSync(file, 'utf8') === next) throw new Error('simulated failure');
    return rename(from, to);
  });
  try { expect(() => reconcileSettingsSkill(layout, next, 2)).toThrow('simulated failure'); }
  finally { spy.mockRestore(); }
  fs.renameSync(file, path.join(root, 'old-published-file')); fs.writeFileSync(file, next);
  expect(reconcileSettingsSkill(layout, next, 2)).toEqual({ status: 'conflict', changed: false });
  expect(isOwnedSettingsSkill(paths.source, layout)).toBe(false);
});

it('protects only the recorded source from ordinary uninstall, while leaving activation available', async () => {
  const result = await prepareHostSettingsSkill();
  expect(result.status).toBe('ready');
  expect(isOwnedSettingsSkill(result.source!, layout)).toBe(true);
  expect(inspectLocalSkillTarget(result.source!, result.entries!)).toBeNull();
  await setCindySkillEnabled(result.source!, false, () => true, result.entries!);
  expect(isCindySkillEnabled(result.source!)).toBe(false);
  const user = path.join(root, 'project', '.agents', 'skills', 'cindy-settings');
  fs.mkdirSync(user, { recursive: true }); fs.writeFileSync(path.join(user, 'SKILL.md'), 'personal');
  expect(isOwnedSettingsSkill(user, layout)).toBe(false);
  expect(inspectLocalSkillTarget(user, [user])).not.toBeNull();
});

it('resolves profile and managed home after import; isolated Claude uses its actual config without HOME changes', async () => {
  const formalHome = host.home;
  const formalProfile = host.userData;
  host.pilot = true;
  host.userData = path.join(root, 'pilot'); fs.mkdirSync(host.userData);
  host.home = path.join(host.userData, 'managed-home'); fs.mkdirSync(host.home);
  const result = await prepareHostSettingsSkill();
  expect(result.status).toBe('ready');
  expect(result.source).toContain(host.userData);
  expect(fs.readdirSync(formalHome)).toEqual([]); expect(fs.readdirSync(formalProfile)).toEqual([]);
  expect(fs.existsSync(path.join(host.appData, 'Cindy'))).toBe(false);
  expect(fs.existsSync(path.join(host.userData, 'shared-skill-mutation-locks'))).toBe(true);
  host.pilot = false; host.packaged = false;
  vi.stubEnv('XDT_USER_DATA_DIR', host.userData);
  expect(hostSettingsSkillLayout().claudeConfigDir).toBe(path.join(host.userData, 'claude-home'));
  const isolated = await prepareHostSettingsSkillDiscovery('claude-code');
  expect(isolated.paths).toEqual([path.join(host.userData, 'claude-home', 'skills', 'cindy-settings')]);
});

it('static guidance uses live tools and human consent, never stores user values', () => {
  expect(content).toContain('name: cindy-settings');
  for (const name of ['list_tools', 'list_settings', 'get_settings', 'update_settings', 'get_settings_operation', 'expected_revision', 'operation_id']) expect(content).toContain(name);
  for (const concept of ['execution Host', 'control device', 'new-task defaults', 'one domain', 'human confirmation', 'unknown', 'saved', 'application', 'include_user_prompt', 'authorization/input cards']) expect(content).toContain(concept);
  expect(content).toContain('Do not replay');
});
