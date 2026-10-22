import { createModelPresentationTestHost } from './modelPresentationTestHost';
import { ensureHostModelPresentationLoaded } from '@/state/hostModelPresentationPreferences';
import { getDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
let favoriteHost: ReturnType<typeof createModelPresentationTestHost>;
async function selectFavoritesOwner(id: string | null) {
  favoriteHost.select(id, getDataOwnerGeneration().generation);
  setModelFavoritesOwner(id);
  await ensureHostModelPresentationLoaded();
}
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseModelFavorites, providerShareParsers, type ProviderShareReceived } from '@cindy/device-link';
import type { ModelFavoritesHostApi } from '../../shared/modelFavoritesSync';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import {
  __resetForTest, addModelFavorite, listModelFavorites, setModelFavoritesOwner, useModelFavorites,
} from '@/state/modelFavorites';
import {
  parseProviderShareFavoriteSource, providerShareFavoriteSource, reconcileProviderShareFavorites,
  useProviderShareFavorites, useProviderShareFavoriteCleanupFailed,
  useProviderShareFavoriteSources,
} from '@/state/providerShareFavorites';
import { useModelFavoritesHost } from '@/state/useModelFavoritesHost';

const share = (shareId = 's1', memberId = 'm1'): ProviderShareReceived => ({
  shareId, memberId, providerId: 'anthropic', providerLabel: 'Anthropic',
  hostDeviceId: 'host', deviceName: 'Host', status: 'active', hostOnline: true, hostCapable: true,
  owner: { displayName: 'Owner', avatarUrl: null, region: 'global' },
});
const config = { providerId: 'anthropic', modelId: 'opus', agent: 'cc' as const, effort: 'high' as const, fast: true as const };
const publish = async (received: ProviderShareReceived[], confirmed = true, dataOwnerId = 'recipient', ownerGeneration = 1) => {
  await reconcileProviderShareFavorites({ received, confirmedRegions: confirmed ? ['global', 'cn'] : [], ownerStamp: { dataOwnerId, ownerGeneration } });
};
const mount = (deviceId = 'share:s1') => renderHook(() => useProviderShareFavorites(deviceId, useModelFavorites()));

beforeEach(async () => {
  __resetForTest();
  window.localStorage.clear();
  favoriteHost = createModelPresentationTestHost(window.localStorage);
  favoriteHost.install();
  setDataOwnerGeneration('recipient', 1);
  await selectFavoritesOwner('recipient');
  await publish([share(), share('s2', 'm2')]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('recipient-owned shared model favorites', () => {
  it('aggregates only exact, available grants for the current account', async () => {
    const sources = renderHook(() => useProviderShareFavoriteSources());
    expect([...sources.result.current.values()]).toEqual(['share:s1', 'share:s2']);
    await act(async () => await publish([{ ...share(), status: 'paused' }, { ...share('s2', 'm2'), hostOnline: false }]));
    expect(sources.result.current.size).toBe(0);
    await act(async () => await publish([share('s1', 'replacement')]));
    expect(sources.result.current.has(providerShareFavoriteSource(share()))).toBe(false);
    expect(sources.result.current.get(providerShareFavoriteSource(share('s1', 'replacement')))).toBe('share:s1');
    await act(async () => { setDataOwnerGeneration('other', 2); await publish([], true, 'other', 2); });
    expect(sources.result.current.size).toBe(0);
  });

  it('projects and edits the task computer store without touching the controller copy', async () => {
    await addModelFavorite(config);
    const item = { ...config, uid: 'remote-1', providerId: providerShareFavoriteSource(share()) };
    const home = { items: [item], store: {
      get: vi.fn((uid: string) => uid === item.uid ? item : undefined),
      add: vi.fn(), update: vi.fn(), remove: vi.fn(),
    } };
    const view = renderHook(() => useProviderShareFavorites('share:s1', useModelFavorites(), home));
    expect(view.result.current.items).toEqual([{ ...config, uid: item.uid }]);
    await act(async () => await view.result.current.store.update(item.uid, { effort: 'low', fast: false }));
    expect(home.store.update).toHaveBeenCalledWith(item.uid, { effort: 'low', fast: false });
    await expect(view.result.current.store.update('unknown', { effort: 'low' })).rejects.toThrow();
    expect(listModelFavorites()).toEqual([expect.objectContaining(config)]);
    const stale = view.result.current.store;
    await act(async () => await publish([share('s1', 'replacement')]));
    await expect(stale.remove(item.uid)).rejects.toThrow('Shared favorite source unavailable');
    expect(home.store.remove).not.toHaveBeenCalled();
  });

  it('keeps long local sources out of legacy remote replies without removing stored favorites', async () => {
    const received = providerShareParsers.received({ ...share('s'.repeat(128), 'm'.repeat(128)), providerId: 'p'.repeat(256) });
    await publish([received]);
    const view = mount(`share:${received.shareId}`);
    await act(async () => await view.result.current.store.add({ ...config, providerId: received.providerId }));
    await act(async () => { await addModelFavorite(config); });
    const onRequest = vi.fn<ModelFavoritesHostApi['onRequest']>().mockReturnValue(() => {});
    const reply = vi.fn<ModelFavoritesHostApi['reply']>();
    vi.stubGlobal('electronAPI', { ...window.electronAPI, modelFavoritesHost: { onRequest, reply, ready: vi.fn(), changed: vi.fn() } });
    renderHook(() => useModelFavoritesHost());
    const request = onRequest.mock.calls[0]![0];
    await act(async () => await request({ requestId: 'get', expiresAt: Date.now() + 1000, ownerStamp: { dataOwnerId: 'recipient', ownerGeneration: 1 } }));
    const items = reply.mock.calls[0]![0].items;
    expect(parseModelFavorites(items)).toEqual([expect.objectContaining(config)]);
    expect(listModelFavorites()).toHaveLength(2);
    expect(view.result.current.items).toHaveLength(1);
  });

  it.each(['p'.repeat(256), '"\\'.repeat(128), '\ud800'.repeat(256)])('supports protocol-valid maximum identifiers including JSON escaping (%#)', async (providerId) => {
    const received = providerShareParsers.received({ ...share('s'.repeat(128), 'm'.repeat(128)), providerId });
    const source = providerShareFavoriteSource(received);
    expect(source.length).toBeGreaterThan(512);
    expect(parseProviderShareFavoriteSource(source)).toEqual({
      shareId: received.shareId, memberId: received.memberId, providerId, region: 'global',
    });
    await addModelFavorite(config);
    await publish([received]);
    const view = mount(`share:${received.shareId}`);
    const longConfig = { ...config, providerId };
    await act(async () => await view.result.current.store.add(longConfig));
    await act(async () => { await selectFavoritesOwner('other'); await selectFavoritesOwner('recipient'); });
    expect(view.result.current.items).toEqual([{ ...longConfig, uid: expect.any(String) }]);
    const uid = view.result.current.items[0]!.uid;
    await act(async () => await view.result.current.store.update(uid, { effort: 'low' }));
    expect(view.result.current.items[0]?.effort).toBe('low');
    await act(async () => await publish([received]));
    expect(view.result.current.items).toHaveLength(1);
    const failed = renderHook(() => useProviderShareFavoriteCleanupFailed());
    await act(async () => await publish([]));
    expect(failed.result.current).toBe(false);
    expect(listModelFavorites()).toEqual([expect.objectContaining(config)]);
  });

  it.each(['cn', 'global'] as const)('keeps %s favorites usable and cleans only confirmed regions when the other region fails to load', async (region) => {
    const localShare = { ...share(), owner: { ...share().owner, region } };
    const peerRegion = region === 'cn' ? 'global' as const : 'cn' as const;
    const peerShare = { ...share('peer', 'peer-member'), owner: { ...share().owner, region: peerRegion } };
    // 模拟重启前已有对方区域收藏，启动后该区域尚未成功加载。
    await addModelFavorite({ ...config, providerId: providerShareFavoriteSource(peerShare) });
    await publish([], false);
    const view = mount();
    const update = async (received: ProviderShareReceived[], confirmedRegions: Array<'cn' | 'global'>) => {
      await reconcileProviderShareFavorites({ received, confirmedRegions, ownerStamp: { dataOwnerId: 'recipient', ownerGeneration: 1 } });
    };
    await act(async () => await update([localShare], [region]));
    await act(async () => await view.result.current.store.add(config));
    expect(view.result.current.items).toHaveLength(1);
    expect(listModelFavorites()).toHaveLength(2);
    const uid = view.result.current.items[0]!.uid;
    await act(async () => await view.result.current.store.update(uid, { effort: 'low' }));
    expect(view.result.current.items[0]?.effort).toBe('low');
    // 已确认区域撤权立即清理，未知区域继续保留。
    await act(async () => await update([], [region]));
    expect(view.result.current.items).toEqual([]);
    expect(listModelFavorites()).toEqual([expect.objectContaining({ providerId: providerShareFavoriteSource(peerShare) })]);
    // 对方区域恢复并确认空名单后，才清掉它的最后一条收藏。
    await act(async () => await update([], [region, peerRegion]));
    expect(listModelFavorites()).toEqual([]);
  });

  it('persists the complete configuration and distinguishes local providers, shares and grants', async () => {
    await addModelFavorite(config);
    const a = mount();
    const b = mount('share:s2');
    await act(async () => { await a.result.current.store.add(config); await b.result.current.store.add(config); });
    expect(listModelFavorites()).toHaveLength(3);
    expect(parseProviderShareFavoriteSource(listModelFavorites()[1]!.providerId)).toEqual({ shareId: 's1', memberId: 'm1', providerId: 'anthropic', region: 'global' });
    expect(a.result.current.items).toEqual([{ ...config, uid: listModelFavorites()[1]!.uid }]);
    expect(b.result.current.items).toEqual([{ ...config, uid: listModelFavorites()[2]!.uid }]);
    await act(async () => await a.result.current.store.add(config));
    expect(listModelFavorites()).toHaveLength(3);
    await act(async () => await a.result.current.store.add({ ...config, effort: 'low' }));
    expect(a.result.current.items).toHaveLength(2);
    // 换账号再回来强制从持久化值加载，配置和来源仍完整。
    await act(async () => { await selectFavoritesOwner('other'); await selectFavoritesOwner('recipient'); });
    expect(a.result.current.items[0]).toMatchObject(config);
    expect(b.result.current.items).toHaveLength(1);
  });

  it('edits and removes only the selected copy while preserving its share source', async () => {
    const view = mount();
    await act(async () => await view.result.current.store.add(config));
    const uid = view.result.current.items[0]!.uid;
    await act(async () => await view.result.current.store.update(uid, { effort: 'low', fast: false }));
    expect(listModelFavorites()[0]).toMatchObject({ providerId: providerShareFavoriteSource(share()), effort: 'low' });
    expect(view.result.current.items[0]?.fast).toBeUndefined();
    await act(async () => await view.result.current.store.remove(uid));
    expect(listModelFavorites()).toEqual([]);
  });

  it('never clears on an unknown empty list, pause, offline, or a stale account snapshot', async () => {
    const view = mount();
    await act(async () => await view.result.current.store.add(config));
    await act(async () => {
      await publish([], false);
      await publish([{ ...share(), status: 'paused', hostOnline: false }]);
      await publish([], true, 'other');
      await publish([], true, 'recipient', 0);
    });
    expect(listModelFavorites()).toHaveLength(1);
    expect(view.result.current.items).toHaveLength(1);
  });

  it('clears revoked shares including the last share and a replaced membership, preserving unrelated favorites', async () => {
    await addModelFavorite(config);
    const a = mount();
    const b = mount('share:s2');
    await act(async () => { await a.result.current.store.add(config); await b.result.current.store.add(config); });
    const staleStore = a.result.current.store;
    await act(async () => await publish([share('s1', 'new-member'), share('s2', 'm2')]));
    expect(a.result.current.items).toEqual([]);
    await expect(staleStore.add(config)).rejects.toThrow('Shared favorite source unavailable');
    expect(b.result.current.items).toHaveLength(1);
    await act(async () => await publish([]));
    expect(listModelFavorites()).toEqual([expect.objectContaining(config)]);
  });

  it('fences writes and cleanup across account changes', async () => {
    const view = mount();
    await act(async () => await view.result.current.store.add(config));
    const oldStore = view.result.current.store;
    await act(async () => {
      setDataOwnerGeneration('other', 2);
      await selectFavoritesOwner('other');
      await publish([], true, 'recipient', 1);
    });
    await expect(oldStore.add(config)).rejects.toThrow();
    expect(listModelFavorites()).toEqual([]);
    await act(async () => { setDataOwnerGeneration('recipient', 3); await selectFavoritesOwner('recipient'); });
    expect(listModelFavorites()).toHaveLength(1);
    await act(async () => await publish([], true, 'recipient', 3));
    expect(listModelFavorites()).toEqual([]);
  });

  it('reports persistence failures without claiming a save or losing the previous copy', async () => {
    const view = mount();
    await act(async () => await view.result.current.store.add(config));
    const uid = view.result.current.items[0]!.uid;
    favoriteHost.options.failWrite = true;
  const writes = vi.spyOn(favoriteHost.api, 'mutate');
    await expect(view.result.current.store.add({ ...config, effort: 'low' })).rejects.toThrow('save failed');
    await expect(view.result.current.store.update(uid, { effort: 'low' })).rejects.toThrow('save failed');
    await expect(view.result.current.store.remove(uid)).rejects.toThrow('save failed');
    expect(view.result.current.items).toEqual([{ uid, ...config }]);
    const failed = renderHook(() => useProviderShareFavoriteCleanupFailed());
    await act(async () => await publish([]));
    expect(failed.result.current).toBe(true);
    expect(listModelFavorites()).toHaveLength(1);
    writes.mockRestore(); favoriteHost.options.failWrite = false;
    await act(async () => await publish([]));
    expect(failed.result.current).toBe(false);
    expect(listModelFavorites()).toEqual([]);
  });

  it('does not let an earlier asynchronous membership cleanup remove a revalidated share', async () => {
    const view = mount();
    await act(async () => { await view.result.current.store.add(config); });
    await act(async () => {
      const staleCleanup = publish([]);
      const currentCleanup = publish([share()]);
      await Promise.all([staleCleanup, currentCleanup]);
    });
    expect(listModelFavorites()).toHaveLength(1);
    expect(view.result.current.items[0]).toMatchObject(config);
  });

  it('rejects a save that reaches persistence after the account changed', async () => {
    const view = mount();
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { entered = resolve; });
    favoriteHost.options.beforeWrite = () => { entered(); return held; };
    await act(async () => {
      const saving = view.result.current.store.add(config);
      const rejected = expect(saving).rejects.toThrow();
      await writing;
      setDataOwnerGeneration('other', 2);
      favoriteHost.select('other', 2);
      favoriteHost.initialized();
      await selectFavoritesOwner('other');
      release();
      await rejected;
    });
    expect(favoriteHost.files.get('recipient')?.value.favorites.items).toEqual([]);
    expect(listModelFavorites()).toEqual([]);
  });
});
