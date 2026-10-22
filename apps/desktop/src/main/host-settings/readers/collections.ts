import path from 'node:path';
import { inspectModelDisableOverrides } from '../../maker-host/model-disable-store.js';
import { inspectProviderPresentations } from '../../maker-host/provider-presentation-store.js';
import { inspectModelContextLimits } from '../../maker-host/model-context-limit-store.js';
import { inspectModelPriceOverrides } from '../../usage/modelPriceOverrideStore.js';
import { inspectWorkspacePrefs, isWorkspacePrefsEntryDirty } from '../../hook-control/workspacePrefsStore.js';
import { inspectTelegramBehavior } from '../../im/telegram/behaviorStore.js';
import { inspectGhostCindyPrefs } from '../../cindy-brain/cindyPrefsStore.js';
import { inspectGhostErrandPrefs } from '../../cindy-brain/pluginTaskPrefsStore.js';
import { inspectSidebarSettings } from '../../sidebarSettingsStore.js';
import { SettingsReader } from '../../maker-host/plugins/settings-reader.js';
import { createBuiltinPlugins } from '../../maker-host/plugins/builtin-plugins.js';
import { createModelPresentationPreferencesStore } from '../model-presentation-preferences.js';
import { inspectSettingsJson, isSettingsRecord } from '../../maker-host/inspect-settings-json.js';
import { validateNewTaskPreferenceHistory } from '../../../shared/newTaskPreferenceHistory.js';
import { isImDefaultAgentKind, isImDefaultEffort, isImDefaultPermissionMode } from '../../../shared/imDefaultSettings.js';
import { inspectedValue, type ReadonlyCollectionEntry, type ReadonlyCollectionInspection, type ReadonlySettingInspection, type ReadonlySettingsInspection, type ReadonlySettingSource } from '../readTypes.js';

export interface CollectionInspectionOptions {
  ownerRoot: string;
  ownerId: string;
  ownerGeneration: number;
  mode: 'local' | 'cloud';
  /** 仅接受已知的本机工作目录，不为补全列表枚举项目。 */
  knownWorkspaces?: readonly string[];
  knownWorkspacesComplete?: boolean;
}
const entry = (key: string, values: Record<string, unknown>, source: ReadonlySettingSource = 'override'): ReadonlyCollectionEntry => ({
  key, fields: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, inspectedValue(value, source)])),
});
const complete = (entries: ReadonlyCollectionEntry[]): ReadonlyCollectionInspection => ({ status: 'value', entries, total: entries.length, complete: true });
const harness = (value: string | null | undefined) => value === 'cc' ? 'claude-code' : value ?? null;
const privateIfInvalid = (value: string | null | undefined, valid: (value: unknown) => boolean): ReadonlySettingInspection =>
  value == null ? inspectedValue(null, 'default') : valid(value) ? inspectedValue(value, 'override') : { status: 'private' };

/** 只读取已知的持久集合；key 仅作本机关联，不是可公开的标识。 */
export function inspectDynamicSettingsCollections(options: CollectionInspectionOptions): ReadonlySettingsInspection {
  const collections: Record<string, ReadonlyCollectionInspection> = {};
  const run = (names: string[], inspect: () => void) => {
    try { inspect(); } catch { for (const name of names) collections[name] = { status: 'unreadable' }; }
  };
  run(['modelVisibility', 'modelEngines', 'modelFavorites'], () => {
    const owner = { dataOwnerId: options.ownerId, ownerGeneration: options.ownerGeneration };
    const state = createModelPresentationPreferencesStore({
      getOwner: () => owner,
      filePath: () => path.join(options.ownerRoot, 'host-model-presentation-preferences.json'),
      getLegacyClaim: () => { throw new Error('inspection cannot claim a legacy namespace'); },
    }).inspect();
    if (state.status !== 'ready') {
      for (const name of ['modelVisibility', 'modelEngines', 'modelFavorites']) collections[name] = { status: state.status === 'pending-migration' ? 'migrationPending' : state.status };
      return;
    }
    const visibility = Object.entries(state.value.visibility.overrides).map(([key, enabled]) => entry(key, { enabled }));
    // 首见默认只是历史记录，不证明当前目录值；未被显式 override 覆盖的保存路由只计省略数。
    // 这里统计已保存的路由范围，不读取活动/网络目录，也不声称覆盖全部可用模型。
    const visibilityKeys = new Set([
      ...Object.keys(state.value.visibility.overrides),
      ...Object.keys(state.value.visibility.initialization.defaults),
      ...state.value.visibility.initialization.followCatalogKeys,
    ]);
    collections.modelVisibility = { status: 'value', entries: visibility, total: visibilityKeys.size, complete: visibilityKeys.size === visibility.length };
    collections.modelEngines = complete(Object.entries(state.value.engines).map(([key, value]) => entry(key, { agent: harness(value.agent) })));
    collections.modelFavorites = complete(state.value.favorites.items.map(value => {
      const result = entry(value.uid, { agent: harness(value.agent), effort: value.effort ?? null, fast: value.fast === true }, 'unknown');
      if (value.effort !== undefined && !isImDefaultEffort(value.effort)) result.fields.effort = { status: 'private' };
      return result;
    }));
  });
  run(['modelDisable'], () => {
    const state = inspectModelDisableOverrides(options.ownerRoot);
    if (state.status !== 'ready') { collections.modelDisable = state; return; }
    collections.modelDisable = complete([
      ...Object.keys(state.value.disabledModels).map(key => entry(`model:${key}`, { kind: 'model', disabled: true })),
      ...Object.keys(state.value.disabledProviders).map(key => entry(`provider:${key}`, { kind: 'provider', disabled: true })),
    ]);
  });
  run(['providerPresentation'], () => {
    const state = inspectProviderPresentations(options.ownerRoot);
    if (state.status !== 'ready') { collections.providerPresentation = state; return; }
    const all = Object.entries(state.value.providers ?? {});
    if (state.value.name !== undefined || state.value.removed !== undefined) all.unshift(['openai', state.value]);
    const entries = all.map(([key, value]) => entry(key, { nameConfigured: Boolean(value.name), removed: value.removed ?? null }));
    const rawTotal = (isSettingsRecord(state.raw.providers) ? Object.keys(state.raw.providers).length : 0) + (Object.hasOwn(state.raw, 'name') || Object.hasOwn(state.raw, 'removed') ? 1 : 0);
    collections.providerPresentation = { status: 'value', entries, total: rawTotal, complete: rawTotal === entries.length };
  });
  run(['modelContextBudget'], () => {
    const state = inspectModelContextLimits(options.ownerRoot);
    collections.modelContextBudget = state.status === 'ready' ? complete(Object.entries(state.value.limits).map(([key, contextLimit]) => entry(key, { contextLimit }))) : state;
  });
  run(['modelPrices'], () => {
    const state = inspectModelPriceOverrides(options.ownerRoot);
    if (state.status !== 'ready') { collections.modelPrices = state; return; }
    const entries = Object.entries(state.value.entries).map(([key, value]) => entry(key, { ...value.values }));
    const rawTotal = isSettingsRecord(state.raw.entries) ? Object.keys(state.raw.entries).length : 0;
    collections.modelPrices = { status: 'value', entries, total: rawTotal, complete: entries.length === rawTotal };
  });
  run(['modelParameterHistory'], () => {
    const state = inspectSettingsJson(path.join(options.ownerRoot, 'host-new-task-defaults.json'), raw => {
      if (raw._history != null) validateNewTaskPreferenceHistory(raw._history);
      return raw;
    }, 512 * 1024);
    if (state.status !== 'ready') { collections.modelParameterHistory = state; return; }
    if (state.value._initialized !== true || state.value._history == null) { collections.modelParameterHistory = { status: 'migrationPending' }; return; }
    const history = state.value._history;
    validateNewTaskPreferenceHistory(history);
    const entries: ReadonlyCollectionEntry[] = [];
    const add = (key: string, model: string, memory: { lastModel?: string; effortByModel: Record<string, string>; fastByModel: Record<string, boolean>; thinkingByModel?: Record<string, boolean> }) => {
      const values: Record<string, unknown> = { lastSelected: memory.lastModel === model };
      // 空 effort 是领域允许的「未指定」，只省略此叶子，不丢弃其它调档或整集合。
      if (Object.hasOwn(memory.effortByModel, model) && memory.effortByModel[model] !== '') values.effort = memory.effortByModel[model];
      if (Object.hasOwn(memory.fastByModel, model)) values.fast = memory.fastByModel[model];
      if (Object.hasOwn(memory.thinkingByModel ?? {}, model)) values.thinking = memory.thinkingByModel![model];
      const result = entry(key, values, 'unknown');
      if ('effort' in values && !isImDefaultEffort(values.effort)) result.fields.effort = { status: 'private' };
      entries.push(result);
    };
    for (const [key, memory] of Object.entries(history.providerModelMemory)) {
      const models = new Set([...Object.keys(memory.effortByModel), ...Object.keys(memory.fastByModel), ...Object.keys(memory.thinkingByModel), ...(memory.lastModel ? [memory.lastModel] : [])]);
      for (const model of models) add(JSON.stringify([key, model]), model, memory);
    }
    for (const model of new Set([...Object.keys(history.effortByModel), ...Object.keys(history.fastModeByModel)])) add(JSON.stringify(['legacy', model]), model, { effortByModel: history.effortByModel, fastByModel: history.fastModeByModel });
    for (const [vendor, memory] of Object.entries(history.lastByVendor)) {
      if (!memory?.model) continue;
      // vendor 选择与 provider 调档是独立槽；同路由也保留两条，以各自 ordinal/lastSelected 表达。
      const key = JSON.stringify(['lastByVendor', vendor, memory.providerId, memory.model]);
      add(key, memory.model, { lastModel: memory.model, effortByModel: memory.effort ? { [memory.model]: memory.effort } : {}, fastByModel: {} });
    }
    collections.modelParameterHistory = complete(entries);
  });
  run(['imWorkspacePrefs'], () => {
    const state = inspectWorkspacePrefs(options.ownerRoot);
    if (state.status !== 'ready') { collections.imWorkspacePrefs = state; return; }
    collections.imWorkspacePrefs = complete(state.value.entries.map((value, index) => {
      const result = entry(String(index), { channel: value.channel, harness: harness(value.agentKind), modelConfigured: Boolean(value.model), effort: value.effort, permissionMode: value.permissionMode, dirty: isWorkspacePrefsEntryDirty(value) }, 'unknown');
      result.fields.harness = privateIfInvalid(harness(value.agentKind), isImDefaultAgentKind);
      result.fields.effort = privateIfInvalid(value.effort, isImDefaultEffort);
      result.fields.permissionMode = privateIfInvalid(value.permissionMode, isImDefaultPermissionMode);
      return result;
    }));
  });
  run(['telegramGroupActivation'], () => {
    const state = inspectTelegramBehavior(options.ownerRoot);
    collections.telegramGroupActivation = state.status === 'ready' ? complete(Object.entries(state.value.groupActivation ?? {}).map(([key, mode]) => entry(key, { mode }))) : state;
  });
  run(['builtinToolOverrides'], () => {
    const reader = new SettingsReader({ userDataPath: options.ownerRoot, logger: { warn() {} } });
    const ids = createBuiltinPlugins().map(plugin => plugin.id);
    const global = reader.inspectGlobal(ids);
    if (global.status !== 'ready') { collections.builtinToolOverrides = global; return; }
    const entries = [...global.value].map(([tool, enabled]) => entry(`user:${tool}`, { scope: 'user', tool, enabled }));
    let completeScope = options.knownWorkspacesComplete === true;
    for (const [index, dir] of [...new Set(options.knownWorkspaces ?? [])].entries()) {
      const local = reader.inspectProject(dir, ids);
      if (local.status !== 'ready') { completeScope = false; continue; }
      for (const [tool, enabled] of local.value) entries.push(entry(`project:${index}:${tool}`, { scope: 'project', tool, enabled }));
    }
    collections.builtinToolOverrides = { status: 'value', entries, total: completeScope ? entries.length : null, complete: completeScope };
  });
  run(['pluginSidebar'], () => {
    const state = inspectSidebarSettings(options.ownerRoot, options.mode);
    if (state.status !== 'ready') { collections.pluginSidebar = state; return; }
    // 主视图顺序来自已安装的描述信息，不是持久化的用户偏好。
    // 不把任务/项目 pinnedOrder 当作插件顺序，也不公开其中路径。
    collections.pluginSidebar = complete(state.value.hiddenMainViewGhostIds.map(key => entry(key, { hidden: true, order: null })));
  });
  run(['pluginCindyPrefs'], () => {
    const state = inspectGhostCindyPrefs(options.ownerRoot);
    if (state.status !== 'ready') { collections.pluginCindyPrefs = state; return; }
    const entries: ReadonlyCollectionEntry[] = [];
    for (const key of new Set([...Object.keys(state.value.overrides ?? {}), ...Object.keys(state.value.inflightLimits)])) {
      const caps = state.value.overrides?.[key] ?? {};
      const configured = (['text.oneshot'] as const).filter(capability => caps[capability] !== undefined);
      for (const capability of configured.length ? configured : [null]) entries.push(entry(JSON.stringify([key, capability]), { capability, modelConfigured: capability !== null, inflightLimit: state.value.inflightLimits[key] ?? null }));
    }
    collections.pluginCindyPrefs = complete(entries);
  });
  run(['pluginErrandPrefs'], () => {
    const state = inspectGhostErrandPrefs(options.ownerRoot);
    if (state.status !== 'ready') { collections.pluginErrandPrefs = state; return; }
    collections.pluginErrandPrefs = complete(Object.entries(state.value.errand).map(([key, value]) => {
      const result = entry(key, {
        harness: harness(value.agentKind), modelConfigured: Boolean(value.model), providerConfigured: Boolean(value.providerId), effort: value.effort ?? null,
        fastMode: value.fastMode ?? null, permissionMode: value.permissionMode ?? null, workingDirConfigured: Boolean(value.workingDir),
      });
      for (const [field, persisted] of Object.entries({ harness: 'agentKind', modelConfigured: 'model', providerConfigured: 'providerId', effort: 'effort', fastMode: 'fastMode', permissionMode: 'permissionMode', workingDirConfigured: 'workingDir' })) {
        const inspected = result.fields[field];
        if (inspected.status === 'value' && !Object.hasOwn(value, persisted)) inspected.source = 'default';
      }
      return result;
    }));
  });
  return { fields: {}, collections };
}
