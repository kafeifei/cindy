import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>(),
  partition: {}, allowed: true, update: vi.fn(), inspect: vi.fn(() => ({ status: 'migrationPending', profileStamp: 'p', revision: 'r' })),
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, session: { defaultSession: h.partition },
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => h.handlers.set(name, fn), on: (name: string, fn: (...args: any[]) => any) => h.events.set(name, fn) } }));
vi.mock('../../security/trustedAppRenderer.js', () => ({ assertTrustedAppRendererEvent: () => { if (!h.allowed) throw new Error('denied'); }, isTrustedTopLevelCindyRendererEvent: () => h.allowed, isTrustedCindyRendererWindow: () => true }));
vi.mock('../../utils/ipcValidate.js', () => ({ throwIpcError: (code: string) => { throw new Error(code); } }));
vi.mock('../desktop-preferences.js', () => ({ inspectDesktopPreferences: h.inspect, updateDesktopPreferences: h.update,
  onDesktopPreferencesChanged: vi.fn(), currentDesktopPreferencesProfileStamp: () => 'p' }));
vi.mock('../startup.js', () => { throw new Error('Host Skill preparation forbidden'); });
vi.mock('../../remote-desktop-viewer/registry.js', () => ({ isRemoteDesktopViewer: (id: number) => id === 99 }));
import { registerDesktopPreferencesIpc } from '../desktopPreferencesIpc';
registerDesktopPreferencesIpc({ isLocalWindow: (id, access) => id === 1 || (id === 2 && access === 'read') });
const event = () => ({ sender: { id: 1, session: h.partition } });
const request = { profileStamp: 'p', expectedRevision: 'r', importOnly: true, set: { theme: 'dark' } };
beforeEach(() => { h.allowed = true; h.update.mockReset(); h.inspect.mockClear(); });
describe('local-profile desktop preferences IPC', () => {
  it('does not permit an untrusted frame or other partition to read/import local profile data', async () => {
    h.allowed = false;
    await expect(h.handlers.get('desktop-preferences:update')!(event(), request)).rejects.toThrow('denied');
    h.allowed = true;
    await expect(h.handlers.get('desktop-preferences:update')!({ sender: { session: {} } }, request)).rejects.toThrow('PERMISSION_DENIED');
    expect(h.update).not.toHaveBeenCalled();
  });
  it('allows a registered utility to read but rejects its writes, viewer and unregistered windows', async () => {
    expect(h.handlers.get('desktop-preferences:get')!({ sender: { id: 2, session: h.partition } })).toMatchObject({ status: 'migrationPending' });
    for (const id of [2, 99, 100]) {
      await expect(h.handlers.get('desktop-preferences:update')!({ sender: { id, session: h.partition } }, request)).rejects.toThrow('PERMISSION_DENIED');
    }
    for (const id of [99, 100]) expect(() => h.handlers.get('desktop-preferences:get')!({ sender: { id, session: h.partition } })).toThrow('PERMISSION_DENIED');
    expect(h.update).not.toHaveBeenCalled();
  });
  it('validates fixed request keys before persistence and rechecks sender during the commit', async () => {
    await expect(h.handlers.get('desktop-preferences:update')!(event(), { ...request, ownerStamp: 'foreign' })).rejects.toThrow('INVALID_PARAMS');
    h.update.mockImplementation(async (_request, check) => { h.allowed = false; check(); });
    await expect(h.handlers.get('desktop-preferences:update')!(event(), request)).rejects.toThrow('PRECONDITION_FAILED');
  });
  it('provides only a read-only trusted synchronous startup snapshot', () => {
    const local = { ...event(), returnValue: undefined };
    h.events.get('desktop-preferences:get-sync')!(local);
    expect(local.returnValue).toEqual({ status: 'migrationPending', profileStamp: 'p', revision: 'r' });
    const other = { sender: { session: {} }, returnValue: undefined };
    h.events.get('desktop-preferences:get-sync')!(other);
    expect(other.returnValue).toBeNull();
    expect(h.update).not.toHaveBeenCalled();
  });
});
