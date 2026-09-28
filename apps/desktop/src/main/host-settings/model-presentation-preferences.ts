import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { dataOwnerStorageKey } from '../appSessionState.js';
import { createLogger } from '../logger.js';
import { withCrossProcessLock } from '../device-link/crossProcessLock.js';
import { claimLegacyModelVisibilityOwner } from '../maker-host/model-visibility-owner-claim.js';
import {
  createOverrideSettingsFile,
  OverrideSettingsError,
} from '../maker-host/override-settings-file.js';
import type { SettingsOwnerStamp } from '../../shared/hostSettings.js';
import type { ModelVisibilityLegacyOwnerClaim } from '../../shared/modelVisibility.js';
import {
  applyModelPresentationOperation,
  emptyModelPresentationPreferences,
  importModelPresentationSource,
  validateLegacyModelPresentationSource,
  validateModelPresentationOperation,
  validateModelPresentationPreferences,
  type LegacyModelPresentationSource,
  type ModelPresentationOperation,
  type ModelPresentationPreferences,
  type ModelPresentationPreferencesSnapshot,
  type ModelPresentationReceipt,
  type ModelPresentationRequest,
} from '../../shared/modelPresentationPreferences.js';
import { currentSettingsOwner } from './personalization.js';

interface StoredPreferences {
  _initialized: boolean;
  preferences: ModelPresentationPreferences;
}
interface Dependencies {
  getOwner(): SettingsOwnerStamp | null;
  filePath(ownerId: string): string;
  /** 仅显式可信本机导入或 pending 增量校验调用；inspect/get/projection 不调用。 */
  getLegacyClaim(): ModelVisibilityLegacyOwnerClaim;
}
const defaults = (): StoredPreferences => ({
  _initialized: false,
  preferences: emptyModelPresentationPreferences(),
});
function validate(raw: Record<string, unknown>): void {
  if (Object.keys(raw).some((key) => !['_initialized', 'preferences'].includes(key)))
    throw new Error('INVALID_MODEL_PRESENTATION_STORE');
  if (raw._initialized !== undefined && typeof raw._initialized !== 'boolean')
    throw new Error('INVALID_MODEL_PRESENTATION_STORE');
  if (raw.preferences !== undefined) {
    validateModelPresentationPreferences(raw.preferences);
    // 尚未导入时仅可保存用户显式 visibility 增量，绝不假称三个来源已导入。
    if (raw._initialized !== true) {
      const pending = raw.preferences as ModelPresentationPreferences;
      if (
        Object.keys(pending.engines).length ||
        JSON.stringify(pending.favorites) !== JSON.stringify(defaults().preferences.favorites)
      )
        throw new Error('INVALID_MODEL_PRESENTATION_STORE');
    }
  }
  if (raw._initialized === true && raw.preferences === undefined)
    throw new Error('INVALID_MODEL_PRESENTATION_STORE');
}
function sameOwner(a: SettingsOwnerStamp | null, b: SettingsOwnerStamp): boolean {
  return !!a && a.dataOwnerId === b.dataOwnerId && a.ownerGeneration === b.ownerGeneration;
}
/** 三个 owner 偏好轴共用一个原子初始化标记与 CAS 边界。 */
export function createModelPresentationPreferencesStore(deps: Dependencies) {
  const assertOwner = (owner: SettingsOwnerStamp) => {
    if (!owner.dataOwnerId || !sameOwner(deps.getOwner(), owner))
      throw new OverrideSettingsError('SCOPE_CHANGED');
  };
  const file = () => {
    const owner = deps.getOwner();
    if (!owner?.dataOwnerId) throw new OverrideSettingsError('SCOPE_CHANGED');
    return deps.filePath(owner.dataOwnerId);
  };
  const makeFile = (filePath: () => string, scopeKey: () => string) =>
    createOverrideSettingsFile<StoredPreferences>({
      filePath,
      scopeKey,
      defaults,
      normalize: (raw) => ({ ...defaults(), ...(raw as StoredPreferences) }),
      validateOverrides: validate,
      atomicOnly: true,
      preserveUnreadableFile: true,
      maxBytes: 4 * 1024 * 1024,
      log: createLogger('host-model-presentation'),
      label: 'model-presentation',
    });
  const store = makeFile(file, () => JSON.stringify(deps.getOwner()));
  const inspect = (): ModelPresentationPreferencesSnapshot => {
    const owner = deps.getOwner();
    if (!owner?.dataOwnerId) return { status: 'unavailable', revision: null, ownerStamp: null };
    try {
      const state = store.inspect();
      assertOwner(owner);
      if (state.status !== 'ready') return { ...state, ownerStamp: owner };
      return {
        status: state.value._initialized ? 'ready' : 'pending-migration',
        initialized: state.value._initialized,
        ownerStamp: owner,
        revision: state.revision,
        value: state.value.preferences,
      };
    } catch {
      return { status: 'unavailable', revision: null, ownerStamp: null };
    }
  };
  const importLegacy = async (
    request: ModelPresentationRequest & { source: LegacyModelPresentationSource },
    assertCaller: () => void = () => {},
  ): Promise<ModelPresentationPreferencesSnapshot> => {
    validateLegacyModelPresentationSource(request.source);
    const owner = request.ownerStamp;
    const assertCurrent = () => {
      assertCaller();
      assertOwner(owner);
    };
    assertCurrent();
    const claim = deps.getLegacyClaim();
    if (!sameOwner(claim, owner) || !claim.canWriteOwnerScoped)
      throw new OverrideSettingsError('SCOPE_CHANGED');
    const commit = async () => {
      await store.commitAtomic(
        (state) => {
          // 重置或成功导入后永不重导，即使浏览器旧键仍存在。
          if (state.value._initialized) return {};
          const currentClaim = deps.getLegacyClaim();
          if (!sameOwner(currentClaim, owner) || !currentClaim.canWriteOwnerScoped)
            throw new OverrideSettingsError('SCOPE_CHANGED');
          let localVisibility;
          let localPendingVisibility;
          if (
            !request.source.visibility.localAdoption &&
            currentClaim.profileOrigin === 'adopted-local' &&
            owner.dataOwnerId !== 'local-v1'
          ) {
            // 登录 v3 已确认收养；优先本地 Host 正本而非迁移前的浏览器旧副本。
            // 不收养 engine/favorites：二者原来没有这个规则。
            const local = makeFile(
              () => deps.filePath('local-v1'),
              () => 'local-v1',
            ).inspect();
            if (local.status !== 'ready') throw new OverrideSettingsError('UNREADABLE');
            if (local.value._initialized) localVisibility = local.value.preferences.visibility;
            else localPendingVisibility = local.value.preferences.visibility;
          }
          const preferences = importModelPresentationSource(
            request.source,
            currentClaim,
            localVisibility,
            localPendingVisibility,
          );
          // 等待 legacy 归属期间保存的 Host 增量优先，恢复默认墓碑阻止旧开关复活。
          const pending = state.value.preferences.visibility;
          for (const key of pending.initialization.followCatalogKeys)
            delete preferences.visibility.overrides[key];
          Object.assign(preferences.visibility.overrides, pending.overrides);
          preferences.visibility.initialization.followCatalogKeys = [
            ...new Set([
              ...preferences.visibility.initialization.followCatalogKeys,
              ...pending.initialization.followCatalogKeys,
            ]),
          ].filter((key) => !Object.hasOwn(pending.overrides, key));
          return { set: { preferences, _initialized: true } };
        },
        { expectedRevision: request.expectedRevision, assertCurrent },
      );
      assertCurrent();
      return inspect();
    };
    if (
      !request.source.visibility.localAdoption &&
      claim.profileOrigin === 'adopted-local' &&
      owner.dataOwnerId !== 'local-v1'
    ) {
      // 源与目标在同一段操作中保持稳定；本地写入者不获取 cloud 锁。
      fs.mkdirSync(path.dirname(deps.filePath('local-v1')), { recursive: true });
      return withCrossProcessLock(
        `${deps.filePath('local-v1')}.lock`,
        { label: 'model-presentation-adoption', waitMs: 12000 },
        async (lock) => {
          if (!lock.held) throw new OverrideSettingsError('BUSY');
          return commit();
        },
      );
    }
    return commit();
  };
  const mutate = async (
    request: ModelPresentationRequest & { operation: ModelPresentationOperation },
    assertCaller: () => void = () => {},
  ): Promise<ModelPresentationReceipt> => {
    validateModelPresentationOperation(request.operation);
    const owner = request.ownerStamp;
    const assertCurrent = () => {
      assertCaller();
      assertOwner(owner);
    };
    assertCurrent();
    let favoriteUid: string | undefined;
    await store.commitAtomic(
      (state) => {
        const initialized = state.value._initialized || request.operation.kind === 'reset';
        if (!initialized) {
          if (!['visibility-set', 'visibility-reset'].includes(request.operation.kind))
            throw new OverrideSettingsError('UNREADABLE');
          const claim = deps.getLegacyClaim();
          if (
            !sameOwner(claim, owner) ||
            !claim.canWriteOwnerScoped ||
            claim.profileOrigin === 'pending'
          )
            throw new OverrideSettingsError('SCOPE_CHANGED');
        }
        const applied = applyModelPresentationOperation(state.value.preferences, request.operation);
        validateModelPresentationPreferences(applied.value);
        favoriteUid = applied.favoriteUid;
        if (
          state.value._initialized &&
          JSON.stringify(applied.value) === JSON.stringify(state.value.preferences)
        )
          return {};
        return { set: { preferences: applied.value, _initialized: initialized } };
      },
      { expectedRevision: request.expectedRevision, assertCurrent },
    );
    assertCurrent();
    return { snapshot: inspect(), ...(favoriteUid ? { favoriteUid } : {}) };
  };
  const commitHostPreferences = async (
    transform: (current: ModelPresentationPreferences) => ModelPresentationPreferences,
    options: import('../maker-host/override-settings-file.js').OverrideSettingsCommitOptions,
  ) => {
    const result = await store.commitAtomic(state => {
      if (!state.value._initialized) throw new OverrideSettingsError('UNREADABLE');
      const value = transform(structuredClone(state.value.preferences));
      validateModelPresentationPreferences(value);
      return { set: { preferences: value } };
    }, options);
    return { ...result, value: result.value.preferences };
  };
  return { inspect, importLegacy, mutate, commitHostPreferences, onChanged: store.onChanged };
}
const preferences = createModelPresentationPreferencesStore({
  getOwner: currentSettingsOwner,
  // 检查路径不回退 getActiveAppSession，也不触发 legacy 修复。
  filePath: (ownerId) =>
    path.join(
      app.getPath('userData'),
      'owners',
      dataOwnerStorageKey(ownerId),
      'host-model-presentation-preferences.json',
    ),
  getLegacyClaim: claimLegacyModelVisibilityOwner,
});
/** 无副作用本机原始状态；原始 ID 属于私有数据，不可直接序列化为云报告。 */
export const inspectModelPresentationPreferences = preferences.inspect;
export const importLegacyModelPresentationPreferences = preferences.importLegacy;
export const mutateModelPresentationPreferences = preferences.mutate;
export const onModelPresentationPreferencesChanged = preferences.onChanged;

export const commitHostModelPresentationPreferences = preferences.commitHostPreferences;
