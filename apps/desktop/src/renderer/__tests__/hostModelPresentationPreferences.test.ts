import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  createModelPresentationTestHost,
  PreferenceMemoryStorage,
} from './modelPresentationTestHost';
import {
  connectHostModelPresentationPreferences,
  ensureHostModelPresentationLoaded,
  commitHostModelPresentation,
  getHostModelPresentationSnapshot,
  __resetHostModelPresentationForTest,
} from '../state/hostModelPresentationPreferences';
import {
  addModelFavorite,
  listModelFavorites,
  updateModelFavorite,
  removeModelFavorite,
  seedDefaultFavorite,
} from '../state/modelFavorites';
import {
  setModelEngineOverride,
  getModelEngineOverride,
  clearModelEngineOverride,
} from '../state/modelEnginePrefs';
import {
  setModelVisibilities,
  resetModelVisibilities,
  isModelEnabled,
} from '../state/modelVisibilityPrefs';
import { emptyModelPresentationPreferences } from '../../shared/modelPresentationPreferences';
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../state/providerModelMemory', () => ({
  hasAnyProviderModelOverride: () => false,
  hasProviderModelHistory: () => false,
}));
let storage: PreferenceMemoryStorage;
let host: ReturnType<typeof createModelPresentationTestHost>;
const config = {
  providerId: 'example',
  modelId: 'model',
  agent: 'pi' as const,
  effort: 'high' as const,
  fast: true as const,
};
beforeEach(() => {
  __resetHostModelPresentationForTest();
  storage = new PreferenceMemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  host = createModelPresentationTestHost(storage);
  host.install();
});
afterEach(() => {
  __resetHostModelPresentationForTest();
  vi.unstubAllGlobals();
});
async function start() {
  connectHostModelPresentationPreferences();
  await ensureHostModelPresentationLoaded();
}

describe('renderer Host model connection', () => {
  it('imports only owner-scoped keys, preserves source and uses Host thereafter', async () => {
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({ uidSeq: 8, items: [{ uid: 'fav-7', ...config }], seeded: true }),
    );
    storage.setItem(
      'xdt:modelFavorites:v1',
      JSON.stringify({ uidSeq: 9, items: [{ uid: 'private-global', ...config }] }),
    );
    await start();
    expect(listModelFavorites().map((item) => item.uid)).toEqual(['fav-7']);
    await updateModelFavorite('fav-7', { effort: 'low', fast: false });
    expect(listModelFavorites()[0]).toEqual({
      uid: 'fav-7',
      providerId: 'example',
      modelId: 'model',
      agent: 'pi',
      effort: 'low',
    });
    expect(JSON.parse(storage.getItem('xdt:modelFavorites:v1:owner-a')!).items[0].effort).toBe(
      'high',
    );
    __resetHostModelPresentationForTest();
    await start();
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
    expect(listModelFavorites()[0]?.effort).toBe('low');
  });
  it('acknowledges no favorite uid/cache/engine/visibility success before durable receipt', async () => {
    host.initialized();
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const write = addModelFavorite(config);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(listModelFavorites()).toEqual([]);
    release();
    expect(await write).toBe('fav-1');
    expect(listModelFavorites()).toHaveLength(1);
    host.options.beforeWrite = null;
    host.options.failWrite = true;
    expect(await setModelEngineOverride('example', 'model', 'cc')).toBe(false);
    expect(getModelEngineOverride('example', 'model')).toBeUndefined();
    expect(await setModelVisibilities('example', [{ agent: 'pi', modelId: 'model' }], false)).toBe(
      false,
    );
    expect(isModelEnabled('pi', 'example', { id: 'model' })).toBe(true);
  });
  it('read/CAS failure discards losing operation and queued stale edits, then reads the winner', async () => {
    host.initialized();
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const first = setModelEngineOverride('example', 'first', 'pi');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const queued = setModelEngineOverride('example', 'queued', 'cc');
    const winner = host.files.get('owner-a')!;
    winner.value.engines['example:winner'] = { agent: 'codex' };
    winner.revision++;
    release();
    expect(await first).toBe(false);
    expect(await queued).toBe(false);
    expect(host.api.mutate).toHaveBeenCalledTimes(1);
    expect(getModelEngineOverride('example', 'winner')).toBe('codex');
    expect(getModelEngineOverride('example', 'first')).toBeUndefined();
  });
  it('generation invalidation during a request cannot publish into or write the next owner', async () => {
    host.initialized();
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const write = addModelFavorite(config);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    host.select('owner-b');
    host.initialized();
    release();
    expect(await write).toBe('');
    expect(listModelFavorites()).toEqual([]);
    host.options.beforeWrite = null;
    await start();
    expect(listModelFavorites()).toEqual([]);
    expect(host.files.get('owner-a')?.value.favorites.items).toEqual([]);
  });
  it('same-owner new generation fences late responses and initial-load queued edits', async () => {
    host.initialized();
    let release!: () => void;
    const originalGet = host.api.get;
    host.api.get = vi.fn(async () => {
      const old = await originalGet();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return old;
    });
    const write = setModelEngineOverride('example', 'model', 'pi');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    host.select('owner-a', 2);
    release();
    expect(await write).toBe(false);
    expect(host.api.mutate).not.toHaveBeenCalled();
  });
  it.each(['{broken', '', '[]', 'null'])(
    'damaged favorites %s stays pending and cannot create a successful empty migration',
    async (raw) => {
      storage.setItem('xdt:modelFavorites:v1:owner-a', raw);
      await start();
      expect(getHostModelPresentationSnapshot()?.status).toBe('pending-migration');
      expect(host.files.get('owner-a')?.initialized).toBe(false);
      expect(storage.getItem('xdt:modelFavorites:v1:owner-a')).toBe(raw);
      expect(await addModelFavorite(config)).toBe('');
    },
  );
  it('a failed import conflict only re-reads, never substitutes a new revision to replay input', async () => {
    storage.setItem(
      'xdt:modelEnginePrefs:v1:owner-a',
      JSON.stringify({ 'example:stale': { agent: 'cc' } }),
    );
    host.api.importLegacy = vi.fn(async () => {
      const value = emptyModelPresentationPreferences();
      value.engines['example:winner'] = { agent: 'pi' };
      host.initialized(value);
      throw new Error('conflict');
    });
    await start();
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
    expect(getModelEngineOverride('example', 'winner')).toBe('pi');
    expect(getModelEngineOverride('example', 'stale')).toBeUndefined();
  });
  it('reset marker prevents reimport and seed resurrection, including after reconnect', async () => {
    await start();
    await seedDefaultFavorite(config);
    const uid = listModelFavorites()[0]!.uid;
    await removeModelFavorite(uid);
    await seedDefaultFavorite(config);
    expect(listModelFavorites()).toEqual([]);
    await commitHostModelPresentation({ kind: 'reset' });
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({ uidSeq: 8, items: [{ uid: 'fav-7', ...config }] }),
    );
    __resetHostModelPresentationForTest();
    await start();
    expect(listModelFavorites()).toEqual([]);
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
  });
  it('explicit overrides, restore tombstones and engine default semantics remain distinct', async () => {
    await start();
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: true })).toBe(true);
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: false })).toBe(false);
    await setModelVisibilities('example', [{ agent: 'pi', modelId: 'new' }], true);
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: false })).toBe(true);
    expect(isModelEnabled('codex', 'example', { id: 'new', defaultEnabled: false })).toBe(false);
    await resetModelVisibilities('example', [{ agent: 'pi', modelId: 'new' }]);
    expect(isModelEnabled('pi', 'example', { id: 'new', defaultEnabled: false })).toBe(false);
    await setModelEngineOverride('example', 'new', 'cc');
    expect(getModelEngineOverride('example', 'new')).toBe('cc');
    await clearModelEngineOverride('example', 'new');
    expect(getModelEngineOverride('example', 'new')).toBeUndefined();
  });
  it('no native API fails closed and never falls back to localStorage authority', async () => {
    delete (window.electronAPI as unknown as Record<string, unknown>).modelPresentationPreferences;
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({ uidSeq: 8, items: [{ uid: 'fav-7', ...config }] }),
    );
    await start();
    expect(await addModelFavorite(config)).toBe('');
    expect(listModelFavorites()).toEqual([]);
    expect(isModelEnabled('pi', 'example', { id: 'model' })).toBe(false);
  });
});
