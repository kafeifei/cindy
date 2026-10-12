/** 收藏产品合同保留；旧 localStorage 乐观写/op-log 用 Host 回执、CAS 与一次导入代替。 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  createModelPresentationTestHost,
  PreferenceMemoryStorage,
} from './modelPresentationTestHost';
import {
  ensureHostModelPresentationLoaded,
  getHostModelPresentationSnapshot,
  __resetHostModelPresentationForTest,
} from '../state/hostModelPresentationPreferences';
import * as favorites from '../state/modelFavorites';
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../state/providerModelMemory', () => ({
  hasAnyProviderModelOverride: () => false,
  hasProviderModelHistory: () => false,
}));
let storage: PreferenceMemoryStorage;
let host: ReturnType<typeof createModelPresentationTestHost>;
const config = { providerId: 'example', modelId: 'model', agent: 'cc' as const };
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
const start = () => ensureHostModelPresentationLoaded();
const reopen = async () => {
  __resetHostModelPresentationForTest();
  await start();
};
describe('收藏配置副本 · Host 正本', () => {
  it('默认空列表，不预置推荐', async () => {
    await start();
    expect(favorites.listModelFavorites()).toEqual([]);
    expect(storage.length).toBe(0);
  });
  it('add 返回已持久化独立锚点，保持调档，重连恢复而不重导', async () => {
    await start();
    const uid = await favorites.addModelFavorite({ ...config, effort: 'high', fast: true });
    expect(uid).toBe('fav-1');
    expect(favorites.getModelFavorite(uid)).toEqual({ uid, ...config, effort: 'high', fast: true });
    expect(host.files.get('owner-a')!.value.favorites.uidSeq).toBe(2);
    expect(storage.length).toBe(0);
    await reopen();
    expect(favorites.getModelFavorite(uid)?.effort).toBe('high');
    expect(host.api.importLegacy).toHaveBeenCalledTimes(1);
  });
  it('省略effort/fast不快照默认', async () => {
    await start();
    const uid = await favorites.addModelFavorite(config);
    expect(favorites.getModelFavorite(uid)).toEqual({ uid, ...config });
  });
  it.each([
    { providerId: 'other' },
    { modelId: 'other' },
    { agent: 'pi' as const },
    { effort: 'high' },
    { fast: true as const },
  ])('配置任一维不同保留独立副本: %j', async (change) => {
    await start();
    const a = await favorites.addModelFavorite(config);
    const b = await favorites.addModelFavorite({ ...config, ...change });
    expect(a).not.toBe(b);
    expect(favorites.listModelFavorites()).toHaveLength(2);
    expect(await favorites.addModelFavorite({ ...config, ...change })).toBe(b);
    expect(favorites.listModelFavorites()).toHaveLength(2);
  });
  it.each([
    { providerId: '' },
    { providerId: '*' },
    { modelId: '' },
    { agent: 'orca' },
    { providerId: 2 },
    { modelId: null },
  ])('非法身份/引擎不落盘: %j', async (change) => {
    await start();
    expect(await favorites.addModelFavorite({ ...config, ...change } as never)).toBe('');
    expect(favorites.listModelFavorites()).toEqual([]);
    expect(host.api.mutate).not.toHaveBeenCalled();
  });
  it('非法effort仅去该字段，不丢模型副本', async () => {
    await start();
    const uid = await favorites.addModelFavorite({ ...config, effort: 'localized-高' });
    expect(favorites.getModelFavorite(uid)).toEqual({ uid, ...config });
  });
  it('update就地改独立副本且保留锚点/顺序，不改其它副本', async () => {
    await start();
    const a = await favorites.addModelFavorite({ ...config, effort: 'high', fast: true });
    const b = await favorites.addModelFavorite({ ...config, effort: 'low' });
    expect(await favorites.updateModelFavorite(a, { agent: 'pi', effort: null, fast: false })).toBe(
      true,
    );
    expect(favorites.listModelFavorites()).toEqual([
      { uid: a, ...config, agent: 'pi' },
      { uid: b, ...config, effort: 'low' },
    ]);
    expect(host.files.get('owner-a')!.value.engines).toEqual({});
  });
  it('编辑后配置重复也不合并旧锚点', async () => {
    await start();
    const a = await favorites.addModelFavorite({ ...config, effort: 'high' });
    const b = await favorites.addModelFavorite(config);
    await favorites.updateModelFavorite(a, { effort: null });
    expect(favorites.listModelFavorites().map((item) => item.uid)).toEqual([a, b]);
  });
  it('非法引擎整个patch拒绝，非法effort按clear，未知uid不复活', async () => {
    await start();
    const uid = await favorites.addModelFavorite({ ...config, effort: 'high', fast: true });
    expect(await favorites.updateModelFavorite(uid, { agent: 'orca', fast: false } as never)).toBe(
      false,
    );
    expect(favorites.getModelFavorite(uid)?.fast).toBe(true);
    await favorites.updateModelFavorite(uid, { effort: 'localized' });
    expect(favorites.getModelFavorite(uid)?.effort).toBeUndefined();
    await favorites.updateModelFavorite('missing', { fast: true });
    expect(favorites.listModelFavorites()).toHaveLength(1);
  });
  it('删除不回收序号，旧uid编辑不复活', async () => {
    await start();
    const a = await favorites.addModelFavorite(config);
    await favorites.removeModelFavorite(a);
    await favorites.updateModelFavorite(a, { effort: 'high' });
    const b = await favorites.addModelFavorite(config);
    expect(a).toBe('fav-1');
    expect(b).toBe('fav-2');
    expect(favorites.getModelFavorite(a)).toBeUndefined();
  });
  it('迁移补齐缺失/重复uid，保护未来序号及顺序', async () => {
    storage.setItem(
      'xdt:modelFavorites:v1:owner-a',
      JSON.stringify({
        uidSeq: 1,
        items: [
          { uid: 'fav-7', ...config },
          { uid: 'fav-7', ...config, effort: 'low' },
          { ...config, agent: 'pi' },
        ],
      }),
    );
    await start();
    expect(favorites.listModelFavorites().map((item) => item.uid)).toEqual([
      'fav-7',
      'fav-8',
      'fav-9',
    ]);
    expect(await favorites.addModelFavorite({ ...config, fast: true })).toBe('fav-10');
  });
  it.each([
    '{',
    'null',
    '[]',
    '1',
    '{"items":{}}',
    '{"items":[{"agent":"orca"}]}',
    '{"items":[false]}',
  ])('损坏source %s不当成empty或迁移成功', async (raw) => {
    storage.setItem('xdt:modelFavorites:v1:owner-a', raw);
    await start();
    expect(getHostModelPresentationSnapshot()?.status).toBe('pending-migration');
    expect(host.files.get('owner-a')!.initialized).toBe(false);
    expect(storage.getItem('xdt:modelFavorites:v1:owner-a')).toBe(raw);
  });
  it('owner分桶、订阅失效、返回旧owner仍恢复其已保存配置', async () => {
    await start();
    const a = await favorites.addModelFavorite(config);
    const listener = vi.fn();
    const off = favorites.subscribeModelFavorites(listener);
    host.select('owner-b');
    favorites.setModelFavoritesOwner('owner-b');
    expect(listener).toHaveBeenCalled();
    await start();
    expect(favorites.listModelFavorites()).toEqual([]);
    await favorites.addModelFavorite({ ...config, modelId: 'b' });
    host.select('owner-a');
    await start();
    expect(favorites.getModelFavorite(a)?.modelId).toBe('model');
    off();
  });
  it('Host变化事件重读，不把迟到localStorage值回写成第二正本', async () => {
    await start();
    const uid = await favorites.addModelFavorite(config);
    const state = host.files.get('owner-a')!;
    state.value.favorites.items[0]!.effort = 'low';
    state.revision++;
    host.publish();
    await vi.waitFor(() => expect(favorites.getModelFavorite(uid)?.effort).toBe('low'));
    storage.setItem('xdt:modelFavorites:v1:owner-a', JSON.stringify({ uidSeq: 1, items: [] }));
    expect(favorites.listModelFavorites()).toHaveLength(1);
  });
  it('Host seeded单独变化也会同步且阻止再种', async () => {
    await start();
    const state = host.files.get('owner-a')!;
    state.value.favorites.seeded = true;
    state.revision++;
    host.publish();
    await vi.waitFor(() =>
      expect(
        (getHostModelPresentationSnapshot() as { value: { favorites: { seeded?: boolean } } }).value
          .favorites.seeded,
      ).toBe(true),
    );
    await favorites.seedDefaultFavorite(config);
    expect(favorites.listModelFavorites()).toEqual([]);
  });
  it('另窗新增后本窗编辑/删除不覆盖其条目', async () => {
    await start();
    const uid = await favorites.addModelFavorite(config);
    const state = host.files.get('owner-a')!;
    state.value.favorites.items.push({ uid: 'fav-2', ...config, modelId: 'peer' });
    state.value.favorites.uidSeq = 3;
    state.revision++;
    host.publish();
    await vi.waitFor(() => expect(favorites.listModelFavorites()).toHaveLength(2));
    await favorites.updateModelFavorite(uid, { effort: 'high' });
    await favorites.removeModelFavorite(uid);
    expect(favorites.listModelFavorites()).toEqual([{ uid: 'fav-2', ...config, modelId: 'peer' }]);
  });
  it('写失败不乐观成功，原快照不变', async () => {
    await start();
    host.options.failWrite = true;
    expect(await favorites.addModelFavorite(config)).toBe('');
    expect(favorites.listModelFavorites()).toEqual([]);
    host.options.failWrite = false;
    expect(await favorites.addModelFavorite(config)).toBe('fav-1');
  });
  it('SSR不回退本地写入，也不抛', async () => {
    vi.stubGlobal('window', undefined);
    expect(favorites.listModelFavorites()).toEqual([]);
    expect(await favorites.addModelFavorite(config)).toBe('');
  });
  it('只投放一次，删除后的墓碑跨重启保留', async () => {
    await start();
    await favorites.seedDefaultFavorite(config);
    const uid = favorites.listModelFavorites()[0]!.uid;
    await favorites.removeModelFavorite(uid);
    await reopen();
    await favorites.seedDefaultFavorite(config);
    expect(favorites.listModelFavorites()).toEqual([]);
    expect(host.files.get('owner-a')!.value.favorites.seeded).toBe(true);
  });
  it('已有收藏只落seed墓碑，不改已整理列表', async () => {
    await start();
    const uid = await favorites.addModelFavorite(config);
    await favorites.seedDefaultFavorite({ ...config, modelId: 'seed' });
    expect(favorites.listModelFavorites()).toEqual([{ uid, ...config }]);
    expect(host.files.get('owner-a')!.value.favorites.seeded).toBe(true);
  });
  it('非法种子不消耗投放资格；之后普通增删不清墓碑', async () => {
    await start();
    expect(await favorites.seedDefaultFavorite({ ...config, providerId: '*' })).toBe(false);
    expect(host.files.get('owner-a')!.value.favorites.seeded).toBeUndefined();
    await favorites.seedDefaultFavorite(config);
    const uid = await favorites.addModelFavorite({ ...config, modelId: 'other' });
    await favorites.removeModelFavorite(uid);
    expect(host.files.get('owner-a')!.value.favorites.seeded).toBe(true);
  });
  it('连续add/update不会插第二份副本且不依赖Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    await start();
    const uid = await favorites.addModelFavorite(config);
    await favorites.updateModelFavorite(uid, { effort: 'low' });
    expect(favorites.listModelFavorites()).toEqual([{ uid, ...config, effort: 'low' }]);
  });
});
