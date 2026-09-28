import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('No global profile access in this test'); } } }));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
// 偏好测试禁止准备 Skills，也不得触及授权或真实 profile 发现。
vi.mock('../startup.js', () => { throw new Error('Host Skill preparation forbidden'); });
vi.mock('../../appSessionState.js', () => { throw new Error('Owner/authorization access forbidden'); });
import { createDesktopPreferencesStore } from '../desktop-preferences';
import { desktopPreferenceDefaults, DESKTOP_PREFERENCE_KEYS, normalizeDesktopPreferenceOverrides } from '../../../shared/desktopPreferences';

let root: string;
let stamp: string;
let store: ReturnType<typeof createDesktopPreferencesStore>;
const file = () => path.join(root, 'prefs.json');
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-')); stamp = 'profile-a';
  store = createDesktopPreferencesStore({ filePath: file, profileStamp: () => stamp });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
async function save(set = {}, importOnly = false, clear?: typeof DESKTOP_PREFERENCE_KEYS) {
  const before = store.inspect();
  if (!before.revision) throw new Error('unreadable fixture');
  return store.update({ profileStamp: stamp, expectedRevision: before.revision, set, importOnly, ...(clear ? { clear } : {}) });
}
describe('Host desktop profile preferences', () => {
  it('inspects an unimported headless profile as migrationPending without creating any files', () => {
    expect(store.inspect().status).toBe('migrationPending');
    expect(store.inspect().status).toBe('migrationPending');
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('atomically initializes an empty import without persisting defaults and retains reset tombstone', async () => {
    const first = await save({}, true);
    expect(first.status).toBe('ready');
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ _initialized: true });
    await save({ theme: 'dark' });
    await save({}, false, ['theme']);
    await save({ theme: 'dark' }, true);
    const state = store.inspect();
    expect(state).toMatchObject({ status: 'ready', value: { theme: 'system' }, customizedKeys: [], isCustomized: false });
  });
  it('keeps explicit defaults as overrides and clear deletes only named overrides', async () => {
    await save({ theme: 'system', notificationsEnabled: true }, true);
    expect(store.inspect()).toMatchObject({ customizedKeys: ['theme', 'notificationsEnabled'], isCustomized: true });
    await save({}, false, ['theme']);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ notificationsEnabled: true, _initialized: true });
  });
  it('imports all 20 groups / 25 expanded leaves with shared Island normalization and private local values', async () => {
    const values = { ...desktopPreferenceDefaults(), themeFamilyId: 'private-local-family', agentIslandSoundSettings: {
      enabled: false, sounds: { start: 'gameboy-startup', attention: { type: 'custom', path: '/fixture/sound.wav', name: 'private name' } },
    }, agentIslandDisplayTarget: { mode: 'display', displayId: 42, displayName: 'private monitor' } };
    const state = await save(values, true);
    expect(DESKTOP_PREFERENCE_KEYS).toHaveLength(20);
    expect(Object.keys(desktopPreferenceDefaults().agentIslandSoundSettings.sounds)).toHaveLength(5);
    expect(state).toMatchObject({ status: 'ready', value: {
      themeFamilyId: 'private-local-family', agentIslandSoundSettings: { sounds: {
        start: { type: 'builtin', id: 'startup-chime' }, attention: { type: 'custom', path: '/fixture/sound.wav', name: 'private name' },
      } }, agentIslandDisplayTarget: { displayName: 'private monitor' },
    } });
    const restarted = createDesktopPreferencesStore({ filePath: file, profileStamp: () => stamp });
    expect(restarted.inspect()).toEqual(state);
  });
  it('rejects stale CAS rather than replaying an old window import or overwrite', async () => {
    const stale = store.inspect();
    await save({ locale: 'ja' }, true);
    await expect(store.update({ profileStamp: stamp, expectedRevision: stale.revision!, importOnly: true, set: { locale: 'en' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.inspect()).toMatchObject({ value: { locale: 'ja' } });
  });
  it('fences profile changes while waiting for the file lock', async () => {
    const before = store.inspect();
    const pending = store.update({ profileStamp: stamp, expectedRevision: before.revision!, importOnly: true, set: { locale: 'ja' } });
    stamp = 'profile-b';
    await expect(pending).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    expect(fs.existsSync(file())).toBe(false);
  });
  it('preserves malformed bytes and refuses to overwrite an unreadable source', async () => {
    fs.writeFileSync(file(), '{broken private bytes');
    const before = fs.readFileSync(file());
    expect(store.inspect()).toMatchObject({ status: 'unreadable', revision: null });
    await expect(store.update({ profileStamp: stamp, expectedRevision: 'stale', importOnly: true, set: {} })).rejects.toMatchObject({ code: 'UNREADABLE' });
    expect(fs.readFileSync(file())).toEqual(before);
    fs.writeFileSync(file(), JSON.stringify({ _initialized: true, theme: 'dark' }));
    expect(store.inspect()).toMatchObject({ status: 'ready', value: { theme: 'dark' } });
  });
  it('keeps acknowledged bytes and emits no change after atomic publish failure, then recovers', async () => {
    await save({ theme: 'dark' }, true);
    const before = fs.readFileSync(file());
    const changed = vi.fn();
    const off = store.onChanged(changed);
    const rename = fs.renameSync;
    const failedRename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === file()) throw new Error('fixture publish failure');
      return rename(from, to);
    });
    try {
      await expect(save({ theme: 'light' })).rejects.toThrow('fixture publish failure');
      expect(fs.readFileSync(file())).toEqual(before);
      expect(store.inspect()).toMatchObject({ status: 'ready', value: { theme: 'dark' } });
      expect(changed).not.toHaveBeenCalled();
      expect(fs.readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally { failedRename.mockRestore(); }
    await save({ theme: 'light' });
    expect(changed).toHaveBeenCalledOnce();
    expect(store.inspect()).toMatchObject({ status: 'ready', value: { theme: 'light' } });
    off();
  });
  it('serializes simultaneous first imports and never merges the losing legacy table', async () => {
    const second = createDesktopPreferencesStore({ filePath: file, profileStamp: () => stamp });
    const expectedRevision = store.inspect().revision!;
    const results = await Promise.allSettled([
      store.update({ profileStamp: stamp, expectedRevision, importOnly: true, set: { theme: 'dark' } }),
      second.update({ profileStamp: stamp, expectedRevision, importOnly: true, set: { locale: 'ja' } }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'CONFLICT' } }]);
    const state = store.inspect();
    expect(state.status).toBe('ready');
    if (state.status === 'ready') expect(state.customizedKeys).toHaveLength(1);
  });
  it('rejects owner/login/temporary flags and unknown or invalid field values', () => {
    for (const value of [{ forceManagedTools: true }, { ownerStamp: 'x' }, { 'login.firstLaunchLightShown': true }, { locale: 'xx' }, { notificationsEnabled: 1 }]) {
      expect(() => normalizeDesktopPreferenceOverrides(value)).toThrow();
    }
  });
});
