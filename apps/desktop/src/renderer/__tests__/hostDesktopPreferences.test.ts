// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureLegacyDesktopPreferences, createDesktopPreferencesClient, connectHostDesktopPreferences,
  getDesktopPreference, setDesktopPreference, clearDesktopPreference, __resetDesktopPreferencesForTests,
} from '../state/hostDesktopPreferences';
import { DESKTOP_PREFERENCE_KEYS, DESKTOP_PREFERENCE_STORAGE_KEYS, desktopPreferenceDefaults, type DesktopPreferencesSnapshot } from '../../shared/desktopPreferences';
import { desktopPreferencesHarness } from './desktopPreferencesHarness';
vi.mock('../lib/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
vi.mock('../themes/families', () => ({ findFamilyByThemeId: (id: string) => id === 'default-dark' ? { id: 'default' } : null }));
vi.mock('../features/cc-agent/lib/sidebarInstallVintage', () => ({ getSidebarInstallVintage: () => 'fresh' }));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => { localStorage.clear(); __resetDesktopPreferencesForTests(); });
afterEach(() => __resetDesktopPreferencesForTests());
function bridge(api: unknown) { Object.assign(window, { electronAPI: api ? { desktopPreferences: api } : {} }); }
describe('desktop Renderer migration and receipt cache', () => {
  it('captures 20 groups/25 leaves, preserves explicit defaults and ignores login/owner/dev keys', () => {
    const defaults = desktopPreferenceDefaults();
    for (const key of DESKTOP_PREFERENCE_KEYS) {
      const value = defaults[key];
      localStorage.setItem(DESKTOP_PREFERENCE_STORAGE_KEYS[key], typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    localStorage.setItem('login.firstLaunchLightShown', 'unchanged');
    localStorage.setItem('experimental.forceManagedTools', 'true');
    const before = { ...localStorage };
    const result = captureLegacyDesktopPreferences();
    expect(result).toEqual(defaults);
    expect(Object.keys(result!)).toHaveLength(20);
    expect({ ...localStorage }).toEqual(before);
  });
  it('reads old boolean sidebar and theme/link compatibility without changing old keys', () => {
    localStorage.setItem('sidebar.cardMode', 'true');
    localStorage.setItem('theme.darkId', 'default-dark');
    localStorage.setItem('chat.linkOpenPreference', 'external');
    expect(captureLegacyDesktopPreferences()).toMatchObject({ sidebarPinnedMode: 'card', sidebarMainMode: 'list', themeFamilyId: 'default', webLinkOpenPreference: 'external', localLinkOpenPreference: 'external' });
    expect(localStorage.getItem('chat.linkOpenPreference')).toBe('external');
  });
  it('imports once, marks empty/default inputs initialized, and ignores stale legacy values thereafter', async () => {
    const h = desktopPreferencesHarness(null);
    const client = createDesktopPreferencesClient({ api: h.api, legacy: { theme: 'dark', notificationsEnabled: true } });
    await client.start();
    expect(h.api.update).toHaveBeenCalledOnce();
    expect(client.get('theme')).toBe('dark');
    await client.mutate({ clear: ['theme'] });
    client.stop();
    const next = createDesktopPreferencesClient({ api: h.api, legacy: { theme: 'dark' } });
    await next.start();
    expect(next.get('theme')).toBe('system');
    expect(next.customized('theme')).toBe(false);
    expect(h.api.update).toHaveBeenCalledTimes(2);
    next.stop();
  });
  it('provides theme/locale from synchronous committed Host state before the first render', () => {
    localStorage.setItem('theme', 'light'); localStorage.setItem('language', 'en');
    bridge(desktopPreferencesHarness({ theme: 'dark', locale: 'ja' }).api);
    expect(getDesktopPreference('theme')).toBe('dark'); expect(getDesktopPreference('locale')).toBe('ja');
    // 单纯读取启动状态不写缓存，也不触碰首启标记。
    expect(localStorage.getItem('theme')).toBe('light'); expect(localStorage.getItem('login.firstLaunchLightShown')).toBeNull();
  });
  it('holds legacy theme/locale during a pending migration without flashing defaults', async () => {
    const h = desktopPreferencesHarness(null);
    localStorage.setItem('theme', 'dark'); localStorage.setItem('language', 'ja'); bridge(h.api);
    expect(getDesktopPreference('theme')).toBe('dark');
    connectHostDesktopPreferences();
    expect(getDesktopPreference('locale')).toBe('ja');
    await tick();
    expect(h.snapshot()).toMatchObject({ status: 'ready', value: { theme: 'dark', locale: 'ja' } });
  });
  it('updates caches only on Host success and clear deletes customization instead of setting defaults', async () => {
    const h = desktopPreferencesHarness({ theme: 'dark' }); bridge(h.api); connectHostDesktopPreferences(); await tick();
    vi.mocked(h.api.update).mockRejectedValueOnce(new Error('disk full'));
    expect(await setDesktopPreference('theme', 'light')).toBe(false); await tick();
    expect(getDesktopPreference('theme')).toBe('dark'); expect(localStorage.getItem('theme')).toBe('dark');
    expect(await setDesktopPreference('theme', 'system')).toBe(true);
    expect(h.snapshot()).toMatchObject({ customizedKeys: ['theme'] });
    expect(await clearDesktopPreference('theme')).toBe(true);
    expect(h.snapshot()).toMatchObject({ customizedKeys: [] }); expect(localStorage.getItem('theme')).toBeNull();
  });
  it('does not import without the trusted local API (web/remote renderer) or readable legacy storage', async () => {
    bridge(null); localStorage.setItem('theme', 'dark'); connectHostDesktopPreferences();
    expect(await setDesktopPreference('theme', 'light')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('dark');
    const h = desktopPreferencesHarness(null);
    const client = createDesktopPreferencesClient({ api: h.api, legacy: null }); await client.start();
    expect(h.api.update).not.toHaveBeenCalled(); client.stop();
  });
  it('does not replay a losing import against the winning window revision', async () => {
    const h = desktopPreferencesHarness(null);
    const update = h.api.update;
    vi.mocked(h.api.update).mockImplementationOnce(async () => { h.external({ theme: 'light' }); throw new Error('CONFLICT'); });
    const client = createDesktopPreferencesClient({ api: h.api, legacy: { theme: 'dark' } }); await client.start(); await tick();
    expect(client.get('theme')).toBe('light'); expect(update).toHaveBeenCalledOnce(); client.stop();
  });
  it('synchronizes two windows, drops queued edits after conflict, and accepts later deliberate edits', async () => {
    const h = desktopPreferencesHarness({});
    const a = createDesktopPreferencesClient({ api: h.api, legacy: {} });
    const b = createDesktopPreferencesClient({ api: h.api, legacy: {} });
    await Promise.all([a.start(), b.start()]);
    await a.mutate({ set: { locale: 'ko' } }); await tick(); expect(b.get('locale')).toBe('ko');
    vi.mocked(h.api.update).mockRejectedValueOnce(new Error('CONFLICT'));
    const failed = b.mutate({ set: { theme: 'dark' } });
    const queued = b.mutate({ set: { theme: 'light' } });
    expect(await failed).toBe(false); expect(await queued).toBe(false); await tick();
    expect(b.get('theme')).toBe('system');
    expect(await b.mutate({ set: { theme: 'dark' } })).toBe(true);
    a.stop(); b.stop();
  });
  it('discards late responses from a disconnected renderer or another profile', async () => {
    const h = desktopPreferencesHarness({ theme: 'dark' });
    let finish!: (value: DesktopPreferencesSnapshot) => void;
    vi.mocked(h.api.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const client = createDesktopPreferencesClient({ api: h.api, initial: h.snapshot(), legacy: {} });
    const pending = client.start(); client.stop(); finish(h.snapshot()); await pending;
    expect(h.api.update).not.toHaveBeenCalled();
    vi.mocked(h.api.get).mockResolvedValueOnce({ ...h.snapshot(), profileStamp: 'other-profile' });
    const other = createDesktopPreferencesClient({ api: h.api, initial: h.snapshot(), legacy: { theme: 'light' } }); await other.start();
    expect(await other.mutate({ set: { theme: 'light' } })).toBe(false); other.stop();
  });
});
