import { createLogger } from '../logger.js';
import { createOverrideSettingsFile, type OverrideSettingsCommitOptions, type OverrideSettingsMutation } from '../maker-host/override-settings-file.js';
import { normalizeHostSettingsChange, type NewTaskDefaultSettings, type HostSettingState, type SettingsOwnerStamp } from '../../shared/hostSettings.js';
import { validateNewTaskPreferenceHistory, type NewTaskPreferenceHistory } from '../../shared/newTaskPreferenceHistory.js';
import { assertSettingsOwner, currentSettingsOwner, settingsOwnerKey, settingsOwnerFilePath } from './personalization.js';
import { HostSettingsError } from './operations.js';

interface StoredDefaults extends NewTaskDefaultSettings { _initialized: boolean; _history: NewTaskPreferenceHistory | null }
const emptyDefaults: NewTaskDefaultSettings = { harness: 'claude-code', providerId: null, modelId: null, effort: null, fast: false, thinking: true, worktree: false, planMode: false };
const keys = Object.keys(emptyDefaults) as Array<keyof NewTaskDefaultSettings>;
let recommended: { owner: string; value: NewTaskDefaultSettings } | null = null;
const listeners = new Set<() => void>();
/** Host catalog preparation supplies a verified recommendation; never persist this interpretation. */
export function setNewTaskDefaultRecommendation(owner: SettingsOwnerStamp, value: NewTaskDefaultSettings): void {
  assertSettingsOwner(owner);
  const next = { owner: settingsOwnerKey(owner), value: structuredClone(value) };
  if (JSON.stringify(next) === JSON.stringify(recommended)) return;
  recommended = next;
  for (const listener of listeners) { try { listener(); } catch {} }
}
function defaults(): StoredDefaults {
  const owner = currentSettingsOwner();
  return { ...(owner && recommended?.owner === settingsOwnerKey(owner) ? recommended.value : emptyDefaults), _initialized: false, _history: null };
}
const store = createOverrideSettingsFile<StoredDefaults>({
  filePath: () => settingsOwnerFilePath('host-new-task-defaults.json'),
  defaults,
  normalize: raw => ({ ...defaults(), ...raw as StoredDefaults }),
  validateOverrides: raw => {
    for (const [key, value] of Object.entries(raw)) {
      if (key === '_initialized' && typeof value === 'boolean') continue;
      if (key === '_history') { if (value !== null) validateNewTaskPreferenceHistory(value); continue; }
      if (['providerId', 'modelId', 'effort'].includes(key) && value === null) continue;
      normalizeHostSettingsChange({ domain: 'newTaskDefaults', set: { [key]: value } });
    }
  },
  scopeKey: () => JSON.stringify(currentSettingsOwner()),
  atomicOnly: true, preserveUnreadableFile: true, maxBytes: 512 * 1024,
  log: createLogger('host-new-task-defaults'), label: 'new-task-defaults',
});
export function onNewTaskDefaultsChanged(listener: () => void): () => void {
  listeners.add(listener); const off = store.onChanged(listener);
  return () => { off(); listeners.delete(listener); };
}
function projectNewTaskDefaults(result: ReturnType<typeof store.inspect>): HostSettingState<NewTaskDefaultSettings> {
  if (result.status !== 'ready') return result;
  const pick = (value: StoredDefaults): NewTaskDefaultSettings => Object.fromEntries(keys.map(key => [key, value[key]])) as unknown as NewTaskDefaultSettings;
  const customizedKeys = result.customizedKeys.filter(key => keys.includes(key as keyof NewTaskDefaultSettings));
  return { ...result, value: pick(result.value), defaults: pick(result.defaults), customizedKeys, isCustomized: customizedKeys.length > 0 };
}
export function inspectNewTaskDefaults(): HostSettingState<NewTaskDefaultSettings> {
  if (!currentSettingsOwner()) return { status: 'unavailable', revision: null };
  return projectNewTaskDefaults(store.inspect());
}
/** 只读网页不能把旧 Renderer 尚未导入的状态解释成已确认默认值。 */
export function inspectNewTaskDefaultsForSnapshot(): HostSettingState<NewTaskDefaultSettings> | { status: 'migrationPending'; revision: null } {
  if (!currentSettingsOwner()) return { status: 'unavailable', revision: null };
  const result = store.inspect();
  if (result.status === 'ready' && !result.value._initialized) return { status: 'migrationPending', revision: null };
  return projectNewTaskDefaults(result);
}
export function readNewTaskPreferenceHistory(): NewTaskPreferenceHistory | null {
  if (!currentSettingsOwner()) return null;
  const result = store.inspect();
  if (result.status !== 'ready') throw new HostSettingsError('UNREADABLE');
  return result.value._history;
}
export async function commitNewTaskDefaults(mutation: OverrideSettingsMutation<NewTaskDefaultSettings>, options: OverrideSettingsCommitOptions = {}) {
  const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  const result = await store.commitAtomic(state => {
    const next = { ...state.value, ...Object.fromEntries((mutation.clear ?? []).map(k => [k, state.defaults[k]])), ...mutation.set };
    const vendor = next.harness === 'claude-code' ? 'cc' : next.harness;
    const history: NewTaskPreferenceHistory = structuredClone(state.value._history ?? { vendor, lastByVendor: {}, modelChosenByVendor: {}, defaultTupleCustomized: false, defaultTupleSelectionCustomized: false, effortByModel: {}, fastModeByModel: {}, worktreeEnabled: false, worktreePreferenceCustomized: false, providerModelMemory: {} });
    // clear 作用于被恢复的旧型号，不能在推荐已换型号后误删新型号、留下旧 override。
    const oldVendor = state.value.harness === 'claude-code' ? 'cc' : state.value.harness;
    const oldModel = state.value.modelId;
    if (oldModel) {
      const oldMemory = state.value.providerId ? history.providerModelMemory[`${state.value.harness}:${state.value.providerId}`] : undefined;
      const legacyMemory = history.providerModelMemory[`${state.value.harness}:*`];
      for (const field of mutation.clear ?? []) {
        if (field === 'effort') {
          delete history.effortByModel[oldModel];
          if (oldMemory) delete oldMemory.effortByModel[oldModel];
          if (legacyMemory) delete legacyMemory.effortByModel[oldModel];
        }
        if (field === 'fast') {
          delete history.fastModeByModel[oldModel];
          if (oldMemory) delete oldMemory.fastByModel[oldModel];
          if (legacyMemory) delete legacyMemory.fastByModel[oldModel];
        }
        if (field === 'thinking' && oldMemory) delete oldMemory.thinkingByModel[oldModel];
      }
    }
    if (['harness', 'providerId', 'modelId'].every(key => mutation.clear?.includes(key as keyof NewTaskDefaultSettings))) {
      history.modelChosenByVendor[oldVendor] = false;
    }
    const customized = new Set(state.customizedKeys.filter(k => !(mutation.clear ?? []).includes(k as keyof NewTaskDefaultSettings)));
    Object.keys(mutation.set ?? {}).forEach(k => customized.add(k));
    history.vendor = vendor;
    history.defaultTupleSelectionCustomized = ['harness', 'providerId', 'modelId'].some(k => customized.has(k));
    history.defaultTupleCustomized = history.defaultTupleSelectionCustomized || ['effort', 'fast', 'thinking'].some(k => customized.has(k));
    history.modelChosenByVendor[vendor] = history.defaultTupleSelectionCustomized;
    history.worktreeEnabled = next.worktree; history.worktreePreferenceCustomized = customized.has('worktree');
    history.lastByVendor[vendor] = { ...history.lastByVendor[vendor], model: next.modelId ?? '', providerId: next.providerId, effort: next.effort ?? '', planMode: next.planMode };
    if (next.modelId) {
      const model = next.modelId;
      const memoryKey = next.providerId ? `${next.harness}:${next.providerId}` : null;
      const memory = memoryKey ? history.providerModelMemory[memoryKey] ?? { lastModel: '', effortByModel: {}, fastByModel: {}, thinkingByModel: {} } : null;
      if (mutation.set?.modelId && memory) memory.lastModel = model;
      for (const field of ['effort', 'fast', 'thinking'] as const) {
        if (Object.hasOwn(mutation.set ?? {}, field)) {
          if (field === 'effort') {
            if (next.effort !== null) { history.effortByModel[model] = next.effort; if (memory) memory.effortByModel[model] = next.effort; }
            else { delete history.effortByModel[model]; if (memory) delete memory.effortByModel[model]; }
          }
          if (field === 'fast') { history.fastModeByModel[model] = next.fast; if (memory) memory.fastByModel[model] = next.fast; }
          if (field === 'thinking' && memory) memory.thinkingByModel[model] = next.thinking;
        }
        if (mutation.clear?.includes(field)) {
          if (field === 'effort') { delete history.effortByModel[model]; if (memory) delete memory.effortByModel[model]; }
          if (field === 'fast') { delete history.fastModeByModel[model]; if (memory) delete memory.fastByModel[model]; }
          if (field === 'thinking' && memory) delete memory.thinkingByModel[model];
        }
      }
      if (memoryKey && memory) history.providerModelMemory[memoryKey] = memory;
    }
    return { set: { ...mutation.set, _initialized: true, _history: history }, clear: mutation.clear };
  }, {
    ...options, assertCurrent: () => { assertSettingsOwner(owner); options.assertCurrent?.(); },
  });
  return result;
}

function overridesFromHistory(history: NewTaskPreferenceHistory, previous?: StoredDefaults, customizedKeys: string[] = []): Partial<NewTaskDefaultSettings> {
  const harness = history.vendor === 'cc' ? 'claude-code' : history.vendor;
  const active = history.lastByVendor[history.vendor];
  const memory = active?.providerId ? history.providerModelMemory[`${harness}:${active.providerId}`] : undefined;
  const model = active?.model;
  // 原生 UI 历史不是完整的 override 表（例如无模型时的显式 false/null）；无关编辑不能丢键。
  const result: Partial<NewTaskDefaultSettings> = previous
    ? Object.fromEntries(keys.filter(key => customizedKeys.includes(key)).map(key => [key, previous[key]])) : {};
  const selection = history.defaultTupleSelectionCustomized || history.modelChosenByVendor[history.vendor];
  const sameRoute = previous?.harness === harness && previous.modelId === (model || null) && previous.providerId === (active?.providerId || null);
  if (selection && (!previous || !sameRoute || !['harness', 'providerId', 'modelId'].some(key => customizedKeys.includes(key)))) {
    result.harness = harness; result.modelId = model || null; result.providerId = active?.providerId || null;
  }
  if (model) {
    // 当前激活档与 Worker 的按模型历史有意不同，迁移不能把后者提升为远端草稿激活档。
    const activeChanged = !previous || previous.harness !== harness || previous.modelId !== model
      || previous.providerId !== active?.providerId || (previous.effort ?? '') !== active?.effort;
    const rememberedEffort = memory?.effortByModel[model] ?? history.effortByModel[model];
    const oldMemory = active?.providerId ? previous?._history?.providerModelMemory[`${harness}:${active.providerId}`] : undefined;
    const oldEffort = oldMemory?.effortByModel[model] ?? previous?._history?.effortByModel[model];
    const effort = history.defaultTupleCustomized && activeChanged ? active?.effort
      : !previous || oldEffort !== rememberedEffort ? rememberedEffort
      : customizedKeys.includes('effort') ? previous.effort : undefined;
    if (effort !== undefined) result.effort = effort || null;
    const fast = memory?.fastByModel[model] ?? history.fastModeByModel[model];
    if (fast !== undefined && (!previous || !sameRoute || fast !== previous.fast || customizedKeys.includes('fast'))) result.fast = fast;
    const thinking = memory?.thinkingByModel[model];
    if (thinking !== undefined && (!previous || !sameRoute || thinking !== previous.thinking || customizedKeys.includes('thinking'))) result.thinking = thinking;
  }
  if (history.worktreePreferenceCustomized) result.worktree = history.worktreeEnabled;
  if (active && (active.planMode === true || customizedKeys.includes('planMode') || (previous && active.planMode === false && previous.planMode))) result.planMode = active.planMode === true;
  return result;
}
/** 控制端只传偏好字段；Host 在当前 owner 的锁内写入，无本机窗口也可完成。 */
export async function applyHostRemoteDraftPreference(pref: {
  agent: NewTaskDefaultSettings['harness']; providerId: string; modelId: string; active: boolean;
  markModelChoice?: boolean; effort?: string; fast?: boolean; thinking?: boolean;
}): Promise<void> {
  const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  await store.commitAtomic(state => {
    const value = state.value;
    const vendor = value.harness === 'claude-code' ? 'cc' : value.harness;
    const targetVendor = pref.agent === 'claude-code' ? 'cc' : pref.agent;
    const selection = ['harness', 'providerId', 'modelId'].some(key => state.customizedKeys.includes(key));
    const history: NewTaskPreferenceHistory = structuredClone(value._history ?? {
      vendor, lastByVendor: {}, modelChosenByVendor: {}, defaultTupleCustomized: false,
      defaultTupleSelectionCustomized: false, effortByModel: {}, fastModeByModel: {},
      worktreeEnabled: value.worktree, worktreePreferenceCustomized: state.customizedKeys.includes('worktree'), providerModelMemory: {},
    });
    history.vendor = vendor;
    history.defaultTupleSelectionCustomized = selection;
    history.defaultTupleCustomized = state.customizedKeys.some(key => ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking'].includes(key));
    history.lastByVendor[vendor] = { ...history.lastByVendor[vendor], model: value.modelId ?? '', providerId: value.providerId, effort: value.effort ?? '', planMode: value.planMode };
    if (value.modelId) {
      // 远端也从同一 Host 活动值开始叠加，避免无关型号编辑复活已 reset 的旧调档。
      history.fastModeByModel[value.modelId] = value.fast;
      if (value.providerId) {
        const activeKey = `${value.harness}:${value.providerId}`;
        const activeMemory = history.providerModelMemory[activeKey] ?? { lastModel: '', effortByModel: {}, fastByModel: {}, thinkingByModel: {} };
        activeMemory.fastByModel[value.modelId] = value.fast; activeMemory.thinkingByModel[value.modelId] = value.thinking;
        history.providerModelMemory[activeKey] = activeMemory;
      }
    }
    if (pref.active && pref.markModelChoice !== false) {
      history.vendor = targetVendor;
      history.defaultTupleCustomized = true; history.defaultTupleSelectionCustomized = true;
      history.modelChosenByVendor[targetVendor] = true;
      history.lastByVendor[targetVendor] = { ...history.lastByVendor[targetVendor], model: pref.modelId, providerId: pref.providerId || null,
        effort: pref.effort ?? history.lastByVendor[targetVendor]?.effort ?? '' };
    } else if (pref.active && targetVendor === vendor && value.modelId === pref.modelId && pref.effort !== undefined) {
      history.lastByVendor[vendor]!.effort = pref.effort;
    }
    const key = `${pref.agent}:${pref.providerId}`;
    const memory = history.providerModelMemory[key] ?? { lastModel: '', effortByModel: {}, fastByModel: {}, thinkingByModel: {} };
    if (pref.active && pref.markModelChoice !== false) memory.lastModel = pref.modelId;
    if (pref.effort !== undefined) {
      memory.effortByModel[pref.modelId] = pref.effort;
      if (pref.active) history.effortByModel[pref.modelId] = pref.effort;
    }
    if (pref.fast !== undefined) {
      memory.fastByModel[pref.modelId] = pref.fast;
      if (pref.active) history.fastModeByModel[pref.modelId] = pref.fast;
    }
    if (pref.thinking !== undefined) memory.thinkingByModel[pref.modelId] = pref.thinking;
    if (pref.providerId) history.providerModelMemory[key] = memory;
    validateNewTaskPreferenceHistory(history);
    return { clear: keys, set: { ...overridesFromHistory(history, value, state.customizedKeys), _history: history, _initialized: true } };
  }, { assertCurrent: () => assertSettingsOwner(owner) });
}

/** 原生 UI 的 CAS/迁移保留权限历史；helper 的封闭字段语法仍不能读写权限。 */
export async function saveNewTaskPreferenceHistory(history: unknown, owner: SettingsOwnerStamp, expectedRevision: string, importOnly: boolean): Promise<'saved' | 'already_initialized'> {
  validateNewTaskPreferenceHistory(history);
  let outcome: 'saved' | 'already_initialized' = 'saved';
  await store.commitAtomic(state => {
    // 有任何 Host override 的旧文件也视为已初始化；reset 留下的墓碑永远禁止重导。
    if (importOnly && (state.value._initialized || state.customizedKeys.some(key => keys.includes(key as keyof NewTaskDefaultSettings)))) {
      outcome = 'already_initialized'; return {};
    }
    const overrides = overridesFromHistory(history, importOnly ? undefined : state.value, importOnly ? [] : state.customizedKeys);
    return { clear: keys, set: { ...overrides, _history: structuredClone(history), _initialized: true } };
  }, { expectedRevision, assertCurrent: () => assertSettingsOwner(owner) });
  return outcome;
}
