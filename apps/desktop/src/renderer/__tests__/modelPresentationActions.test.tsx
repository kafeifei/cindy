// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { UnifiedModelEntry } from '@cindy/model-providers';
import {
  useUnifiedRowActions,
  type UnifiedRowActionsOptions,
} from '../components/new-chat/useUnifiedRowActions';
import type { UnifiedRowConfig } from '../components/new-chat/unifiedModelSelection';
import { createModelPresentationTestHost } from './modelPresentationTestHost';
import {
  ensureHostModelPresentationLoaded,
  __resetHostModelPresentationForTest,
} from '../state/hostModelPresentationPreferences';
import { addModelFavorite, getModelFavorite, listModelFavorites } from '../state/modelFavorites';
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../state/providerModelMemory', () => ({
  hasAnyProviderModelOverride: () => false,
  hasProviderModelHistory: () => false,
}));
let host: ReturnType<typeof createModelPresentationTestHost>;
const anchor = { kind: 'model' as const, providerId: 'example', modelId: 'm' };
const config: UnifiedRowConfig = {
  engine: 'pi',
  agent: 'pi',
  efforts: [],
  effort: null,
  fast: false,
  fastCapable: false,
  customized: false,
  capability: null,
  wireModelId: 'm',
};
const entry = {
  providerId: 'example',
  modelId: 'm',
  recommended: 'pi',
  candidates: ['pi', 'cc'],
  capabilities: {},
} as unknown as UnifiedModelEntry;
const options = (extra: Partial<UnifiedRowActionsOptions> = {}): UnifiedRowActionsOptions => ({
  interactionDisabled: false,
  isLiveRow: () => false,
  onSelect: vi.fn(),
  onFavoriteFlash: vi.fn(),
  onBeforeRemoveFavorite: vi.fn(),
  ...extra,
});
beforeEach(async () => {
  __resetHostModelPresentationForTest();
  host = createModelPresentationTestHost(window.localStorage);
  host.initialized();
  host.install();
  await ensureHostModelPresentationLoaded();
});
afterEach(() => {
  cleanup();
  __resetHostModelPresentationForTest();
  window.localStorage.clear();
});
it('收藏成功点亮必须等Host回执，等待期间列表不变', async () => {
  let release!: () => void;
  host.options.beforeWrite = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const opts = options();
  const hook = renderHook(() => useUnifiedRowActions(opts));
  let operation: ReturnType<typeof hook.result.current.addFavorite>;
  await act(async () => {
    operation = hook.result.current.addFavorite(anchor, config);
    await Promise.resolve();
  });
  expect(hook.result.current.pending).toBe(true);
  expect(listModelFavorites()).toEqual([]);
  expect(opts.onFavoriteFlash).not.toHaveBeenCalled();
  await act(async () => {
    release();
    expect(await operation).toBe(true);
  });
  expect(listModelFavorites()).toHaveLength(1);
  expect(opts.onFavoriteFlash).toHaveBeenCalledOnce();
  expect(hook.result.current.pending).toBe(false);
});
it('Host拒绝收藏保存不闪成功、不制造乐观uid', async () => {
  host.options.failWrite = true;
  const opts = options();
  const hook = renderHook(() => useUnifiedRowActions(opts));
  await act(async () => {
    expect(await hook.result.current.addFavorite(anchor, config)).toBe(false);
  });
  expect(listModelFavorites()).toEqual([]);
  expect(opts.onFavoriteFlash).not.toHaveBeenCalled();
});
it('删除Host写失败保留副本和界面锚点，重试成功才收尾', async () => {
  const uid = await addModelFavorite({ providerId: 'example', modelId: 'm', agent: 'pi' });
  const fav = { ...anchor, kind: 'fav' as const, uid };
  const opts = options();
  const hook = renderHook(() => useUnifiedRowActions(opts));
  host.options.failWrite = true;
  await act(async () => {
    expect(await hook.result.current.removeFavorite(fav, entry)).toBe(false);
  });
  expect(getModelFavorite(uid)).toBeDefined();
  expect(opts.onBeforeRemoveFavorite).not.toHaveBeenCalled();
  host.options.failWrite = false;
  await act(async () => {
    expect(await hook.result.current.removeFavorite(fav, entry)).toBe(true);
  });
  expect(getModelFavorite(uid)).toBeUndefined();
  expect(opts.onBeforeRemoveFavorite).toHaveBeenCalledOnce();
});
it('过期渲染回调不把旧意图保存到新owner', async () => {
  const opts = options();
  const hook = renderHook(() => useUnifiedRowActions(opts));
  const old = hook.result.current.addFavorite;
  host.select('owner-b');
  host.initialized();
  await ensureHostModelPresentationLoaded();
  await act(async () => {
    expect(await old(anchor, config)).toBe(false);
  });
  expect(host.files.get('owner-b')!.value.favorites.items).toEqual([]);
  expect(opts.onFavoriteFlash).not.toHaveBeenCalled();
});
it('live步骤等待期间换owner，后续engine持久化不串号', async () => {
  let release!: (value: boolean) => void;
  const live = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const opts = options({
    isLiveRow: () => true,
    onSelect: live,
    resolveEngineConfig: () => ({ ...config, engine: 'cc', agent: 'claude-code' }),
  });
  const hook = renderHook(() => useUnifiedRowActions(opts));
  let operation: ReturnType<typeof hook.result.current.applyEngine>;
  await act(async () => {
    operation = hook.result.current.applyEngine(anchor, entry, config, 'cc');
  });
  host.select('owner-b');
  host.initialized();
  await ensureHostModelPresentationLoaded();
  await act(async () => {
    release(true);
    expect(await operation).toBe(false);
  });
  expect(host.files.get('owner-b')!.value.engines).toEqual({});
  expect(host.files.get('owner-a')!.value.engines).toEqual({});
});
