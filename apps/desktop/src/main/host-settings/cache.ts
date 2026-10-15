import { peekCommittedAppSession } from '../appSessionState.js';
import { configureNewMakerDefaultsSource, notifyNewMakerDefaultsChanged, type NewMakerDraftSnapshot } from '../maker-host/newMakerDefaultsCache.js';
import { inspectNewTaskDefaults, readNewTaskPreferenceHistory, onNewTaskDefaultsChanged } from './new-task-defaults.js';

let installed = false;

/** 只投影已保存偏好；不把 Worker 的 legacy effort 优先级改成远端草稿优先级。 */
export function installHostNewMakerDefaultsSource(): void {
  if (installed) return;
  installed = true;
  onNewTaskDefaultsChanged(notifyNewMakerDefaultsChanged);
  configureNewMakerDefaultsSource(() => {
    const owner = peekCommittedAppSession();
    const state = inspectNewTaskDefaults();
    if (!owner?.dataOwnerId || state.status !== 'ready') return null;
    const history = readNewTaskPreferenceHistory();
    const value = state.value;
    const vendor = value.harness === 'claude-code' ? 'cc' : value.harness;
    const lastByVendor = structuredClone(history?.lastByVendor ?? {});
    lastByVendor[vendor] = { ...lastByVendor[vendor], model: value.modelId ?? '', providerId: value.providerId, effort: value.effort ?? '', planMode: value.planMode };
    const providerModelMemory = structuredClone(history?.providerModelMemory ?? {});
    if (value.modelId && value.providerId) {
      const key = `${value.harness}:${value.providerId}`;
      const memory = providerModelMemory[key] ?? { lastModel: '', effortByModel: {}, fastByModel: {}, thinkingByModel: {} };
      memory.fastByModel[value.modelId] = value.fast; memory.thinkingByModel[value.modelId] = value.thinking;
      providerModelMemory[key] = memory;
    }
    const snapshot: NewMakerDraftSnapshot = {
      vendor,
      lastByVendor,
      defaultTupleCustomized: state.customizedKeys.some(k => ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking'].includes(k)),
      modelChosenByVendor: { ...history?.modelChosenByVendor, [vendor]: state.customizedKeys.some(k => ['harness', 'providerId', 'modelId'].includes(k)) },
      fastModeByModel: { ...history?.fastModeByModel, ...(value.modelId ? { [value.modelId]: value.fast } : {}) },
      effortByModel: history?.effortByModel ?? {},
      providerModelMemory,
      worktreeEnabled: value.worktree,
      ...(value.modelId ? { selectedRoute: { harness: value.harness === 'claude-code' ? 'claude' : value.harness, providerId: value.providerId, model: value.modelId, effort: value.effort ?? '', fastMode: value.fast } } : {}),
    };
    return { snapshot, ownerScope: `${owner.mode}:${owner.dataOwnerId}:${owner.generation}` };
  });
}
