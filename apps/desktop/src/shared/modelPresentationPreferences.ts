import { EFFORT_VALUES, type AgentKind } from '@cindy/model-providers';
import type { SettingsOwnerStamp } from './hostSettings.js';
import type { ModelVisibilityLegacyOwnerClaim } from './modelVisibility.js';

/** 本机偏好内部合同，不是公开快照或 wire DTO；标识上传前必须经过隐私投影。 */
export const MODEL_PRESENTATION_ENGINES = ['cc', 'codex', 'pi'] as const;
export type ModelEngine = (typeof MODEL_PRESENTATION_ENGINES)[number];
export function isModelPresentationEngine(value: unknown): value is ModelEngine {
  return (
    typeof value === 'string' && (MODEL_PRESENTATION_ENGINES as readonly string[]).includes(value)
  );
}
/** 原生界面接受字符串 effort 键，运行时按 EFFORT_VALUES 校验。 */
export type FavoriteEffort = string;
export interface ModelEngineOverride {
  agent: ModelEngine;
}
export interface ModelFavoriteConfig {
  providerId: string;
  modelId: string;
  agent: ModelEngine;
  effort?: FavoriteEffort;
  fast?: true;
}
export interface ModelFavoriteItem extends ModelFavoriteConfig {
  uid: string;
}
export interface ModelFavoritePatch {
  agent?: ModelEngine;
  effort?: FavoriteEffort | null;
  fast?: boolean;
}
export interface ModelFavoritesState {
  uidSeq: number;
  items: ModelFavoriteItem[];
  seeded?: true;
}
export interface ModelVisibilityInitialization {
  eligibleForDefaults: boolean;
  defaults: Record<string, boolean>;
  scopes: string[];
  followCatalogKeys: string[];
}
export interface ModelVisibilityPreferences {
  overrides: Record<string, boolean>;
  initialization: ModelVisibilityInitialization;
}
export interface ModelPresentationPreferences {
  visibility: ModelVisibilityPreferences;
  engines: Record<string, ModelEngineOverride>;
  favorites: ModelFavoritesState;
}
export type ModelPresentationPreferencesSnapshot =
  | {
      status: 'ready' | 'pending-migration';
      ownerStamp: SettingsOwnerStamp;
      revision: string;
      initialized: boolean;
      value: ModelPresentationPreferences;
    }
  | { status: 'unavailable' | 'unreadable'; ownerStamp: SettingsOwnerStamp | null; revision: null };

/** 只捕获固定旧键，禁止把控制端或远端 localStorage 当成导入来源。 */
export interface LegacyModelPresentationSource {
  visibility: {
    overrides: string | null;
    initialization: string | null;
    migrationComplete: boolean;
    defaultsMigration: boolean;
    localAdoption: boolean;
    legacy: string | null;
    local: { overrides: string | null; initialization: string | null };
  };
  engines: string | null;
  favorites: string | null;
  hasProviderHistory: boolean;
}
export interface VisibilityCatalogScope {
  providerId: string;
  agent: AgentKind;
  models: Array<{ id: string; defaultEnabled?: boolean }>;
  modelPrefixes: string[];
}
export type ModelPresentationOperation =
  | {
      kind: 'visibility-set';
      providerId: string;
      targets: Array<{ agent: AgentKind; modelId: string }>;
      enabled: boolean;
    }
  | {
      kind: 'visibility-reset';
      providerId: string;
      targets: Array<{ agent: AgentKind; modelId: string }>;
    }
  | { kind: 'visibility-catalog'; scopes: VisibilityCatalogScope[] }
  | { kind: 'engine-set'; providerId: string; modelId: string; agent: ModelEngine }
  | { kind: 'engine-clear'; providerId: string; modelId: string }
  | { kind: 'favorite-add' | 'favorite-seed'; config: ModelFavoriteConfig }
  | { kind: 'favorite-update'; uid: string; patch: ModelFavoritePatch }
  | { kind: 'favorite-remove'; uid: string }
  | { kind: 'reset' };
export interface ModelPresentationRequest {
  ownerStamp: SettingsOwnerStamp;
  expectedRevision: string;
}
export interface ModelPresentationReceipt {
  snapshot: ModelPresentationPreferencesSnapshot;
  /** Host 分配已持久化身份；Renderer 不乐观预占 fav-N。 */
  favoriteUid?: string;
}
export interface ModelPresentationPreferencesApi {
  get(): Promise<ModelPresentationPreferencesSnapshot>;
  importLegacy(
    request: ModelPresentationRequest & { source: LegacyModelPresentationSource },
  ): Promise<ModelPresentationPreferencesSnapshot>;
  mutate(
    request: ModelPresentationRequest & { operation: ModelPresentationOperation },
  ): Promise<ModelPresentationReceipt>;
  onChanged(listener: (owner: SettingsOwnerStamp | null) => void): () => void;
}
export const MODEL_PRESENTATION_CHANNELS = {
  get: 'host-model-presentation:get',
  importLegacy: 'host-model-presentation:import-legacy',
  mutate: 'host-model-presentation:mutate',
  changed: 'host-model-presentation:changed',
} as const;
export function emptyModelPresentationPreferences(): ModelPresentationPreferences {
  return {
    visibility: {
      overrides: {},
      initialization: {
        eligibleForDefaults: false,
        defaults: {},
        scopes: [],
        followCatalogKeys: [],
      },
    },
    engines: {},
    favorites: { uidSeq: 1, items: [] },
  };
}
export const visibilityPreferenceKey = (
  agent: AgentKind,
  provider: string,
  model: string,
): string => `${agent}:${provider}:${model}`;
export const enginePreferenceKey = (provider: string, model: string): string =>
  `${provider}:${model}`;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 2048 &&
  !/[\x00-\x1f]/.test(value);
const provider = (value: unknown): value is string => text(value) && value !== '*';
const effort = (value: unknown): value is FavoriteEffort =>
  typeof value === 'string' && (EFFORT_VALUES as readonly string[]).includes(value);
function invalid(): never {
  throw new Error('INVALID_MODEL_PRESENTATION_PREFERENCES');
}
function fields(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function strings(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 20000 || value.some((item) => !text(item))) invalid();
}
function booleanMap(value: unknown): asserts value is Record<string, boolean> {
  if (
    !object(value) ||
    Object.keys(value).length > 20000 ||
    Object.entries(value).some(([key, flag]) => !text(key) || typeof flag !== 'boolean')
  )
    invalid();
}
function initialization(value: unknown): asserts value is ModelVisibilityInitialization {
  if (!object(value)) invalid();
  fields(value, ['eligibleForDefaults', 'defaults', 'scopes', 'followCatalogKeys']);
  if (typeof value.eligibleForDefaults !== 'boolean') invalid();
  booleanMap(value.defaults);
  strings(value.scopes);
  strings(value.followCatalogKeys);
}
function config(value: unknown): asserts value is ModelFavoriteConfig {
  if (!object(value)) invalid();
  fields(value, ['providerId', 'modelId', 'agent', 'effort', 'fast']);
  if (
    !provider(value.providerId) ||
    !text(value.modelId) ||
    !isModelPresentationEngine(value.agent) ||
    (value.effort !== undefined && !effort(value.effort)) ||
    (value.fast !== undefined && value.fast !== true)
  )
    invalid();
}
/** Host 严格边界：损坏不等于空，迁移不静默删除坏行。 */
export function validateModelPresentationPreferences(
  value: unknown,
): asserts value is ModelPresentationPreferences {
  if (!object(value)) invalid();
  fields(value, ['visibility', 'engines', 'favorites']);
  if (!object(value.visibility)) invalid();
  fields(value.visibility, ['overrides', 'initialization']);
  booleanMap(value.visibility.overrides);
  initialization(value.visibility.initialization);
  if (!object(value.engines) || Object.keys(value.engines).length > 20000) invalid();
  for (const [key, entry] of Object.entries(value.engines)) {
    if (!text(key) || !object(entry)) invalid();
    fields(entry, ['agent']);
    if (!isModelPresentationEngine(entry.agent)) invalid();
  }
  if (!object(value.favorites)) invalid();
  fields(value.favorites, ['uidSeq', 'items', 'seeded']);
  if (
    !Number.isSafeInteger(value.favorites.uidSeq) ||
    Number(value.favorites.uidSeq) < 1 ||
    !Array.isArray(value.favorites.items) ||
    value.favorites.items.length > 10000 ||
    (value.favorites.seeded !== undefined && value.favorites.seeded !== true)
  )
    invalid();
  const seen = new Set<string>();
  for (const item of value.favorites.items) {
    if (!object(item) || !text(item.uid) || seen.has(item.uid)) invalid();
    const { uid, ...copy } = item;
    config(copy);
    seen.add(uid);
    if (/^fav-\d+$/.test(uid) && Number(uid.slice(4)) >= Number(value.favorites.uidSeq)) invalid();
  }
}
/** 保持界面兼容：非法 effort 仅去掉该字段，fast=false 用字段缺省表达。 */
export function normalizeModelFavoriteConfig(raw: ModelFavoriteConfig): ModelFavoriteConfig | null {
  if (
    !object(raw) ||
    typeof raw.providerId !== 'string' ||
    typeof raw.modelId !== 'string' ||
    !provider(raw.providerId.trim()) ||
    !text(raw.modelId.trim()) ||
    !isModelPresentationEngine(raw.agent)
  )
    return null;
  return {
    providerId: raw.providerId.trim(),
    modelId: raw.modelId.trim(),
    agent: raw.agent,
    ...(effort(raw.effort) ? { effort: raw.effort } : {}),
    ...(raw.fast === true ? { fast: true } : {}),
  };
}
export function modelFavoriteIdentity(value: ModelFavoriteConfig): string {
  return JSON.stringify([
    value.providerId,
    value.modelId,
    value.agent,
    value.effort ?? '',
    value.fast === true,
  ]);
}
export function validateModelPresentationOperation(
  raw: unknown,
): asserts raw is ModelPresentationOperation {
  if (!object(raw) || !text(raw.kind)) invalid();
  const route = () => {
    if (!provider(raw.providerId) || !text(raw.modelId)) invalid();
  };
  switch (raw.kind) {
    case 'reset':
      fields(raw, ['kind']);
      return;
    case 'engine-set':
      fields(raw, ['kind', 'providerId', 'modelId', 'agent']);
      route();
      if (!isModelPresentationEngine(raw.agent)) invalid();
      return;
    case 'engine-clear':
      fields(raw, ['kind', 'providerId', 'modelId']);
      route();
      return;
    case 'favorite-add':
    case 'favorite-seed':
      fields(raw, ['kind', 'config']);
      config(raw.config);
      return;
    case 'favorite-remove':
      fields(raw, ['kind', 'uid']);
      if (!text(raw.uid)) invalid();
      return;
    case 'favorite-update':
      fields(raw, ['kind', 'uid', 'patch']);
      if (!text(raw.uid) || !object(raw.patch)) invalid();
      fields(raw.patch, ['agent', 'effort', 'fast']);
      if (
        (raw.patch.agent !== undefined && !isModelPresentationEngine(raw.patch.agent)) ||
        (raw.patch.effort !== undefined &&
          raw.patch.effort !== null &&
          !effort(raw.patch.effort)) ||
        (raw.patch.fast !== undefined && typeof raw.patch.fast !== 'boolean')
      )
        invalid();
      return;
    case 'visibility-set':
    case 'visibility-reset':
      fields(
        raw,
        raw.kind === 'visibility-set'
          ? ['kind', 'providerId', 'targets', 'enabled']
          : ['kind', 'providerId', 'targets'],
      );
      if (
        !text(raw.providerId) ||
        !Array.isArray(raw.targets) ||
        raw.targets.length > 20000 ||
        (raw.kind === 'visibility-set' && typeof raw.enabled !== 'boolean')
      )
        invalid();
      for (const target of raw.targets) {
        if (!object(target)) invalid();
        fields(target, ['agent', 'modelId']);
        if (!['claude-code', 'codex', 'pi'].includes(String(target.agent)) || !text(target.modelId))
          invalid();
      }
      return;
    case 'visibility-catalog':
      fields(raw, ['kind', 'scopes']);
      if (!Array.isArray(raw.scopes) || raw.scopes.length > 2000) invalid();
      for (const scope of raw.scopes) {
        if (!object(scope)) invalid();
        fields(scope, ['providerId', 'agent', 'models', 'modelPrefixes']);
        if (
          !text(scope.providerId) ||
          !['claude-code', 'codex', 'pi'].includes(String(scope.agent)) ||
          !Array.isArray(scope.models) ||
          scope.models.length > 20000
        )
          invalid();
        strings(scope.modelPrefixes);
        for (const model of scope.models) {
          if (!object(model)) invalid();
          fields(model, ['id', 'defaultEnabled']);
          if (
            !text(model.id) ||
            (model.defaultEnabled !== undefined && typeof model.defaultEnabled !== 'boolean')
          )
            invalid();
        }
      }
      return;
    default:
      invalid();
  }
}
/** Host 与测试共用的纯更新函数，只接受已校验状态和操作。 */
export function applyModelPresentationOperation(
  state: ModelPresentationPreferences,
  op: ModelPresentationOperation,
): { value: ModelPresentationPreferences; favoriteUid?: string } {
  const next = structuredClone(state);
  const vis = next.visibility;
  const favorites = next.favorites;
  switch (op.kind) {
    case 'reset': {
      const value = emptyModelPresentationPreferences();
      // 重置明确拒绝再次投放种子，旧身份也不得回收。
      value.favorites = { uidSeq: favorites.uidSeq, items: [], seeded: true };
      return { value };
    }
    case 'visibility-set':
    case 'visibility-reset': {
      const follows = new Set(vis.initialization.followCatalogKeys);
      for (const target of op.targets) {
        const key = visibilityPreferenceKey(target.agent, op.providerId, target.modelId);
        if (op.kind === 'visibility-set') {
          vis.overrides[key] = op.enabled;
          follows.delete(key);
        } else {
          delete vis.overrides[key];
          follows.add(key);
        }
      }
      vis.initialization.followCatalogKeys = [...follows];
      break;
    }
    case 'visibility-catalog':
      for (const scope of op.scopes) {
        if (!scope.models.length) continue;
        const scopeKey = JSON.stringify([scope.providerId, scope.agent]);
        const initialize =
          vis.initialization.eligibleForDefaults && !vis.initialization.scopes.includes(scopeKey);
        for (const model of scope.models) {
          const key = visibilityPreferenceKey(scope.agent, scope.providerId, model.id);
          if (initialize) vis.initialization.defaults[key] = model.defaultEnabled !== false;
          if (
            Object.hasOwn(vis.overrides, key) ||
            vis.initialization.followCatalogKeys.includes(key)
          )
            continue;
          for (const prefix of scope.modelPrefixes) {
            if (!model.id.startsWith(prefix)) continue;
            const old = visibilityPreferenceKey(
              scope.agent,
              scope.providerId,
              model.id.slice(prefix.length),
            );
            if (Object.hasOwn(state.visibility.overrides, old))
              vis.overrides[key] = state.visibility.overrides[old]!;
            break;
          }
        }
        if (!vis.initialization.scopes.includes(scopeKey)) vis.initialization.scopes.push(scopeKey);
      }
      break;
    case 'engine-set':
      next.engines[enginePreferenceKey(op.providerId, op.modelId)] = { agent: op.agent };
      break;
    case 'engine-clear':
      delete next.engines[enginePreferenceKey(op.providerId, op.modelId)];
      break;
    case 'favorite-add':
    case 'favorite-seed': {
      if (op.kind === 'favorite-seed') {
        if (favorites.seeded) break;
        favorites.seeded = true;
        if (favorites.items.length) break;
      }
      const identity = modelFavoriteIdentity(op.config);
      const old = favorites.items.find((item) => modelFavoriteIdentity(item) === identity);
      if (old) return { value: next, favoriteUid: old.uid };
      if (favorites.uidSeq >= Number.MAX_SAFE_INTEGER) invalid();
      const uid = `fav-${favorites.uidSeq++}`;
      favorites.items.push({ uid, ...op.config });
      return { value: next, favoriteUid: uid };
    }
    case 'favorite-update': {
      const item = favorites.items.find((entry) => entry.uid === op.uid);
      if (!item) break;
      if (op.patch.agent !== undefined) item.agent = op.patch.agent;
      if ('effort' in op.patch) {
        if (op.patch.effort) item.effort = op.patch.effort;
        else delete item.effort;
      }
      if (op.patch.fast !== undefined) {
        if (op.patch.fast) item.fast = true;
        else delete item.fast;
      }
      break;
    }
    case 'favorite-remove':
      favorites.items = favorites.items.filter((item) => item.uid !== op.uid);
      break;
  }
  return { value: next };
}

function parseLegacy(raw: string | null): unknown {
  if (raw === null) return null;
  // 空串、截断或非法 JSON 是损坏证据，不是全新 profile。
  if (raw.length > 2 * 1024 * 1024) invalid();
  return JSON.parse(raw);
}
/** 消费现有登录 v3 的归属决定，本函数不执行认领。 */
export function importModelPresentationSource(
  source: LegacyModelPresentationSource,
  claim: ModelVisibilityLegacyOwnerClaim,
  localHostVisibility?: ModelVisibilityPreferences,
  localHostPendingVisibility?: ModelVisibilityPreferences,
): ModelPresentationPreferences {
  if (!claim.dataOwnerId || !claim.canWriteOwnerScoped || claim.profileOrigin === 'pending')
    invalid();
  const next = emptyModelPresentationPreferences();
  const engineRaw = parseLegacy(source.engines);
  if (source.engines !== null) {
    if (!object(engineRaw)) invalid();
    // 保留旧枚举归一化：退役或未知引擎表示跟随推荐。
    for (const [key, entry] of Object.entries(engineRaw)) {
      if (!text(key) || !object(entry) || typeof entry.agent !== 'string') invalid();
      if (isModelPresentationEngine(entry.agent))
        Object.defineProperty(next.engines, key, {
          value: { agent: entry.agent },
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
  }
  const favoriteRaw = parseLegacy(source.favorites);
  if (source.favorites !== null) {
    if (!object(favoriteRaw) || !Array.isArray(favoriteRaw.items)) invalid();
    // 迁移保留有效锚点、顺序和已有调档；仅按既有单调分配规则修复缺失或重复锚点。
    let seq =
      Number.isSafeInteger(favoriteRaw.uidSeq) && Number(favoriteRaw.uidSeq) > 0
        ? Number(favoriteRaw.uidSeq)
        : 1;
    const seen = new Set<string>();
    const parsed = favoriteRaw.items.map((raw) => {
      if (!object(raw)) invalid();
      const normalized = normalizeModelFavoriteConfig(raw as unknown as ModelFavoriteConfig);
      if (!normalized) invalid();
      const uid = text(raw.uid) && !seen.has(raw.uid) ? raw.uid : null;
      if (uid) {
        seen.add(uid);
        if (/^fav-\d+$/.test(uid)) seq = Math.max(seq, Number(uid.slice(4)) + 1);
      }
      return { normalized, uid };
    });
    next.favorites.items = parsed.map(({ normalized, uid }) => {
      if (!uid) {
        while (seen.has(`fav-${seq}`)) seq++;
        uid = `fav-${seq++}`;
        seen.add(uid);
      }
      return { uid, ...normalized };
    });
    next.favorites.uidSeq = seq;
    if (favoriteRaw.seeded === true) next.favorites.seeded = true;
    else if (favoriteRaw.seeded !== undefined && favoriteRaw.seeded !== false) invalid();
  }
  const readVisibility = (raw: {
    overrides: string | null;
    initialization: string | null;
  }): ModelVisibilityPreferences => {
    const overrides = raw.overrides === null ? {} : parseLegacy(raw.overrides);
    booleanMap(overrides);
    const init =
      raw.initialization === null
        ? emptyModelPresentationPreferences().visibility.initialization
        : parseLegacy(raw.initialization);
    // 兼容早于恢复默认墓碑和 eligibility 字段的初始化记录。
    if (object(init) && !('followCatalogKeys' in init)) init.followCatalogKeys = [];
    if (object(init) && !('eligibleForDefaults' in init)) init.eligibleForDefaults = false;
    initialization(init);
    return { overrides, initialization: init };
  };
  const vis = source.visibility;
  let target = readVisibility(vis);
  if (
    !vis.localAdoption &&
    claim.profileOrigin === 'adopted-local' &&
    claim.dataOwnerId !== 'local-v1'
  ) {
    const local = structuredClone(localHostVisibility ?? readVisibility(vis.local));
    // 本地 profile 尚在等待自身导入时，也不能丢掉它已持久化的显式增量。
    if (localHostPendingVisibility) {
      for (const key of localHostPendingVisibility.initialization.followCatalogKeys)
        delete local.overrides[key];
      Object.assign(local.overrides, localHostPendingVisibility.overrides);
      local.initialization.followCatalogKeys = [
        ...new Set([
          ...local.initialization.followCatalogKeys,
          ...localHostPendingVisibility.initialization.followCatalogKeys,
        ]),
      ].filter((key) => !Object.hasOwn(localHostPendingVisibility.overrides, key));
    }
    const prefixes = target.initialization.scopes.flatMap((scope) => {
      try {
        const value = JSON.parse(scope);
        return Array.isArray(value) &&
          value.length === 2 &&
          value.every((part) => typeof part === 'string')
          ? [`${value[1]}:${value[0]}:`]
          : [];
      } catch {
        return [];
      }
    });
    const keep = (key: string) => !prefixes.some((prefix) => key.startsWith(prefix));
    target = {
      overrides: {
        ...Object.fromEntries(
          Object.entries(local.overrides).filter(
            ([key]) => !target.initialization.followCatalogKeys.includes(key),
          ),
        ),
        ...target.overrides,
      },
      initialization: {
        eligibleForDefaults:
          local.initialization.eligibleForDefaults || target.initialization.eligibleForDefaults,
        defaults: {
          ...Object.fromEntries(
            Object.entries(local.initialization.defaults).filter(([key]) => keep(key)),
          ),
          ...target.initialization.defaults,
        },
        scopes: [...new Set([...local.initialization.scopes, ...target.initialization.scopes])],
        followCatalogKeys: [
          ...new Set([
            ...local.initialization.followCatalogKeys.filter(keep),
            ...target.initialization.followCatalogKeys,
          ]),
        ],
      },
    };
  } else if (!vis.migrationComplete) {
    if (!claim.claimedByOtherOwner) {
      if (!claim.claimed || !claim.canInitialize) invalid();
      const legacy = vis.legacy === null ? {} : parseLegacy(vis.legacy);
      booleanMap(legacy);
      // 旧 owner 的恢复默认同样是明确选择，不能被待导入的全局开关复活。
      // 若旧目标仍有显式 override，保留它，兼容墓碑已写入但删除尚未成功的状态。
      const follows = new Set(target.initialization.followCatalogKeys);
      target.overrides = {
        ...Object.fromEntries(Object.entries(legacy).filter(([key]) => !follows.has(key))),
        ...target.overrides,
      };
    }
    if (vis.initialization === null)
      target.initialization.eligibleForDefaults =
        claim.profileOrigin === 'new' &&
        vis.overrides === null &&
        !vis.defaultsMigration &&
        !source.hasProviderHistory &&
        !Object.keys(next.engines).length &&
        !next.favorites.items.length &&
        !(claim.claimed && !claim.claimedByOtherOwner && vis.legacy !== null);
  }
  next.visibility = target;
  validateModelPresentationPreferences(next);
  return next;
}

export function validateLegacyModelPresentationSource(
  raw: unknown,
): asserts raw is LegacyModelPresentationSource {
  if (!object(raw)) invalid();
  fields(raw, ['visibility', 'engines', 'favorites', 'hasProviderHistory']);
  const json = (value: unknown) => {
    if (value !== null && (typeof value !== 'string' || value.length > 2 * 1024 * 1024)) invalid();
  };
  json(raw.engines);
  json(raw.favorites);
  if (typeof raw.hasProviderHistory !== 'boolean' || !object(raw.visibility)) invalid();
  const vis = raw.visibility;
  fields(vis, [
    'overrides',
    'initialization',
    'migrationComplete',
    'defaultsMigration',
    'localAdoption',
    'legacy',
    'local',
  ]);
  json(vis.overrides);
  json(vis.initialization);
  json(vis.legacy);
  for (const key of ['migrationComplete', 'defaultsMigration', 'localAdoption'])
    if (typeof vis[key] !== 'boolean') invalid();
  if (!object(vis.local)) invalid();
  fields(vis.local, ['overrides', 'initialization']);
  json(vis.local.overrides);
  json(vis.local.initialization);
}
