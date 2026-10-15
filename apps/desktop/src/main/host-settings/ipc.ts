import { readModelSettings, validateModelSettingsChange, commitModelSettings } from './additionalModels.js';
import { applyAdditionalSettings } from './additionalApplication.js';
import { configureAdditionalNativeOperations } from './additionalRuntime.js';
import { nativeSettingsOperations } from './additionalNative.js';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { NATIVE_HOST_SETTINGS_DOMAINS, isHostSettingsDomain, type HostSettingsUpdate, type NativeHostSettingsSnapshot, type SettingsOwnerStamp } from '../../shared/hostSettings.js';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer.js';
import { isAppContentWindow } from '../windowFocusClassifier.js';
import { throwIpcError } from '../utils/ipcValidate.js';
import { applySavedAppearance } from '../appearance-settings-ipc.js';
import { readHostSettings, getHostSettings, updateHostSettings, onHostSettingsChanged, configureHostSettingsApplication, type HostSettingsCaller } from './index.js';
import { currentSettingsOwner, assertSettingsOwner, inspectPersonalization, importLegacyPersonalization } from './personalization.js';
import { readNewTaskPreferenceHistory, saveNewTaskPreferenceHistory } from './new-task-defaults.js';
import { validateSettingsModelSelection, refreshSettingsModelRecommendation } from './catalog.js';

function nativeCaller(event: IpcMainInvokeEvent, stamp?: unknown): HostSettingsCaller {
  assertTrustedAppRendererEvent(event);
  const owner = currentSettingsOwner();
  if (!owner) throwIpcError('PRECONDITION_FAILED', 'settings owner unavailable');
  if (stamp !== undefined) {
    if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)
      || (stamp as SettingsOwnerStamp).dataOwnerId !== owner.dataOwnerId
      || (stamp as SettingsOwnerStamp).ownerGeneration !== owner.ownerGeneration) throwIpcError('PRECONDITION_FAILED', 'settings owner changed');
  }
  return { id: `native:${event.sender.id}`, assertCurrent: () => { assertTrustedAppRendererEvent(event); assertSettingsOwner(owner); } };
}
async function snapshot(caller: HostSettingsCaller, modelCatalogReady = true): Promise<NativeHostSettingsSnapshot> {
  caller.assertCurrent();
  const operationIds: NativeHostSettingsSnapshot['operationIds'] = {};
  for (const domain of NATIVE_HOST_SETTINGS_DOMAINS) {
    if (domain === 'newTaskDefaults' && !modelCatalogReady) continue;
    const state = await getHostSettings(caller, domain);
    if ('operationId' in state) operationIds[domain] = state.operationId;
  }
  caller.assertCurrent();
  const state = readHostSettings();
  if (!modelCatalogReady) state.newTaskDefaults = { status: 'unavailable', revision: null };
  // 新任务文件不可读时保留该领域状态，不让辅助历史读取阻断其它独立领域。
  return { ...state, userPrompt: inspectPersonalization(), history: state.newTaskDefaults.status === 'ready' ? readNewTaskPreferenceHistory() : null, operationIds };
}
const object = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
function rejectInvalid(): never { throwIpcError('INVALID_PARAMS', 'invalid Host settings request'); }
function safe<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch(() => { throwIpcError('PRECONDITION_FAILED', 'Host settings operation failed; reload before retrying'); });
}
let registered = false;
export function registerHostSettingsIpc(databaseWarningChanged: () => void): void {
  if (registered) return;
  registered = true;
  configureAdditionalNativeOperations(nativeSettingsOperations);
  configureHostSettingsApplication({ models: { read: readModelSettings, validate: validateModelSettingsChange, commit: commitModelSettings }, additional: applyAdditionalSettings, appearance: state => applySavedAppearance(state.value), databaseWarning: databaseWarningChanged, validateNewTaskDefaults: validateSettingsModelSelection });
  ipcMain.handle('host-settings:get', event => safe(async () => {
    const caller = nativeCaller(event);
    let modelCatalogReady = true;
    try { await refreshSettingsModelRecommendation(); }
    catch { modelCatalogReady = false; }
    caller.assertCurrent();
    return snapshot(caller, modelCatalogReady);
  }));
  ipcMain.handle('host-settings:update', (event, raw: unknown) => safe(async () => {
    if (!object(raw) || Object.keys(raw).some(k => !['ownerStamp', 'domain', 'operationId', 'expectedRevision', 'set', 'clear'].includes(k)) || !raw.ownerStamp || !isHostSettingsDomain(raw.domain)) rejectInvalid();
    const caller = nativeCaller(event, raw.ownerStamp);
    return updateHostSettings(caller, raw as unknown as HostSettingsUpdate, true);
  }));
  ipcMain.handle('host-settings:save-history', (event, raw: unknown) => safe(async () => {
    if (!object(raw) || Object.keys(raw).some(k => !['ownerStamp', 'expectedRevision', 'history', 'importOnly'].includes(k)) || !raw.ownerStamp || typeof raw.expectedRevision !== 'string' || typeof raw.importOnly !== 'boolean') rejectInvalid();
    const caller = nativeCaller(event, raw.ownerStamp);
    await saveNewTaskPreferenceHistory(raw.history, raw.ownerStamp as SettingsOwnerStamp, raw.expectedRevision, raw.importOnly);
    caller.assertCurrent();
    return snapshot(caller);
  }));
  ipcMain.handle('host-settings:import-prompt', (event, raw: unknown) => safe(async () => {
    if (!object(raw) || Object.keys(raw).some(k => !['ownerStamp', 'expectedRevision', 'userPrompt'].includes(k)) || !raw.ownerStamp || typeof raw.expectedRevision !== 'string') rejectInvalid();
    const caller = nativeCaller(event, raw.ownerStamp);
    await importLegacyPersonalization(raw.userPrompt, raw.ownerStamp as SettingsOwnerStamp, raw.expectedRevision);
    caller.assertCurrent();
    return snapshot(caller);
  }));
  onHostSettingsChanged(() => {
    const ownerStamp = currentSettingsOwner();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || !isAppContentWindow(win)) continue;
      try { win.webContents.send('host-settings:changed', ownerStamp); } catch { /* 已保存不受窗口关闭影响。 */ }
    }
  });
}
