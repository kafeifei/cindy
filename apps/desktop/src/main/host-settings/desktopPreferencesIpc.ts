import { BrowserWindow, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { DESKTOP_PREFERENCES_CHANNELS as channels, validateDesktopPreferencesUpdate } from '../../shared/desktopPreferences.js';
import { assertTrustedAppRendererEvent, isTrustedTopLevelCindyRendererEvent, isTrustedCindyRendererWindow } from '../security/trustedAppRenderer.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { isRemoteDesktopViewer } from '../remote-desktop-viewer/registry.js';
import { inspectDesktopPreferences, updateDesktopPreferences, onDesktopPreferencesChanged, currentDesktopPreferencesProfileStamp } from './desktop-preferences.js';

/** 来源、实际 profile partition 和 Host 注册的窗口身份三者同时匹配，不能仅凭 app-content 分类。 */
let allowWindow: (id: number, access: 'read' | 'write') => boolean = () => false;
function assertLocalProfile(event: IpcMainEvent | IpcMainInvokeEvent, access: 'read' | 'write' = 'read'): void {
  if (access === 'write') assertTrustedAppRendererEvent(event);
  else if (!isTrustedTopLevelCindyRendererEvent(event)) throwIpcError('PERMISSION_DENIED', 'Desktop preferences require a trusted local frame');
  if (isRemoteDesktopViewer(event.sender.id) || event.sender.session !== session.defaultSession || !allowWindow(event.sender.id, access)) {
    throwIpcError('PERMISSION_DENIED', 'Desktop preferences require the local profile');
  }
}
let registered = false;
export function registerDesktopPreferencesIpc(options: { isLocalWindow: (id: number, access: 'read' | 'write') => boolean }): void {
  allowWindow = options.isLocalWindow;
  if (registered) return;
  registered = true;
  ipcMain.handle(channels.get, event => { assertLocalProfile(event); return inspectDesktopPreferences(); });
  // 同步启动 IPC 仅提供只读快照，避免缓存丢失后先闪回默认主题或语言。
  ipcMain.on(channels.getSync, event => {
    try { assertLocalProfile(event); event.returnValue = inspectDesktopPreferences(); }
    catch { event.returnValue = null; }
  });
  ipcMain.handle(channels.update, async (event, raw: unknown) => {
    assertLocalProfile(event, 'write');
    let request;
    try { request = validateDesktopPreferencesUpdate(raw); }
    catch { throwIpcError('INVALID_PARAMS', 'Invalid desktop preferences request'); }
    try { return await updateDesktopPreferences(request, () => assertLocalProfile(event, 'write')); }
    catch { throwIpcError('PRECONDITION_FAILED', 'Desktop preferences could not be saved; reload before retrying'); }
  });
  onDesktopPreferencesChanged(() => {
    const stamp = currentDesktopPreferencesProfileStamp();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!isTrustedCindyRendererWindow(win) || isRemoteDesktopViewer(win.webContents.id)
        || win.webContents.session !== session.defaultSession || !allowWindow(win.webContents.id, 'read')) continue;
      try { win.webContents.send(channels.changed, stamp); } catch { /* 窗口关闭不会回滚已完成的提交。 */ }
    }
  });
}
