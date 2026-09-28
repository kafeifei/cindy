import { isModelSelectableForNewRoute, isModelVisible, type ProviderView } from '@cindy/model-providers';
import { resolveNewMakerDefaultTuple } from '../../shared/newMakerDefaultTuple.js';
import type { NewTaskDefaultSettings } from '../../shared/hostSettings.js';
import { getDesktopProviderService } from '../maker-host/createDesktopProviderService.js';
import { getMakerIfReady } from '../maker-host/index.js';
import { getModelVisibilityOverride, waitForModelVisibilityMirror } from '../maker-host/model-visibility-mirror.js';
import { currentSettingsOwner, assertSettingsOwner } from './personalization.js';
import { setNewTaskDefaultRecommendation } from './new-task-defaults.js';
import { HostSettingsError } from './operations.js';

/** 只读执行端已加载目录与连接态；不发起发现、授权认领或配置修复。 */
export async function refreshSettingsModelRecommendation() {
  const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  await waitForModelVisibilityMirror();
  assertSettingsOwner(owner);
  let providers: ProviderView[];
  try {
    providers = await getDesktopProviderService({ allowSideEffects: false }).listProviders({ allowSideEffects: false, includeMediaReadiness: false });
  } catch (error) {
    assertSettingsOwner(owner);
    // 坏准入配置不能被当成全启用或继续沿用旧推荐；显式 override 仍由 store 保留。
    setNewTaskDefaultRecommendation(owner, { harness: 'claude-code', providerId: null, modelId: null, effort: null, fast: false, thinking: true, worktree: false, planMode: false });
    throw error;
  }
  assertSettingsOwner(owner);
  const agents = getMakerIfReady()?.listAvailableAgents() ?? [];
  const tuple = recommendSettingsModel(providers, agents);
  setNewTaskDefaultRecommendation(owner, { harness: tuple?.vendor === 'cc' ? 'claude-code' : tuple?.vendor ?? 'claude-code', providerId: tuple?.providerId ?? null, modelId: tuple?.model ?? null, effort: tuple?.effort ?? null, fast: false, thinking: true, worktree: false, planMode: false });
  return { providers, agents, assertCurrent: () => assertSettingsOwner(owner) };
}
/** 产品推荐缺席时只能从执行端真实可用目录选；没有候选就保持空值，不编造 Opus。 */
export function recommendSettingsModel(providers: readonly ProviderView[], agents: readonly NewTaskDefaultSettings['harness'][]) {
  const enabled = (agent: NewTaskDefaultSettings['harness'], providerId: string, model: { id: string; defaultEnabled?: boolean }) =>
    isModelVisible(getModelVisibilityOverride(agent, providerId, model.id), model.defaultEnabled);
  const preferred = resolveNewMakerDefaultTuple({ providers, providersLoading: false, availableAgents: new Set(agents.map(agent => agent === 'claude-code' ? 'cc' : agent)), availableAgentsLoaded: true, isModelEnabled: enabled });
  if (preferred) return preferred;
  for (const provider of providers) {
    if (!provider.connected || provider.suspended || provider.modelDiscoveryFailure) continue;
    for (const agent of agents) {
      if (!provider.agents.includes(agent)) continue;
      const model = [...(provider.models[agent] ?? [])]
        .filter(m => isModelSelectableForNewRoute(m, { userProvider: provider.source === 'user' }) && enabled(agent, provider.id, m))
        .sort((a, b) => Number(b.newSessionDefault?.includes(agent) === true) - Number(a.newSessionDefault?.includes(agent) === true) || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER))[0];
      if (model) return { vendor: agent === 'claude-code' ? 'cc' as const : agent, providerId: provider.id, model: model.id,
        effort: model.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : null };
    }
  }
  return null;
}

export async function validateSettingsModelSelection(value: NewTaskDefaultSettings): Promise<void> {
  const { providers, agents, assertCurrent } = await refreshSettingsModelRecommendation();
  if (!value.providerId && !value.modelId) return;
  const provider = providers.find(p => p.id === value.providerId && p.connected && !p.suspended && !p.modelDiscoveryFailure);
  const model = provider?.models[value.harness]?.find(m => m.id === value.modelId);
  if (!agents.includes(value.harness) || !provider || !model || !isModelSelectableForNewRoute(model, { userProvider: provider.source === 'user' })
    || !isModelVisible(getModelVisibilityOverride(value.harness, provider.id, model.id), model.defaultEnabled)) throw new HostSettingsError('MODEL_UNAVAILABLE');
  if (value.effort !== null && !model.efforts.some(e => e === value.effort)) throw new HostSettingsError('EFFORT_UNSUPPORTED');
  if (value.fast && model.supportsFastMode !== true) throw new HostSettingsError('FAST_UNSUPPORTED');
  if (!value.thinking && model.thinkingToggle !== true) throw new HostSettingsError('THINKING_UNSUPPORTED');
  assertCurrent();
}
