/**
 * deviceLinkDraftDefaults —— device-link 远程项目草稿的「选中模型默认值」解析(纯函数)。
 *
 * 背景:控制端为被控设备新建项目草稿时,要**全量镜像被控端当前 New Maker 草稿**
 * (model/effort/fast/permission/source),绝不取控制端本地草稿。被控端草稿值经隧道
 * `maker:get-new-maker-defaults` 拉到(可能为 null:旧版被控端无此 channel / 拉取失败),
 * 本函数把它**按被控端 capabilities 校准**后给出可直接 seed 的一组值;remoteDraft 为 null
 * 时回落纯 capabilities 默认(用户决策:旧版被控端回落被控端默认,绝不回落控制端本地)。
 *
 * 抽成纯函数(不依赖 React / IPC)是为了可在 node 直接单测 seed/clamp/fallback 三条路径
 * (规则 9:用代码而非 prompt 固化确定性;规则 14:main 外的高风险派生逻辑也补测)。
 *
 * 新端同时传执行端的供应商目录，复用统一默认选择器保持模型与来源成对；仅旧端缺少
 * 供应商目录时保留 capabilities 的兼容路径。
 */

import type { AgentCapabilities, AgentKind } from '@/hooks/useAgentCapabilities';
import type { Effort, PermissionMode } from '@/lib/userPreferences.types';
import {
  connectedProvidersForAgent,
  isModelSelectableForNewRoute,
  type ProviderView,
} from '@cindy/model-providers';
import { pickConnectedModelForAgent } from '@/lib/draftModelCalibration';
import { resolveNewMakerDefaultTuples } from '@/lib/newMakerDefaultTuple';

/** 被控端当前草稿的原始值(maker:get-new-maker-defaults 隧道返回;字段全可选)。 */
export interface RemoteDraftDefaults {
  /** 执行端当前新任务的引擎；旧端缺省，不借控制端的登录态推断。 */
  preferredAgentKind?: AgentKind;
  defaultTupleCustomized?: boolean;
  model?: string;
  /** false = 被控端明确未在 New Maker picker 选过模型；undefined = 旧端未知。 */
  modelChosenByUser?: boolean;
  effort?: string;
  fastMode?: boolean;
  permissionMode?: string;
  providerId?: string | null;
  /**
   * 被控端「每个模型各自记忆」的 effort / fast。控制端在远程草稿里切到**非当前选中**模型时,
   * 按目标 model id 查这两张表还原被控端记的值;旧版被控端不回 → undefined → 回落该模型 capabilities 默认。
   */
  effortByModel?: Record<string, string>;
  fastModeByModel?: Record<string, boolean>;
  /**
   * 被控端 providerModelMemory 全量快照;`${agent}:*` 是模型级全局预设,
   * `${agent}:${providerId}` 是旧 v2 兼容副本。device-link 草稿列表行据此镜像被控端预设;
   * 旧版被控端不回 → undefined → 控制端非选中行回落 capabilities 默认。
   */
  providerModelMemory?: Record<
    string,
    { effortByModel: Record<string, string>; fastByModel: Record<string, boolean> }
  >;
  /**
   * 被控端「新建会话默认启用 worktree」勾选记忆(vendor 无关根字段)。控制端远程草稿
   * 据此播种 worktree chip 初始态;旧版被控端不回 → undefined → 按未勾选兜底。
   * 不参与 resolveDeviceLinkDraftDefaults 的 per-vendor 解析(消费方直接读)。
   */
  worktreeEnabled?: boolean;
}

/** 只在进入另一台设备时播种引擎。模型、来源仍由目标引擎自己的目录和偏好解析。 */
export function resolveDeviceLinkDraftAgent(input: {
  currentAgent: AgentKind;
  remoteDraft: RemoteDraftDefaults | null;
  providers: readonly ProviderView[];
  availableVendors: ReadonlySet<'cc' | 'codex' | 'pi' | 'orca'>;
}): AgentKind {
  const { currentAgent, remoteDraft, providers, availableVendors } = input;
  const preferred = remoteDraft?.preferredAgentKind;
  const known = preferred === 'claude-code' || preferred === 'codex' || preferred === 'pi';
  const usableProviders = (agent: AgentKind) =>
    connectedProvidersForAgent([...providers], agent).filter(
      (p) =>
        !p.modelDiscoveryFailure &&
        (p.models[agent] ?? []).some((m) =>
          isModelSelectableForNewRoute(m, { userProvider: p.source === 'user' }),
        ),
    );
  const preferredUsable =
    known &&
    availableVendors.has(preferred === 'claude-code' ? 'cc' : preferred) &&
    usableProviders(preferred).length > 0;
  if (preferredUsable && remoteDraft?.defaultTupleCustomized !== false) return preferred;
  if (remoteDraft?.defaultTupleCustomized === false || (known && !preferredUsable)) {
    const suggested = resolveNewMakerDefaultTuples({
      providers,
      providersLoading: false,
      availableAgents: availableVendors,
      availableAgentsLoaded: true,
    }).find((tuple) =>
      usableProviders(tuple.vendor === 'cc' ? 'claude-code' : tuple.vendor).some(
        (p) => p.id === tuple.providerId,
      ),
    );
    if (suggested) return suggested.vendor === 'cc' ? 'claude-code' : suggested.vendor;
    if (preferredUsable) return preferred;
    for (const agent of [currentAgent, 'claude-code', 'codex', 'pi'] as const) {
      if (
        availableVendors.has(agent === 'claude-code' ? 'cc' : agent) &&
        usableProviders(agent).length > 0
      ) {
        return agent;
      }
    }
  }
  return currentAgent;
}

/** 校准后可直接 seed 控制端草稿 holder 的一组值。 */
export interface DeviceLinkDraftSelection {
  model: string;
  effort: Effort;
  fastMode: boolean;
  /** 仍是被控端支持的权限档则带上;否则 undefined(由 ChatInput 回落自身默认)。 */
  permissionMode?: PermissionMode;
  /** 来源透传,合法性交 ChatInput 校准;null = 跟随被控端默认路由。 */
  providerId: string | null;
}

/**
 * 判断同一远程草稿是否应在 capabilities 刷新后重新校准。
 * 新设备或 Agent 始终需要 seed；同一目标只有在被控端明确从未选过模型、且控制端也尚未
 * 编辑运行配置时才允许重校准。旧端的未知状态与任一侧的显式选择都必须保守保留。
 */
export function shouldReseedDeviceLinkDraftDefaults(input: {
  currentSeedKey: string | null;
  nextSeedKey: string;
  capabilitiesChanged: boolean;
  controllerTouched: boolean;
  remoteModelChosenByUser: boolean | undefined;
}): boolean {
  if (input.currentSeedKey !== input.nextSeedKey) return true;
  return (
    input.capabilitiesChanged && !input.controllerTouched && input.remoteModelChosenByUser === false
  );
}

/**
 * 把被控端草稿值(或 null=回落)按被控端 capabilities 校准成可 seed 的选择。
 *   - model:要解析的模型 = targetModel(用户在草稿里切模型)优先,否则 remoteDraft.model(初始 seed);
 *     新端按执行端的已连接来源校准，旧端才回落拍平清单。
 *   - 传 agentKind(New Maker 正式路径)时,effort/fast 优先读 `${agent}:*` 全局模型预设——首页
 *     没有运行中会话,当前显示模型也不受保护。兼容调用未传 agentKind 时保留旧顺序:
 *       · 当前模型 → 草稿激活值 remoteDraft.effort / remoteDraft.fastMode;
 *       · 其它模型 → per-model 记忆 effortByModel[id] / fastModeByModel[id]。
 *     最终 effort 仍按目标模型 efforts 校验(不支持则落 defaultEffort);fast 仍按 agent×模型 能力门控。
 *   - permissionMode:被控端支持该档才带,否则 undefined(非按模型记)。
 *   - providerId:与最终可用模型一起选定，不借本机来源。
 * capabilities.availableModels 为空(理论不该发生)→ 退化返回安全兜底。
 */
export function resolveDeviceLinkDraftDefaults(
  capabilities: AgentCapabilities,
  remoteDraft: RemoteDraftDefaults | null,
  targetModel?: string,
  agentKind?: AgentKind,
  providers?: readonly ProviderView[],
): DeviceLinkDraftSelection {
  const models = capabilities.availableModels;
  let providerId = remoteDraft?.providerId ?? null;
  const permissionMode = pickPermissionMode(capabilities, remoteDraft?.permissionMode);

  // 要解析哪个模型:控制端本次显式 targetModel(切模型)永远优先。初始 seed 只有在**新端明确
  // 回传未选过模型**时才采用区域目录默认；旧端缺字段时保守保留 remoteDraft.model，避免
  // 把无法识别的历史显式选择覆盖掉。每个 Agent 只接受自己的 v3 默认标记。
  const markedDefault = agentKind
    ? models
        .map((model, index) => ({ model, index }))
        .filter(
          ({ model }) =>
            model.defaultEnabled !== false &&
            (model.newSessionDefault?.includes(agentKind) ?? false),
        )
        .sort(
          (a, b) =>
            (a.model.sortOrder ?? Number.MAX_SAFE_INTEGER) -
              (b.model.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
        )[0]?.model.id
    : undefined;
  const wantedModelId =
    targetModel ??
    (remoteDraft?.modelChosenByUser === false && providerId === null
      ? (markedDefault ?? remoteDraft.model)
      : remoteDraft?.model);

  // capabilities 是跨来源的型号并集，含未连接的内置订阅；不能把存在于其中当成可调用。
  // 新端使用执行端供应商目录与本地新任务相同的准入/默认选择器，旧端保留拍平清单兼容。
  const connected =
    providers && agentKind
      ? connectedProvidersForAgent([...providers], agentKind)
          .filter((p) => !p.modelDiscoveryFailure)
          .map((p) => ({
            ...p,
            models: {
              ...p.models,
              [agentKind]: (p.models[agentKind] ?? []).filter((m) =>
                isModelSelectableForNewRoute(m, { userProvider: p.source === 'user' }),
              ),
            },
          }))
      : undefined;
  let connectedModel;
  if (connected && agentKind) {
    const wanted = targetModel ?? remoteDraft?.model;
    const preferred = connected.find(
      (p) => p.id === providerId && (p.models[agentKind]?.length ?? 0) > 0,
    );
    const pool = preferred ? [preferred] : connected;
    const explicit = targetModel !== undefined || remoteDraft?.modelChosenByUser !== false;
    const retained = explicit
      ? pool.find((p) => p.models[agentKind]?.some((m) => m.id === wanted))
      : undefined;
    const picked =
      retained && wanted
        ? { providerId: retained.id, model: wanted }
        : pickConnectedModelForAgent(pool, agentKind, explicit ? '' : (wanted ?? ''));
    connectedModel = picked
      ? connected
          .find((p) => p.id === picked.providerId)
          ?.models[agentKind]?.find((m) => m.id === picked.model)
      : undefined;
    providerId = picked?.providerId ?? null;
    if (!connectedModel) {
      // 已读到权威空集合时不再把冷启动占位伪装成可发消息的默认模型。
      return { model: '', effort: 'high', fastMode: false, permissionMode, providerId: null };
    }
  }

  if (models.length === 0 && !connectedModel) {
    return {
      model: wantedModelId ?? '',
      effort: (remoteDraft?.effort as Effort) ?? 'high',
      fastMode: false,
      permissionMode,
      providerId,
    };
  }

  const chosen = connectedModel ?? models.find((m) => m.id === wantedModelId) ?? models[0];
  const globalPreset = agentKind ? remoteDraft?.providerModelMemory?.[`${agentKind}:*`] : undefined;
  const providerPreset =
    agentKind && providerId
      ? remoteDraft?.providerModelMemory?.[`${agentKind}:${providerId}`]
      : undefined;
  // 解析的是不是被控端当前选中模型:是 → 草稿激活值;否 → per-model 记忆(切模型还原)。
  const isActiveModel = chosen.id === remoteDraft?.model;
  // 新建草稿没有 live 会话需要保护:全局模型预设存在时,即使是首页当前显示模型也优先采用。
  // agentKind 缺失时保留旧调用方语义,方便旧测试 / 兼容入口逐步迁移。
  // 新快照写 `${agent}:${providerId}`，旧快照仍可能只有 `${agent}:*`。
  const wantedEffort = (providerPreset?.effortByModel[chosen.id] ??
    globalPreset?.effortByModel[chosen.id] ??
    (isActiveModel ? remoteDraft?.effort : remoteDraft?.effortByModel?.[chosen.id])) as
    Effort | undefined;
  const presetFast = providerPreset?.fastByModel[chosen.id] ?? globalPreset?.fastByModel[chosen.id];
  const wantedFast =
    presetFast ??
    (isActiveModel
      ? remoteDraft?.fastMode === true
      : remoteDraft?.fastModeByModel?.[chosen.id] === true);

  const effort: Effort =
    wantedEffort && chosen.efforts.some((effort) => effort === wantedEffort)
      ? wantedEffort
      : (chosen.defaultEffort ?? chosen.efforts[0] ?? wantedEffort ?? 'high');
  const fastMode = Boolean(capabilities.hasFastMode && chosen.supportsFastMode && wantedFast);

  return { model: chosen.id, effort, fastMode, permissionMode, providerId };
}

/** 被控端草稿权限档仍在被控端支持列表里则带上,否则 undefined(ChatInput 回落自身默认)。 */
function pickPermissionMode(
  capabilities: AgentCapabilities,
  raw: string | undefined,
): PermissionMode | undefined {
  if (!raw) return undefined;
  return capabilities.permissionModes.some((p) => p.id === raw)
    ? (raw as PermissionMode)
    : undefined;
}
