import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModelPresentationPreferencesStore } from '../model-presentation-preferences';
import { withCrossProcessLock } from '../../device-link/crossProcessLock';
import type { SettingsOwnerStamp } from '../../../shared/hostSettings';
import type {
  LegacyModelPresentationSource,
  ModelPresentationOperation,
} from '../../../shared/modelPresentationPreferences';
import type { ModelVisibilityLegacyOwnerClaim } from '../../../shared/modelVisibility';

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('real profile forbidden');
    },
  },
  ipcMain: { on: vi.fn() },
}));
vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../appSessionState', () => ({ dataOwnerStorageKey: (id: string) => id }));
vi.mock('../../maker-host/model-visibility-owner-claim', () => ({
  claimLegacyModelVisibilityOwner: () => {
    throw new Error('real claim forbidden');
  },
}));
vi.mock('../personalization', () => ({ currentSettingsOwner: () => null }));
let root: string;
let owner: SettingsOwnerStamp | null;
let origin: ModelVisibilityLegacyOwnerClaim['profileOrigin'];
let claimCalls: number;
let canInitialize: boolean;
const file = (id: string) => path.join(root, id, 'preferences.json');
const create = () =>
  createModelPresentationPreferencesStore({
    filePath: file,
    getOwner: () => owner,
    getLegacyClaim: () => {
      claimCalls++;
      return {
        ...owner!,
        profileOrigin: origin,
        canWriteOwnerScoped: true,
        claimed: true,
        claimedByOtherOwner: false,
        canInitialize,
      };
    },
  });
const source = (): LegacyModelPresentationSource => ({
  visibility: {
    overrides: null,
    initialization: null,
    migrationComplete: false,
    defaultsMigration: false,
    localAdoption: false,
    legacy: null,
    local: { overrides: null, initialization: null },
  },
  engines: null,
  favorites: null,
  hasProviderHistory: false,
});
const config = {
  providerId: 'example',
  modelId: 'model',
  agent: 'pi' as const,
  effort: 'high' as const,
  fast: true as const,
};
function request(store: ReturnType<typeof create>) {
  const snapshot = store.inspect();
  if (snapshot.status !== 'ready' && snapshot.status !== 'pending-migration')
    throw new Error('not inspectable');
  return { ownerStamp: snapshot.ownerStamp, expectedRevision: snapshot.revision };
}
async function initialize(store: ReturnType<typeof create>, legacy = source()) {
  return store.importLegacy({ ...request(store), source: legacy });
}
async function mutate(store: ReturnType<typeof create>, operation: ModelPresentationOperation) {
  return store.mutate({ ...request(store), operation });
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-presentation-'));
  owner = { dataOwnerId: 'owner-a', ownerGeneration: 1 };
  origin = 'new';
  claimCalls = 0;
  canInitialize = true;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Host owner model preferences', () => {
  it('inspect is pure: no renderer, claim, directory creation or repair, and missing is pending', () => {
    const store = create();
    expect(store.inspect().status).toBe('pending-migration');
    expect(claimCalls).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
    fs.mkdirSync(path.dirname(file('owner-a')));
    fs.writeFileSync(file('owner-a'), '{bad');
    expect(store.inspect().status).toBe('unreadable');
    expect(fs.readFileSync(file('owner-a'), 'utf8')).toBe('{bad');
    expect(claimCalls).toBe(0);
    owner = null;
    expect(store.inspect().status).toBe('unavailable');
  });
  it('imports all axes atomically and survives restart with explicit false, order, identities, tuning and seed tombstone', async () => {
    const store = create();
    const legacy = source();
    legacy.visibility.overrides = JSON.stringify({
      'pi:example:model': false,
      'codex:example:model': true,
    });
    legacy.visibility.initialization = JSON.stringify({
      eligibleForDefaults: true,
      defaults: { 'pi:example:model': true },
      scopes: ['["example","pi"]'],
      followCatalogKeys: ['pi:example:restored'],
    });
    legacy.engines = JSON.stringify({ 'example:model': { agent: 'cc' } });
    legacy.favorites = JSON.stringify({
      uidSeq: 12,
      seeded: true,
      items: [
        { uid: 'fav-7', ...config },
        { uid: 'fav-4', ...config, effort: 'low', fast: undefined },
      ],
    });
    const migrated = await initialize(store, legacy);
    expect(migrated.status).toBe('ready');
    if (migrated.status !== 'ready') throw new Error();
    const restart = create().inspect();
    expect(restart).toEqual(migrated);
    expect(migrated.value.visibility.overrides).toEqual({
      'pi:example:model': false,
      'codex:example:model': true,
    });
    expect(migrated.value.visibility.initialization.followCatalogKeys).toEqual([
      'pi:example:restored',
    ]);
    expect(migrated.value.favorites).toEqual(JSON.parse(legacy.favorites!));
    expect(migrated.value.engines['example:model']?.agent).toBe('cc');
    expect(claimCalls).toBe(2);
  });
  it('首次导入旧全局表时保留旧owner恢复默认墓碑及显式目标覆盖', async () => {
    const store = create();
    const legacy = source();
    legacy.visibility.legacy = JSON.stringify({
      'pi:example:restored-off': false,
      'pi:example:restored-on': true,
      'pi:example:manual': false,
      'pi:example:inherited': false,
      'pi:example:unfinished-reset': true,
      'codex:example:restored-off': false,
    });
    legacy.visibility.overrides = JSON.stringify({
      'pi:example:manual': true,
      'pi:example:unfinished-reset': false,
    });
    legacy.visibility.initialization = JSON.stringify({
      eligibleForDefaults: false,
      defaults: { 'pi:example:restored-off': false },
      scopes: ['["example","pi"]'],
      followCatalogKeys: [
        'pi:example:restored-off',
        'pi:example:restored-on',
        'pi:example:unfinished-reset',
      ],
    });
    const originalSource = JSON.stringify(legacy);
    const imported = await initialize(store, legacy);
    if (imported.status !== 'ready') throw new Error();
    expect(imported.initialized).toBe(true);
    expect(imported.value.visibility.overrides).toEqual({
      'pi:example:manual': true,
      'pi:example:inherited': false,
      'pi:example:unfinished-reset': false,
      'codex:example:restored-off': false,
    });
    expect(imported.value.visibility.initialization).toEqual(JSON.parse(legacy.visibility.initialization));
    expect(JSON.stringify(legacy)).toBe(originalSource);
    expect(create().inspect()).toEqual(imported);
    const bytes = fs.readFileSync(file('owner-a'), 'utf8');
    expect(await initialize(create(), legacy)).toEqual(imported);
    expect(fs.readFileSync(file('owner-a'), 'utf8')).toBe(bytes);
  });
  it('Host等待期的新显式覆盖仍优先于旧owner墓碑', async () => {
    const store = create();
    canInitialize = false;
    await mutate(store, {
      kind: 'visibility-set',
      providerId: 'example',
      targets: [{ agent: 'pi', modelId: 'restored' }],
      enabled: false,
    });
    const legacy = source();
    legacy.visibility.legacy = JSON.stringify({ 'pi:example:restored': true });
    legacy.visibility.initialization = JSON.stringify({
      eligibleForDefaults: false,
      defaults: {},
      scopes: [],
      followCatalogKeys: ['pi:example:restored'],
    });
    canInitialize = true;
    const imported = await initialize(store, legacy);
    if (imported.status !== 'ready') throw new Error();
    expect(imported.value.visibility.overrides).toEqual({ 'pi:example:restored': false });
    expect(imported.value.visibility.initialization.followCatalogKeys).toEqual([]);
  });
  it.each(['visibility', 'initialization', 'engines', 'favorites'] as const)(
    'damaged %s source does not initialize or erase bytes',
    async (kind) => {
      const store = create();
      const legacy = source();
      if (kind === 'visibility') legacy.visibility.overrides = '{';
      else if (kind === 'initialization') legacy.visibility.initialization = '[]';
      else legacy[kind] = '{';
      await expect(initialize(store, legacy)).rejects.toThrow();
      expect(store.inspect().status).toBe('pending-migration');
      expect(fs.existsSync(file('owner-a'))).toBe(false);
    },
  );
  it('稳定owner的pending显式增量持久化，但不把来源损坏或延后认领当导入成功', async () => {
    const store = create();
    canInitialize = false;
    await mutate(store, {
      kind: 'visibility-set',
      providerId: 'example',
      targets: [{ agent: 'pi', modelId: 'manual' }],
      enabled: false,
    });
    await mutate(store, {
      kind: 'visibility-reset',
      providerId: 'example',
      targets: [{ agent: 'pi', modelId: 'restored' }],
    });
    expect(create().inspect().status).toBe('pending-migration');
    const legacy = source();
    legacy.visibility.legacy = '{';
    canInitialize = true;
    await expect(initialize(store, legacy)).rejects.toThrow();
    expect(store.inspect().status).toBe('pending-migration');
    legacy.visibility.legacy = JSON.stringify({
      'pi:example:manual': true,
      'pi:example:restored': false,
      'pi:example:old': false,
    });
    const imported = await initialize(store, legacy);
    if (imported.status !== 'ready') throw new Error();
    expect(imported.value.visibility.overrides).toEqual({
      'pi:example:manual': false,
      'pi:example:old': false,
    });
    expect(imported.value.visibility.initialization.followCatalogKeys).toContain(
      'pi:example:restored',
    );
    expect(create().inspect()).toEqual(imported);
  });
  it('profile未稳定不能保存pending增量，未知源的收藏/engine也不能抢先成功', async () => {
    const store = create();
    origin = 'pending';
    await expect(
      mutate(store, {
        kind: 'visibility-set',
        providerId: 'example',
        targets: [{ agent: 'pi', modelId: 'm' }],
        enabled: true,
      }),
    ).rejects.toThrow();
    origin = 'new';
    await expect(mutate(store, { kind: 'favorite-add', config })).rejects.toThrow();
    await expect(
      mutate(store, { kind: 'engine-set', providerId: 'example', modelId: 'm', agent: 'pi' }),
    ).rejects.toThrow();
    expect(fs.existsSync(file('owner-a'))).toBe(false);
  });
  it('reset is durable initialization; subsequent legacy import cannot resurrect stale tables or seed', async () => {
    const store = create();
    const legacy = source();
    legacy.favorites = JSON.stringify({
      uidSeq: 20,
      items: [{ uid: 'fav-19', ...config }],
      seeded: true,
    });
    await initialize(store, legacy);
    await mutate(store, { kind: 'reset' });
    const importedAgain = await initialize(store, legacy);
    if (importedAgain.status !== 'ready') throw new Error();
    expect(importedAgain.value.favorites).toEqual({ uidSeq: 20, items: [], seeded: true });
    await mutate(store, { kind: 'favorite-seed', config });
    const afterSeed = store.inspect();
    if (afterSeed.status !== 'ready') throw new Error();
    expect(afterSeed.value.favorites.items).toEqual([]);
    const result = await mutate(store, { kind: 'favorite-add', config });
    expect(result.favoriteUid).toBe('fav-20');
  });
  it('reset before import creates marker and never takes stale browser data', async () => {
    const store = create();
    await mutate(store, { kind: 'reset' });
    const legacy = source();
    legacy.engines = JSON.stringify({ 'example:model': { agent: 'codex' } });
    const after = await initialize(store, legacy);
    if (after.status !== 'ready') throw new Error();
    expect(after.value.engines).toEqual({});
    expect(after.value.favorites.seeded).toBe(true);
  });
  it('parallel CAS writes re-read inside one file lock; loser cannot overwrite winner', async () => {
    const one = create();
    const two = create();
    await initialize(one);
    const base = request(one);
    const results = await Promise.allSettled([
      one.mutate({
        ...base,
        operation: { kind: 'engine-set', providerId: 'example', modelId: 'a', agent: 'pi' },
      }),
      two.mutate({
        ...base,
        operation: { kind: 'engine-set', providerId: 'example', modelId: 'b', agent: 'cc' },
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('CONFLICT');
    const state = create().inspect();
    if (state.status !== 'ready') throw new Error();
    expect(Object.keys(state.value.engines)).toHaveLength(1);
  });
  it('owner/generation and caller navigation are fenced again after lock acquisition', async () => {
    const store = create();
    await initialize(store);
    const before = fs.readFileSync(file('owner-a'), 'utf8');
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const lock = withCrossProcessLock(
      `${file('owner-a')}.lock`,
      { label: 'test', waitMs: 1000 },
      async (status) => {
        expect(status.held).toBe(true);
        acquired();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );
    await held;
    const writing = store.mutate({
      ...request(store),
      operation: { kind: 'engine-set', providerId: 'example', modelId: 'model', agent: 'cc' },
    });
    owner = { dataOwnerId: 'owner-a', ownerGeneration: 2 };
    release();
    await lock;
    await expect(writing).rejects.toMatchObject({ code: 'SCOPE_CHANGED' });
    expect(fs.readFileSync(file('owner-a'), 'utf8')).toBe(before);
    let callerCalls = 0;
    await expect(
      store.mutate({ ...request(store), operation: { kind: 'reset' } }, () => {
        if (++callerCalls > 1) throw new Error('navigated');
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(file('owner-a'), 'utf8')).toBe(before);
  });
  it('visibility uses explicit routes, preserves initialization and prevents reset aliases from reviving', async () => {
    const store = create();
    await initialize(store);
    await mutate(store, {
      kind: 'visibility-set',
      providerId: 'example',
      targets: [
        { agent: 'pi', modelId: 'old' },
        { agent: 'codex', modelId: 'old' },
      ],
      enabled: false,
    });
    await mutate(store, {
      kind: 'visibility-catalog',
      scopes: [
        {
          providerId: 'example',
          agent: 'pi',
          modelPrefixes: ['bridge/'],
          models: [
            { id: 'bridge/old', defaultEnabled: true },
            { id: 'new', defaultEnabled: true },
          ],
        },
      ],
    });
    await mutate(store, {
      kind: 'visibility-reset',
      providerId: 'example',
      targets: [{ agent: 'pi', modelId: 'bridge/old' }],
    });
    await mutate(store, {
      kind: 'visibility-catalog',
      scopes: [
        {
          providerId: 'example',
          agent: 'pi',
          modelPrefixes: ['bridge/'],
          models: [{ id: 'bridge/old', defaultEnabled: false }],
        },
      ],
    });
    const state = store.inspect();
    if (state.status !== 'ready') throw new Error();
    expect(state.value.visibility.overrides).toEqual({
      'pi:example:old': false,
      'codex:example:old': false,
    });
    expect(state.value.visibility.initialization.followCatalogKeys).toEqual([
      'pi:example:bridge/old',
    ]);
    expect(state.value.visibility.initialization.defaults['pi:example:bridge/old']).toBe(true);
    expect(state.value.visibility.overrides['pi:example:new']).toBeUndefined();
  });
  it('favorite copies de-duplicate exact configs only, keep edited duplicates and monotonic identities', async () => {
    const store = create();
    await initialize(store);
    const a = (await mutate(store, { kind: 'favorite-add', config })).favoriteUid!;
    expect((await mutate(store, { kind: 'favorite-add', config })).favoriteUid).toBe(a);
    const b = (await mutate(store, { kind: 'favorite-add', config: { ...config, effort: 'low' } }))
      .favoriteUid!;
    await mutate(store, { kind: 'favorite-update', uid: b, patch: { effort: 'high' } });
    let state = store.inspect();
    if (state.status !== 'ready') throw new Error();
    expect(state.value.favorites.items.map((item) => item.uid)).toEqual([a, b]);
    await mutate(store, { kind: 'favorite-remove', uid: a });
    await mutate(store, { kind: 'favorite-update', uid: a, patch: { fast: false } });
    await mutate(store, { kind: 'favorite-update', uid: b, patch: { fast: false, effort: null } });
    const c = (await mutate(store, { kind: 'favorite-add', config })).favoriteUid!;
    expect(c).not.toBe(a);
    state = store.inspect();
    if (state.status !== 'ready') throw new Error();
    expect(state.value.favorites.items[0]).toEqual({
      uid: b,
      providerId: 'example',
      modelId: 'model',
      agent: 'pi',
    });
    expect(state.value.engines).toEqual({});
  });
  it('收养尚未初始化的本地profile时保留其已持久化增量，并仍让云目标restore优先', async () => {
    owner = { dataOwnerId: 'local-v1', ownerGeneration: 1 };
    const store = create();
    canInitialize = false;
    await mutate(store, {
      kind: 'visibility-set',
      providerId: 'example',
      targets: [
        { agent: 'pi', modelId: 'manual' },
        { agent: 'pi', modelId: 'target-restored' },
      ],
      enabled: false,
    });
    await mutate(store, {
      kind: 'visibility-reset',
      providerId: 'example',
      targets: [{ agent: 'pi', modelId: 'local-restored' }],
    });
    owner = { dataOwnerId: 'owner-a', ownerGeneration: 2 };
    origin = 'adopted-local';
    const legacy = source();
    legacy.visibility.local.overrides = JSON.stringify({
      'pi:example:manual': true,
      'pi:example:local-restored': false,
      'pi:example:old': false,
    });
    legacy.visibility.initialization = JSON.stringify({
      eligibleForDefaults: false,
      defaults: {},
      scopes: [],
      followCatalogKeys: ['pi:example:target-restored'],
    });
    const adopted = await initialize(store, legacy);
    if (adopted.status !== 'ready') throw new Error();
    expect(adopted.value.visibility.overrides).toEqual({
      'pi:example:manual': false,
      'pi:example:old': false,
    });
    expect(adopted.value.visibility.initialization.followCatalogKeys).toEqual(
      expect.arrayContaining(['pi:example:local-restored', 'pi:example:target-restored']),
    );
    owner = { dataOwnerId: 'local-v1', ownerGeneration: 3 };
    expect(store.inspect().status).toBe('pending-migration');
  });
  it('existing login adoption result prefers local Host authority and leaves target restore tombstones intact', async () => {
    owner = { dataOwnerId: 'local-v1', ownerGeneration: 1 };
    const store = create();
    await initialize(store);
    await mutate(store, {
      kind: 'visibility-set',
      providerId: 'example',
      targets: [
        { agent: 'pi', modelId: 'model' },
        { agent: 'pi', modelId: 'restored' },
      ],
      enabled: false,
    });
    owner = { dataOwnerId: 'owner-a', ownerGeneration: 2 };
    origin = 'adopted-local';
    const legacy = source();
    legacy.visibility.local.overrides = JSON.stringify({ 'pi:example:model': true });
    legacy.visibility.initialization = JSON.stringify({
      eligibleForDefaults: false,
      defaults: {},
      scopes: [],
      followCatalogKeys: ['pi:example:restored'],
    });
    const adopted = await initialize(store, legacy);
    if (adopted.status !== 'ready') throw new Error();
    expect(adopted.value.visibility.overrides).toEqual({ 'pi:example:model': false });
    expect(adopted.value.visibility.initialization.followCatalogKeys).toContain(
      'pi:example:restored',
    );
    expect(adopted.value.engines).toEqual({});
    expect(adopted.value.favorites.items).toEqual([]);
  });
});
