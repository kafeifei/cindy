import { vi } from 'vitest';
import {
  applyModelPresentationOperation,
  emptyModelPresentationPreferences,
  importModelPresentationSource,
  validateModelPresentationOperation,
  type ModelPresentationPreferencesApi,
  type ModelPresentationPreferences,
  type ModelPresentationPreferencesSnapshot,
} from '../../shared/modelPresentationPreferences';
import { setDataOwnerGeneration } from '../contexts/dataOwnerGeneration';
import type { ModelVisibilityLegacyOwnerClaim } from '../../shared/modelVisibility';

/** 进程内 Host fixture；测试只使用假身份，浏览器旧键永不作为新写入正本。 */
export function createModelPresentationTestHost(storage: Storage) {
  let ownerId: string | null = 'owner-a';
  let generation = 1;
  const files = new Map<
    string,
    { value: ModelPresentationPreferences; initialized: boolean; revision: number }
  >();
  const listeners = new Set<Parameters<ModelPresentationPreferencesApi['onChanged']>[0]>();
  const claim: {
    -readonly [Key in keyof ModelVisibilityLegacyOwnerClaim]: ModelVisibilityLegacyOwnerClaim[Key];
  } = {
    dataOwnerId: ownerId,
    ownerGeneration: generation,
    canWriteOwnerScoped: true,
    claimed: true,
    claimedByOtherOwner: false,
    canInitialize: true,
    profileOrigin: 'new',
  };
  const options = {
    failRead: false,
    failWrite: false,
    unreadable: false,
    beforeWrite: null as null | (() => Promise<void>),
  };
  const stamp = () => ({ dataOwnerId: ownerId, ownerGeneration: generation });
  const state = () => {
    let entry = files.get(ownerId!);
    if (!entry) {
      entry = { value: emptyModelPresentationPreferences(), initialized: false, revision: 0 };
      files.set(ownerId!, entry);
    }
    return entry;
  };
  const snapshot = (): ModelPresentationPreferencesSnapshot => {
    if (options.failRead) throw new Error('read failed');
    if (!ownerId) return { status: 'unavailable', revision: null, ownerStamp: null };
    if (options.unreadable) return { status: 'unreadable', revision: null, ownerStamp: stamp() };
    const entry = state();
    return {
      status: entry.initialized ? 'ready' : 'pending-migration',
      revision: `${ownerId}:${generation}:${entry.revision}`,
      initialized: entry.initialized,
      ownerStamp: stamp(),
      value: structuredClone(entry.value),
    };
  };
  const assert = (request: {
    ownerStamp: { dataOwnerId: string | null; ownerGeneration: number };
    expectedRevision: string;
  }) => {
    if (options.failWrite) throw new Error('write failed');
    const current = snapshot();
    if (
      current.status === 'unreadable' ||
      current.status === 'unavailable' ||
      request.ownerStamp.dataOwnerId !== ownerId ||
      request.ownerStamp.ownerGeneration !== generation ||
      current.revision !== request.expectedRevision
    )
      throw new Error('conflict');
  };
  const publish = () => {
    for (const listener of listeners) listener(stamp());
  };
  const api: ModelPresentationPreferencesApi = {
    get: vi.fn(async () => snapshot()),
    importLegacy: vi.fn(async (request) => {
      if (options.beforeWrite) await options.beforeWrite();
      assert(request);
      const entry = state();
      if (!entry.initialized) {
        const value = importModelPresentationSource(request.source, claim);
        for (const key of entry.value.visibility.initialization.followCatalogKeys)
          delete value.visibility.overrides[key];
        Object.assign(value.visibility.overrides, entry.value.visibility.overrides);
        value.visibility.initialization.followCatalogKeys = [
          ...new Set([
            ...value.visibility.initialization.followCatalogKeys,
            ...entry.value.visibility.initialization.followCatalogKeys,
          ]),
        ].filter((key) => !Object.hasOwn(entry.value.visibility.overrides, key));
        entry.value = value;
        entry.initialized = true;
        entry.revision++;
        publish();
      }
      return snapshot();
    }),
    mutate: vi.fn(async (request) => {
      validateModelPresentationOperation(request.operation);
      if (options.beforeWrite) await options.beforeWrite();
      assert(request);
      const entry = state();
      const initialized = entry.initialized || request.operation.kind === 'reset';
      if (
        !initialized &&
        (!['visibility-set', 'visibility-reset'].includes(request.operation.kind) ||
          !claim.canWriteOwnerScoped ||
          claim.profileOrigin === 'pending')
      )
        throw new Error('pending');
      const result = applyModelPresentationOperation(entry.value, request.operation);
      if (
        entry.initialized !== initialized ||
        JSON.stringify(entry.value) !== JSON.stringify(result.value)
      ) {
        entry.value = result.value;
        entry.initialized = initialized;
        entry.revision++;
        publish();
      }
      return { snapshot: snapshot(), favoriteUid: result.favoriteUid };
    }),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const select = (id: string | null, nextGeneration = generation + 1) => {
    ownerId = id;
    generation = nextGeneration;
    Object.assign(claim, stamp());
    setDataOwnerGeneration(id, generation);
  };
  const install = () => {
    setDataOwnerGeneration(ownerId, generation);
    const electronAPI = {
      ...(typeof window !== 'undefined' ? window.electronAPI : {}),
      modelPresentationPreferences: api,
      maker: {
        ...(typeof window !== 'undefined' ? window.electronAPI?.maker : {}),
        claimLegacyModelVisibilityOwner: () => claim,
      },
    };
    if (typeof window !== 'undefined')
      Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        writable: true,
        value: electronAPI,
      });
    else vi.stubGlobal('window', { localStorage: storage, electronAPI });
  };
  return {
    api,
    claim,
    options,
    files,
    select,
    install,
    snapshot,
    publish,
    initialized(value = emptyModelPresentationPreferences()) {
      files.set(ownerId!, { value: structuredClone(value), initialized: true, revision: 1 });
    },
  };
}
export class PreferenceMemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
}
