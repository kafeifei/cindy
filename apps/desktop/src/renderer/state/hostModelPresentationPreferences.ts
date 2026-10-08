import {
  emptyModelPresentationPreferences,
  type LegacyModelPresentationSource,
  type ModelPresentationOperation,
  type ModelPresentationPreferencesApi,
  type ModelPresentationPreferencesSnapshot,
  type ModelPresentationReceipt,
} from '../../shared/modelPresentationPreferences';
import type { ModelVisibilityLegacyOwnerClaim } from '../../shared/modelVisibility';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '../contexts/dataOwnerGeneration';
import { hasAnyProviderModelOverride, hasProviderModelHistory } from './providerModelMemory';
import { toast } from '../lib/toast';
import i18n from 'i18next';

const EMPTY = emptyModelPresentationPreferences();
const listeners = new Set<() => void>();
let version = 0;
interface Connection {
  owner: ReturnType<typeof getDataOwnerGeneration>;
  stopped: boolean;
  snapshot: ModelPresentationPreferencesSnapshot | null;
  ready: Promise<void>;
  retryMigration: () => Promise<void>;
  write: (
    operation: ModelPresentationOperation,
    isCurrent?: () => boolean,
  ) => Promise<ModelPresentationReceipt | null>;
  stop: () => void;
}
let connection: Connection | null = null;
const current = (state: Connection) =>
  !state.stopped && connection === state && isDataOwnerGenerationCurrent(state.owner);
function emit(): void {
  version++;
  for (const listener of listeners) listener();
}
export function subscribeHostModelPresentation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getHostModelPresentationVersion(): number {
  return version;
}
export function getHostModelPresentationSnapshot(): ModelPresentationPreferencesSnapshot | null {
  return connection && current(connection) ? connection.snapshot : null;
}
export function getHostModelPresentationValue() {
  const snapshot = getHostModelPresentationSnapshot();
  return snapshot?.status === 'ready' ? snapshot.value : EMPTY;
}
/** 普通偏好读取和写入不访问 localStorage。 */
export function invalidateHostModelPresentationOwner(): void {
  if (connection && !current(connection)) {
    connection.stop();
    connection = null;
    emit();
  }
}
function captureLegacy(ownerId: string, generation: number): LegacyModelPresentationSource | null {
  const claim: ModelVisibilityLegacyOwnerClaim | undefined =
    window.electronAPI?.maker?.claimLegacyModelVisibilityOwner?.();
  if (
    !claim ||
    claim.dataOwnerId !== ownerId ||
    claim.ownerGeneration !== generation ||
    !claim.canWriteOwnerScoped ||
    claim.profileOrigin === 'pending'
  )
    return null;
  const storage = window.localStorage;
  const key = 'xdt:modelVisibilityPrefs:v1';
  const suffix = encodeURIComponent(ownerId);
  const migrationComplete = storage.getItem(`${key}.migration-complete.owner.${suffix}`) === '1';
  const localAdoption = storage.getItem(`${key}.local-adoption.owner.${suffix}`) === '1';
  const adopt = ownerId !== 'local-v1' && claim.profileOrigin === 'adopted-local' && !localAdoption;
  // 稳定隔离键不等于旧全局来源已认领，禁止猜测旧数据归属。
  if (
    !adopt &&
    !migrationComplete &&
    !claim.claimedByOtherOwner &&
    ((!claim.claimed || !claim.canInitialize) && storage.getItem(key) !== null)
  )
    return null;
  return {
    visibility: {
      overrides: storage.getItem(`${key}.owner.${suffix}`),
      initialization: storage.getItem(`${key}.initialization.owner.${suffix}`),
      migrationComplete,
      localAdoption,
      defaultsMigration: storage.getItem(`${key}.defaults-migration.v1.owner.${suffix}`) !== null,
      legacy:
        !adopt &&
        !migrationComplete &&
        claim.claimed &&
        claim.canInitialize &&
        !claim.claimedByOtherOwner
          ? storage.getItem(key)
          : null,
      local: adopt
        ? {
            overrides: storage.getItem(`${key}.owner.local-v1`),
            initialization: storage.getItem(`${key}.initialization.owner.local-v1`),
          }
        : { overrides: null, initialization: null },
    },
    // 这两个轴没有旧全局或 adopt-local 规则，此处不新增。
    engines: storage.getItem(`xdt:modelEnginePrefs:v1:${suffix}`),
    favorites: storage.getItem(`xdt:modelFavorites:v1:${suffix}`),
    hasProviderHistory: hasAnyProviderModelOverride() || hasProviderModelHistory(),
  };
}
function nativeApi(): ModelPresentationPreferencesApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    window.electronAPI as typeof window.electronAPI & {
      modelPresentationPreferences?: ModelPresentationPreferencesApi;
    }
  )?.modelPresentationPreferences;
}
/** 一个 owner/generation 对应一条连接；所有调用等待 Host 持久回执，冲突只回读。 */
export function connectHostModelPresentationPreferences(): () => void {
  const owner = getDataOwnerGeneration();
  if (connection && current(connection)) {
    const existing = connection;
    return () => {
      if (connection === existing) {
        existing.stop();
        connection = null;
        emit();
      }
    };
  }
  connection?.stop();
  connection = null;
  emit();
  const api = nativeApi();
  if (!api || !owner.dataOwnerId) return () => {};
  let readSequence = 0;
  let writeEpoch = 0;
  let writing = false;
  let dirty = false;
  let queue = Promise.resolve();
  const state: Connection = {
    owner,
    stopped: false,
    snapshot: null,
    ready: Promise.resolve(),
    retryMigration: async () => {},
    write: async () => null,
    stop: () => {},
  };
  let failedImport: { evidence: string; revision: string } | null = null;
  connection = state;
  const belongs = (snapshot: ModelPresentationPreferencesSnapshot) =>
    current(state) &&
    !!snapshot.ownerStamp &&
    snapshot.ownerStamp.dataOwnerId === owner.dataOwnerId &&
    snapshot.ownerStamp.ownerGeneration === owner.generation;
  const accept = (snapshot: ModelPresentationPreferencesSnapshot) => {
    if (!belongs(snapshot)) return false;
    const changed = JSON.stringify(state.snapshot) !== JSON.stringify(snapshot);
    state.snapshot = snapshot;
    if (changed) emit();
    return true;
  };
  const reload = async () => {
    const sequence = ++readSequence;
    try {
      const snapshot = await api.get();
      if (sequence === readSequence && !writing && current(state)) {
        dirty = false;
        accept(snapshot);
      }
    } catch {
      if (sequence === readSequence && current(state)) {
        state.snapshot = null;
        emit();
      }
    }
  };
  const loadAndImport = async () => {
    writing = true;
    ++readSequence;
    try {
      let snapshot = await api.get();
      if (!belongs(snapshot)) return;
      if (snapshot.status === 'pending-migration') {
        const source = captureLegacy(owner.dataOwnerId!, owner.generation);
        const evidence = JSON.stringify(source);
        // 同一损失输入不能换 revision 重放；来源修复后必须重新捕获证据。
        const stale =
          failedImport?.evidence === evidence && failedImport.revision !== snapshot.revision;
        if (source && current(state) && !stale) {
          const attempt = { evidence, revision: snapshot.revision };
          try {
            snapshot = await api.importLegacy({
              ownerStamp: snapshot.ownerStamp,
              expectedRevision: snapshot.revision,
              source,
            });
            failedImport = null;
          } catch {
            failedImport = attempt;
            snapshot = await api.get();
          }
        }
      }
      accept(snapshot);
    } catch {
      if (current(state)) {
        state.snapshot = null;
        emit();
      }
    } finally {
      writing = false;
      if (dirty && current(state)) await reload();
    }
  };
  state.ready = loadAndImport();
  state.retryMigration = () => {
    const work = queue.then(async () => {
      await state.ready;
      if (current(state) && state.snapshot?.status === 'pending-migration') await loadAndImport();
    });
    queue = work.catch(() => {});
    return work;
  };
  state.write = (operation, extraCurrent = () => true) => {
    const epoch = writeEpoch;
    let result: ModelPresentationReceipt | null = null;
    const work = queue.then(async () => {
      await state.ready;
      if (!current(state) || !extraCurrent() || epoch !== writeEpoch) return;
      if (dirty) await reload();
      const snapshot = state.snapshot;
      const pendingEdit = ['reset', 'visibility-set', 'visibility-reset'].includes(operation.kind);
      if (
        !snapshot ||
        (snapshot.status !== 'ready' && !(pendingEdit && snapshot.status === 'pending-migration'))
      )
        return;
      writing = true;
      ++readSequence;
      try {
        const receipt = await api.mutate({
          ownerStamp: snapshot.ownerStamp,
          expectedRevision: snapshot.revision,
          operation,
        });
        if (
          current(state) &&
          extraCurrent() &&
          accept(receipt.snapshot) &&
          (receipt.snapshot.status === 'ready' ||
            (pendingEdit && receipt.snapshot.status === 'pending-migration'))
        )
          result = receipt;
      } catch {
        writeEpoch++; // 同时丢弃基于失败快照的排队编辑。
        dirty = true;
        if (current(state)) toast.error(i18n.t('hostSettings.saveFailed'));
      } finally {
        writing = false;
        if (dirty && current(state)) await reload();
      }
    });
    queue = work.catch(() => {});
    return work.then(
      () => result,
      () => null,
    );
  };
  const off = api.onChanged((stamp) => {
    if (
      !current(state) ||
      stamp?.dataOwnerId !== owner.dataOwnerId ||
      stamp.ownerGeneration !== owner.generation
    )
      return;
    dirty = true;
    if (!writing) void state.ready.then(() => reload());
  });
  state.stop = () => {
    state.stopped = true;
    ++readSequence;
    ++writeEpoch;
    off();
  };
  return () => {
    state.stop();
    if (connection === state) {
      connection = null;
      emit();
    }
  };
}
export async function ensureHostModelPresentationLoaded(): Promise<void> {
  if (!connection || !current(connection)) connectHostModelPresentationPreferences();
  await connection?.ready;
}
/** 只由明确的目录刷新触发，重新捕获已合法归属的来源；普通写入不自动重放失败导入。 */
export async function retryHostModelPresentationMigration(): Promise<void> {
  await connection?.retryMigration();
}
export async function commitHostModelPresentation(
  operation: ModelPresentationOperation,
  isCurrent?: () => boolean,
): Promise<ModelPresentationReceipt | null> {
  const owner = getDataOwnerGeneration();
  await ensureHostModelPresentationLoaded();
  const state = connection;
  if (!isDataOwnerGenerationCurrent(owner) || !state || !current(state)) return null;
  return state.write(operation, isCurrent);
}
export function __resetHostModelPresentationForTest(): void {
  connection?.stop();
  connection = null;
  version = 0;
  listeners.clear();
}
