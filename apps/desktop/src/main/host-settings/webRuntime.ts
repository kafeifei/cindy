import { executeCloudManagement, startCloudManagementMaintenance } from './managementRuntime.js';
import { probeAvailableShells } from '../terminal/shellResolver.js';
import { net } from 'electron';
import { isModelSelectableForNewRoute, isModelVisible } from '@cindy/model-providers';
import { getModelVisibilityOverride } from '../maker-host/model-visibility-mirror.js';
import { getInstanceConfig } from '../instance-runtime/config.js';
import { getCloudSettingsSnapshotContext } from './snapshotRuntime.js';
import { getHostSettings, getHostSettingsOperation, updateHostSettings } from './index.js';
import { refreshSettingsModelRecommendation } from './catalog.js';
import { HostSettingsError } from './operations.js';
import { createSettingsWebTransport } from './webTransport.js';
import { readSettingsBatch } from './webBatch.js';
import type { SettingsWebEnvelope, SettingsWebResult } from '../../shared/settingsWeb.js';

/** Private Host adapter for origin-checked browser requests delivered by the configured CIS. */
export async function executeWebSettingsRequest(request: SettingsWebEnvelope, assertCurrent: () => void): Promise<SettingsWebResult> {
  assertCurrent();
  const caller = { id: `web:${request.sessionKey}`, assertCurrent };
  try {
    if (request.command.kind === 'manage') return { ok: true, management: await executeCloudManagement(request, assertCurrent) };
    if (request.command.kind === 'readBatch') {
      return await readSettingsBatch(request.command.domains,
        domain => executeWebSettingsRequest({ ...request, command: { kind: 'read', domain } }, assertCurrent), assertCurrent);
    }
    if (request.command.kind === 'update') {
      // The authenticated web form's Save is the human action, as with native settings
      // IPC. This path is not exposed through helper tools or device-link invoke.
      return { ok: true, receipt: await updateHostSettings(caller, request.command.change, true) } as SettingsWebResult;
    }
    if (request.command.kind === 'receipt') return { ok: true, receipt: getHostSettingsOperation(caller, request.command.operationId) } as SettingsWebResult;
    const domain = request.command.domain;
    let models: unknown[] = [];
    if (domain === 'newTaskDefaults') {
      const catalog = await refreshSettingsModelRecommendation();
      catalog.assertCurrent();
      models = catalog.providers.flatMap(provider => provider.connected && !provider.suspended && !provider.modelDiscoveryFailure
        ? catalog.agents.flatMap(harness => provider.agents.includes(harness) ? (provider.models[harness] ?? [])
          .filter(model => isModelSelectableForNewRoute(model, { userProvider: provider.source === 'user' }) && isModelVisible(getModelVisibilityOverride(harness, provider.id, model.id), model.defaultEnabled))
          .map(model => ({ harness, providerId: provider.id, providerName: provider.name, modelId: model.id, modelName: model.name,
            efforts: model.efforts, supportsFast: model.supportsFastMode === true, supportsThinkingToggle: model.thinkingToggle === true })) : []) : []);
      // Do not silently present a partial catalogue as all available choices.
      if (models.length > 256) throw new HostSettingsError('MODEL_CATALOG_TOO_LARGE');
    }
    const choices = domain === 'terminal' ? { defaultShellPref: [
        { value: 'auto', label: 'Auto' }, ...probeAvailableShells().map(shell => ({ value: shell.id, label: shell.displayName })),
      ] } : undefined;
    let settings = await getHostSettings(caller, domain, false, request.command.workspaceId);
    assertCurrent();
    if (domain === 'appearance' && settings.status === 'ready') {
      const keys = ['uiFamily', 'codeFamily', 'uiSize', 'codeSize', 'windowZoom'];
      const project = (value: unknown) => Object.fromEntries(keys.map(key => [key, (value as Record<string, unknown>)[key]]));
      const customizedKeys = settings.customizedKeys.filter(key => keys.includes(key));
      settings = { ...settings, value: project(settings.value), defaults: project(settings.defaults), customizedKeys, isCustomized: customizedKeys.length > 0 } as typeof settings;
    }
    return { ok: true, settings: { ...settings, domain, ...(settings.status === 'ready' && domain === 'newTaskDefaults' ? { models } : {}),
      ...(settings.status === 'ready' && choices ? { choices } : {}) } } as SettingsWebResult;
  } catch (error) {
    return { ok: false, code: error instanceof HostSettingsError ? error.code : 'SETTINGS_REQUEST_FAILED' };
  }
}

export function startCloudSettingsWebTransport(): () => void {
  if (getInstanceConfig()?.authProtocol !== 'resource-v1') return () => {};
  const transport = createSettingsWebTransport({ getContext: getCloudSettingsSnapshotContext,
    fetch: (input, init) => net.fetch(input as string, init), execute: executeWebSettingsRequest, managementV1: true });
  const stopManagement = startCloudManagementMaintenance();
  transport.start();
  return () => { transport.stop(); stopManagement(); };
}
