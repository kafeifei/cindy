import { BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import {
  MODEL_PRESENTATION_CHANNELS,
  validateLegacyModelPresentationSource,
  validateModelPresentationOperation,
  type ModelPresentationPreferencesApi,
  type ModelPresentationRequest,
} from '../../shared/modelPresentationPreferences.js';
import {
  assertTrustedAppRendererEvent,
  isTrustedTopLevelCindyRendererEvent,
  isTrustedCindyRendererWindow,
} from '../security/trustedAppRenderer.js';
import { isRemoteDesktopViewer } from '../remote-desktop-viewer/registry.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { currentSettingsOwner, assertSettingsOwner } from './personalization.js';
import {
  inspectModelPresentationPreferences,
  importLegacyModelPresentationPreferences,
  mutateModelPresentationPreferences,
  onModelPresentationPreferencesChanged,
} from './model-presentation-preferences.js';

type WindowAccess = 'read' | 'write';

interface Dependencies {
  assertLocal(event: IpcMainInvokeEvent, access: WindowAccess): void;
  getOwner: typeof currentSettingsOwner;
  assertOwner: typeof assertSettingsOwner;
  inspect: typeof inspectModelPresentationPreferences;
  importLegacy: typeof importLegacyModelPresentationPreferences;
  mutate: typeof mutateModelPresentationPreferences;
}
function invalid(): never {
  throwIpcError('INVALID_PARAMS', 'invalid model preferences request');
}
/** 薄的可测试原生边界；这些通道不加入远端允许列表。 */
export function createModelPresentationPreferencesHandlers(deps: Dependencies) {
  const context = (
    event: IpcMainInvokeEvent,
    raw?: unknown,
    payloadKey?: 'source' | 'operation',
  ) => {
    const access: WindowAccess = payloadKey ? 'write' : 'read';
    deps.assertLocal(event, access);
    const owner = deps.getOwner();
    if (!owner?.dataOwnerId)
      throwIpcError('PRECONDITION_FAILED', 'model preferences owner unavailable');
    if (payloadKey) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
      const request = raw as Record<string, unknown>;
      if (
        Object.keys(request).some(
          (key) => !['ownerStamp', 'expectedRevision', payloadKey].includes(key),
        ) ||
        typeof request.expectedRevision !== 'string' ||
        !request.expectedRevision ||
        request.expectedRevision.length > 256
      )
        invalid();
      const stamp = request.ownerStamp as ModelPresentationRequest['ownerStamp'] | undefined;
      if (
        !stamp ||
        typeof stamp !== 'object' ||
        Array.isArray(stamp) ||
        Object.keys(stamp).some((key) => !['dataOwnerId', 'ownerGeneration'].includes(key)) ||
        stamp.dataOwnerId !== owner.dataOwnerId ||
        stamp.ownerGeneration !== owner.ownerGeneration
      ) {
        throwIpcError('PRECONDITION_FAILED', 'model preferences owner changed');
      }
    }
    return () => {
      deps.assertLocal(event, access);
      deps.assertOwner(owner);
    };
  };
  const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch {
      throwIpcError('PRECONDITION_FAILED', 'model preferences unavailable; reload before retrying');
    }
  };
  return {
    get(event: IpcMainInvokeEvent) {
      const current = context(event);
      const result = deps.inspect();
      current();
      return result;
    },
    importLegacy(event: IpcMainInvokeEvent, raw: unknown) {
      const current = context(event, raw, 'source');
      const request = raw as Parameters<ModelPresentationPreferencesApi['importLegacy']>[0];
      try {
        validateLegacyModelPresentationSource(request.source);
      } catch {
        invalid();
      }
      return safe(async () => {
        const result = await deps.importLegacy(request, current);
        current();
        return result;
      });
    },
    mutate(event: IpcMainInvokeEvent, raw: unknown) {
      const current = context(event, raw, 'operation');
      const request = raw as Parameters<ModelPresentationPreferencesApi['mutate']>[0];
      try {
        validateModelPresentationOperation(request.operation);
      } catch {
        invalid();
      }
      return safe(async () => {
        const result = await deps.mutate(request, current);
        current();
        return result;
      });
    },
  };
}
/** 顶层来源、真实 profile partition、Host 窗口登记须同时成立；app-content 分类不是写权限。 */
let allowWindow: (id: number, access: WindowAccess) => boolean = () => false;
function assertLocalProfile(event: IpcMainInvokeEvent, access: WindowAccess): void {
  if (access === 'write') assertTrustedAppRendererEvent(event);
  else if (!isTrustedTopLevelCindyRendererEvent(event))
    throwIpcError('PERMISSION_DENIED', 'Model preferences require a trusted local frame');
  if (
    isRemoteDesktopViewer(event.sender.id) ||
    event.sender.session !== session.defaultSession ||
    !allowWindow(event.sender.id, access)
  ) {
    throwIpcError('PERMISSION_DENIED', 'Model preferences require the local profile');
  }
}
let registered = false;
export function registerModelPresentationPreferencesIpc(options: {
  isLocalWindow: (id: number, access: WindowAccess) => boolean;
}): void {
  allowWindow = options.isLocalWindow;
  if (registered) return;
  registered = true;
  const handlers = createModelPresentationPreferencesHandlers({
    assertLocal: assertLocalProfile,
    getOwner: currentSettingsOwner,
    assertOwner: assertSettingsOwner,
    inspect: inspectModelPresentationPreferences,
    importLegacy: importLegacyModelPresentationPreferences,
    mutate: mutateModelPresentationPreferences,
  });
  ipcMain.handle(MODEL_PRESENTATION_CHANNELS.get, (event) => handlers.get(event));
  ipcMain.handle(MODEL_PRESENTATION_CHANNELS.importLegacy, (event, raw: unknown) =>
    handlers.importLegacy(event, raw),
  );
  ipcMain.handle(MODEL_PRESENTATION_CHANNELS.mutate, (event, raw: unknown) =>
    handlers.mutate(event, raw),
  );
  onModelPresentationPreferencesChanged(() => {
    const stamp = currentSettingsOwner();
    for (const win of BrowserWindow.getAllWindows()) {
      if (
        !isTrustedCindyRendererWindow(win) ||
        isRemoteDesktopViewer(win.webContents.id) ||
        win.webContents.session !== session.defaultSession ||
        !allowWindow(win.webContents.id, 'read')
      ) continue;
      try {
        win.webContents.send(MODEL_PRESENTATION_CHANNELS.changed, stamp);
      } catch {
        /* 持久化已成功，不因窗口退出逆转提交 */
      }
    }
  });
}
