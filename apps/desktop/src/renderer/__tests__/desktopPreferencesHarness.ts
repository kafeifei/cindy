import { vi } from 'vitest';
import { connectHostDesktopPreferences } from '../state/hostDesktopPreferences';
import { desktopPreferenceDefaults, type DesktopPreferences, type DesktopPreferencesRendererApi, type DesktopPreferencesSnapshot, type DesktopPreferencesUpdate } from '../../shared/desktopPreferences';
/** Renderer 测试的内存 Host 边界：不访问 Electron、授权、Skills 或真实 profile。 */
export function desktopPreferencesHarness(initial: Partial<DesktopPreferences> | null = {}) {
  let overrides = initial;
  let revision = 0;
  const listeners = new Set<(stamp: string) => void>();
  const snapshot = (): DesktopPreferencesSnapshot => overrides === null
    ? { status: 'migrationPending', profileStamp: 'profile-test', revision: String(revision) }
    : { status: 'ready', profileStamp: 'profile-test', revision: String(revision), value: { ...desktopPreferenceDefaults(), ...structuredClone(overrides) }, defaults: desktopPreferenceDefaults(),
      customizedKeys: Object.keys(overrides) as Array<keyof DesktopPreferences>, isCustomized: Object.keys(overrides).length > 0 };
  const publish = () => listeners.forEach(fn => fn('profile-test'));
  const api: DesktopPreferencesRendererApi = {
    get: vi.fn(async () => snapshot()), getSync: vi.fn(snapshot),
    update: vi.fn(async (request: DesktopPreferencesUpdate) => {
      if (request.profileStamp !== 'profile-test' || request.expectedRevision !== String(revision)) throw new Error('CONFLICT');
      if (request.importOnly && overrides !== null) return snapshot();
      overrides = { ...overrides };
      for (const key of request.clear ?? []) delete overrides[key];
      Object.assign(overrides, request.set);
      revision++; publish();
      return snapshot();
    }),
    onChanged: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  return { api, snapshot, publish, external: (patch: Partial<DesktopPreferences>) => { overrides = { ...overrides, ...patch }; revision++; publish(); } };
}
export function installDesktopPreferencesHarness(initial: Partial<DesktopPreferences> | null = null) {
  const host = desktopPreferencesHarness(initial);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { ...window.electronAPI, desktopPreferences: host.api } });
  return host;
}
export async function settleDesktopPreferences(): Promise<void> {
  connectHostDesktopPreferences();
  for (let n = 0; n < 20; n++) await Promise.resolve();
}
