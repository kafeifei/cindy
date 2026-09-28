import { commitNewTaskDefaults, inspectNewTaskDefaults } from '../host-settings/new-task-defaults.js';
import { isModelVisible, type ProviderView } from '@cindy/model-providers';
import { defaultBotModelChain } from '../../shared/botDefaultModelChain.js';
import type { BotModelRoute } from '../../shared/botModelChain.js';
import { activeOwnerScopeKey, isAppSessionBoundaryPending } from '../appSessionState.js';
import { getDesktopProviderService } from '../maker-host/createDesktopProviderService.js';
import { getMakerIfReady } from '../maker-host/index.js';
import { getModelVisibilityOverride, waitForModelVisibilityMirror } from '../maker-host/model-visibility-mirror.js';
import { getNewMakerModelTuning, getSelectedNewMakerRoute } from '../maker-host/newMakerDefaultsCache.js';

export function availableAppDefaultModels(input: {
  providers: readonly ProviderView[];
  currentRoute?: BotModelRoute | null;
  tuning?: (agent: 'claude-code' | 'codex' | 'pi', providerId: string, model: string) => { effort?: string; fastMode?: boolean };
  availableAgents: ReadonlySet<'cc' | 'codex' | 'pi'>;
  enabled: NonNullable<Parameters<typeof defaultBotModelChain>[0]['isModelEnabled']>;
}) {
  const current = defaultBotModelChain({ providers: input.providers, providersLoading: false,
    availableAgents: input.availableAgents, availableAgentsLoaded: true,
    preferredRoute: input.currentRoute ?? undefined, isModelEnabled: input.enabled })[0];
  return input.providers.flatMap(provider => (['claude-code', 'codex', 'pi'] as const).flatMap(agent =>
    (provider.models[agent] ?? []).flatMap(model => {
      const remembered = input.tuning?.(agent, provider.id, model.id);
      const route: BotModelRoute = { harness: agent === 'claude-code' ? 'claude' : agent,
        providerId: provider.id, model: model.id,
        effort: model.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : '',
        fastMode: false };
      if (current && current.harness === route.harness && current.providerId === route.providerId
        && current.model === route.model) {
        if (model.efforts.some(effort => effort === current.effort)) route.effort = current.effort;
        route.fastMode = model.supportsFastMode === true && current.fastMode;
      }
      // The picker preference is authoritative for a remembered target, including false Fast.
      if (remembered?.effort !== undefined) route.effort = model.efforts.some(effort => effort === remembered.effort)
        ? remembered.effort : (model.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : '');
      if (remembered?.fastMode !== undefined) route.fastMode = model.supportsFastMode === true && remembered.fastMode;
      const valid = defaultBotModelChain({ providers: input.providers, providersLoading: false,
        availableAgents: input.availableAgents, availableAgentsLoaded: true,
        preferredRoute: route, isModelEnabled: input.enabled });
      return valid.length ? [{ id: JSON.stringify([route.harness, route.providerId, route.model]),
        route, efforts: model.efforts, supportsFastMode: model.supportsFastMode === true }] : [];
    }),
  ));
}

async function readSelection() {
  const owner = activeOwnerScopeKey();
  const assertOwner = () => {
    if (isAppSessionBoundaryPending() || activeOwnerScopeKey() !== owner) throw new Error('账号已变化，请重新查询');
  };
  assertOwner();
  await waitForModelVisibilityMirror();
  const providers = await getDesktopProviderService({ allowSideEffects: false }).listProviders({ allowSideEffects: false, includeMediaReadiness: false });
  assertOwner();
  const current = getSelectedNewMakerRoute(owner) ?? null;
  const available = availableAppDefaultModels({ providers, currentRoute: current,
    tuning: (agent, providerId, model) => getNewMakerModelTuning(owner, agent, providerId, model),
    availableAgents: new Set((getMakerIfReady()?.listAvailableAgents() ?? []).map(agent => agent === 'claude-code' ? 'cc' : agent)),
    enabled: (agent, providerId, model) => isModelVisible(getModelVisibilityOverride(agent, providerId, model.id), model.defaultEnabled),
  });
  const settings = inspectNewTaskDefaults();
  if (settings.status !== 'ready') throw new Error('默认设置不可读，请重新查询');
  return { owner, assertOwner, current, available, revision: settings.revision };
}

export async function inspectAppDefaultModel() {
  const { current, available } = await readSelection();
  return { current, available };
}

export interface TaskModelSelection {
  id: string;
  effort?: string;
  fastMode?: boolean;
}

/** Resolve one per-task selection from the live catalog; never mutate picker/default preferences. */
export async function resolveTaskModelSelection(selection: TaskModelSelection): Promise<BotModelRoute> {
  const { available } = await inspectAppDefaultModel();
  const option = available.find(entry => entry.id === selection.id);
  if (!option) throw new Error('任务模型已不可用，请重新查询可用模型');
  if (selection.effort !== undefined && !option.efforts.some(effort => effort === selection.effort)) {
    throw new Error('任务模型不支持所选思考深度，请重新选择');
  }
  if (selection.fastMode === true && !option.supportsFastMode) {
    throw new Error('任务模型不支持 Fast，请重新选择');
  }
  return { ...option.route,
    ...(selection.effort !== undefined ? { effort: selection.effort } : {}),
    ...(selection.fastMode !== undefined ? { fastMode: selection.fastMode } : {}),
  };
}

/** Check a saved full route without changing the application or teammate's primary model. */
export async function validateTaskModel(route: BotModelRoute): Promise<boolean> {
  const { available } = await inspectAppDefaultModel();
  return available.some(entry => entry.route.harness === route.harness
    && entry.route.model === route.model && entry.route.providerId === route.providerId
    && (!route.effort || entry.efforts.some(effort => effort === route.effort))
    && (!route.fastMode || entry.supportsFastMode));
}

/** 直接提交 Host CAS，不依赖 Renderer 存活或 localStorage ACK。 */
export async function changeAppDefaultModel(id: string, effort?: string, assertCaller: () => void = () => {}) {
  assertCaller();
  const state = await readSelection();
  assertCaller();
  const choice = state.available.find(item => item.id === id);
  if (!choice || (effort !== undefined && effort !== '' && !choice.efforts.some(value => value === effort)))
    throw new Error('该模型或思考档不可用，请重新查询已启用模型');
  const route = { ...choice.route, ...(effort !== undefined ? { effort } : {}) };
  const result = await commitNewTaskDefaults({ set: {
    harness: route.harness === 'claude' ? 'claude-code' : route.harness,
    providerId: route.providerId, modelId: route.model, effort: route.effort || null, fast: route.fastMode,
  } }, { expectedRevision: state.revision, assertCurrent: () => { state.assertOwner(); assertCaller(); } });
  return { current: route, saved: true, revision: result.revision, application: 'next_task' as const };
}
