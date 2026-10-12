import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  accessHostModelFavorites,
  setModelFavoritesOwner,
  addModelFavorite,
  __resetForTest,
} from '@/state/modelFavorites';
import { PreferenceMemoryStorage, createModelPresentationTestHost } from './modelPresentationTestHost';
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../state/providerModelMemory', () => ({ hasAnyProviderModelOverride: () => false, hasProviderModelHistory: () => false }));
let storage: PreferenceMemoryStorage;
let host: ReturnType<typeof createModelPresentationTestHost>;
beforeEach(() => {
  __resetForTest();
  storage = new PreferenceMemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  host = createModelPresentationTestHost(storage); host.install();
  host.select('owner'); setModelFavoritesOwner('owner');
});
afterEach(() => { __resetForTest(); vi.unstubAllGlobals(); });
const item = {
  providerId: 'account',
  modelId: 'model',
  agent: 'codex' as const,
  effort: 'high' as const,
};
it('remote reads and edits use the same persisted favorites as the local desktop', async () => {
  const uid = await addModelFavorite(item);
  const [original] = await accessHostModelFavorites('owner');
  expect(original?.uid).toBe(uid);
  await accessHostModelFavorites('owner', {
    kind: 'update',
    expected: original!,
    item: { ...item, fast: true },
  });
  const saved = (await accessHostModelFavorites('owner'))[0]!;
  expect(saved.fast).toBe(true);
  await accessHostModelFavorites('owner', { kind: 'remove', expected: saved });
  expect(await accessHostModelFavorites('owner')).toEqual([]);
  expect(host.files.get('owner')!.value.favorites.items).toEqual([]);
  expect(storage.length).toBe(0);
});
it('two controllers add independently without replacing the table; duplicate add is idempotent', async () => {
  await accessHostModelFavorites('owner', { kind: 'add', item });
  await accessHostModelFavorites('owner', { kind: 'add', item: { ...item, effort: 'low' } });
  await accessHostModelFavorites('owner', { kind: 'add', item });
  expect(await accessHostModelFavorites('owner')).toHaveLength(2);
});
it('rejects a stale edit and never resurrects a removed favorite', async () => {
  const [original] = await accessHostModelFavorites('owner', { kind: 'add', item });
  await accessHostModelFavorites('owner', {
    kind: 'update',
    expected: original!,
    item: { ...item, effort: 'low' },
  });
  await expect(accessHostModelFavorites('owner', { kind: 'remove', expected: original! })).rejects.toThrow(
    'changed',
  );
  const current = (await accessHostModelFavorites('owner'))[0]!;
  await accessHostModelFavorites('owner', { kind: 'remove', expected: current });
  await expect(accessHostModelFavorites('owner', { kind: 'update', expected: current, item })).rejects.toThrow('changed');
});
it('rejects wrong-owner access and failed persistence without acknowledging success', async () => {
  await expect(accessHostModelFavorites('different')).rejects.toThrow('owner');
  await accessHostModelFavorites('owner');
  host.options.failWrite = true;
  await expect(accessHostModelFavorites('owner', { kind: 'add', item })).rejects.toThrow('save failed');
  host.options.failWrite = false;
  expect(await accessHostModelFavorites('owner')).toEqual([]);
});
