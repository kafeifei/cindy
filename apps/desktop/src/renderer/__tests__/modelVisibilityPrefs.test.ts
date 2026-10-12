/** 可见性产品回归；旧浏览器锁/镜像断言改为 Host 原子回执、CAS 和一次导入。 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildUserProvider, type ProviderView, type AgentKind } from '@cindy/model-providers';
import {
  createModelPresentationTestHost,
  PreferenceMemoryStorage,
} from './modelPresentationTestHost';
import {
  ensureHostModelPresentationLoaded,
  getHostModelPresentationSnapshot,
  __resetHostModelPresentationForTest,
} from '../state/hostModelPresentationPreferences';
import * as prefs from '../state/modelVisibilityPrefs';
const history = vi.hoisted(() => ({ value: false }));
vi.mock('../state/providerModelMemory', () => ({
  hasAnyProviderModelOverride: () => history.value,
  hasProviderModelHistory: () => history.value,
}));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
let storage: PreferenceMemoryStorage;
let host: ReturnType<typeof createModelPresentationTestHost>;
const base = 'xdt:modelVisibilityPrefs:v1';
const mapKey = (owner = 'owner-a') => `${base}.owner.${owner}`;
const initKey = (owner = 'owner-a') => `${base}.initialization.owner.${owner}`;
const init = (extra = {}) => ({
  eligibleForDefaults: false,
  defaults: {},
  scopes: [],
  followCatalogKeys: [],
  ...extra,
});
const enabled = (id = 'm', defaultEnabled?: boolean, agent: AgentKind = 'pi', provider = 'p') =>
  prefs.isModelEnabled(agent, provider, { id, defaultEnabled });
const set = (flag: boolean, id = 'm') => prefs.setModelVisibility('pi', 'p', id, flag);
const catalog = (agent: AgentKind = 'pi', id = 'm', defaultEnabled = true) =>
  ({
    id: 'p',
    agents: [agent],
    routing: { [agent]: { modelPrefixes: ['bridge/'] } },
    models: { [agent]: [{ id, defaultEnabled }] },
  }) as ProviderView;
const upgrade = (providers: ProviderView[] = [catalog()]) =>
  prefs.migrateModelVisibilityDefaults(
    host.claim.dataOwnerId,
    host.claim.ownerGeneration,
    providers,
  );
const start = () => ensureHostModelPresentationLoaded();
const reopen = async () => {
  __resetHostModelPresentationForTest();
  await start();
};
const state = () => host.files.get(host.claim.dataOwnerId!)!;
beforeEach(() => {
  __resetHostModelPresentationForTest();
  history.value = false;
  storage = new PreferenceMemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  host = createModelPresentationTestHost(storage);
  host.install();
});
afterEach(() => {
  __resetHostModelPresentationForTest();
  vi.unstubAllGlobals();
});
describe('visibility 显式开关、目录与原子写', () => {
  it.each([undefined, true, false])('无override跟随当前目录defaultEnabled=%s', async (flag) => {
    await start();
    expect(enabled('m', flag)).toBe(flag !== false);
  });
  it.each([false, true])('显式%s覆盖相反目录默认并跨重连保留', async (flag) => {
    await start();
    expect(await set(flag)).toBe(true);
    expect(enabled('m', !flag)).toBe(flag);
    await reopen();
    expect(enabled('m', !flag)).toBe(flag);
    expect(storage.length).toBe(0);
  });
  it('与目录相同的显式值也是override，不跟随后续目录改变', async () => {
    await start();
    await set(true);
    expect(prefs.isModelVisibilityCustomized('pi', 'p', 'm')).toBe(true);
    expect(enabled('m', false)).toBe(true);
  });
  it('agent/provider/model完整分槽，含冒号标识不反向拆解', async () => {
    await start();
    await set(false);
    await prefs.setModelVisibility('codex', 'p', 'm', true);
    await prefs.setModelVisibility('pi', 'other', 'm', true);
    await prefs.setModelVisibility('pi', 'p:private', 'm:private', false);
    expect(enabled('m')).toBe(false);
    expect(enabled('m', false, 'codex')).toBe(true);
    expect(enabled('m', false, 'pi', 'other')).toBe(true);
    expect(enabled('m:private', true, 'pi', 'p:private')).toBe(false);
  });
  it('全部关/开逐项保存显式值', async () => {
    await start();
    await prefs.setManyVisibility('pi', 'p', ['a', 'b'], false);
    expect(enabled('a')).toBe(false);
    expect(enabled('b')).toBe(false);
    await prefs.setManyVisibility('pi', 'p', ['a', 'b'], true);
    expect(enabled('b', false)).toBe(true);
  });
  it('跨agent单一Host操作，失败不部分提交，显式重试整体成功', async () => {
    await start();
    const targets = [
      { agent: 'pi' as const, modelId: 'a' },
      { agent: 'codex' as const, modelId: 'b' },
    ];
    host.options.failWrite = true;
    expect(await prefs.setModelVisibilities('p', targets, false)).toBe(false);
    expect(state().value.visibility.overrides).toEqual({});
    expect(enabled('a')).toBe(true);
    host.options.failWrite = false;
    expect(await prefs.setModelVisibilities('p', targets, false)).toBe(true);
    expect(state().value.visibility.overrides).toEqual({ 'pi:p:a': false, 'codex:p:b': false });
    expect(host.api.mutate).toHaveBeenCalledTimes(2);
  });
  it('同值/空批次不改变已提交revision', async () => {
    await start();
    await set(false);
    const revision = state().revision;
    await set(false);
    await prefs.setManyVisibility('pi', 'p', [], true);
    expect(state().revision).toBe(revision);
  });
  it.each([
    ['', 'm'],
    ['p', ''],
  ])('空身份 %s %s不落盘', async (provider, model) => {
    await start();
    expect(await prefs.setModelVisibility('pi', provider, model, false)).toBe(false);
    expect(host.api.mutate).not.toHaveBeenCalled();
  });
  it('restore仅删除点名override，保存墓碑跟随未来目录', async () => {
    await start();
    await set(false);
    await set(false, 'keep');
    await prefs.resetModelVisibilities('p', [{ agent: 'pi', modelId: 'm' }]);
    await reopen();
    expect(prefs.isModelVisibilityCustomized('pi', 'p', 'm')).toBe(false);
    expect(enabled('m', true)).toBe(true);
    expect(enabled('m', false)).toBe(false);
    expect(enabled('keep')).toBe(false);
    expect(state().value.visibility.initialization.followCatalogKeys).toContain('pi:p:m');
  });
  it('显式开关清restore墓碑；写失败则墓碑不变', async () => {
    await start();
    await prefs.resetModelVisibilities('p', [{ agent: 'pi', modelId: 'm' }]);
    host.options.failWrite = true;
    expect(await set(false)).toBe(false);
    expect(state().value.visibility.initialization.followCatalogKeys).toContain('pi:p:m');
    host.options.failWrite = false;
    await set(false);
    expect(state().value.visibility.initialization.followCatalogKeys).not.toContain('pi:p:m');
  });
  it('无Renderer镜像推送/重试，持久值是唯一正本', async () => {
    const sync = vi.fn().mockRejectedValue(new Error('not registered'));
    window.electronAPI.maker.syncModelVisibility = sync;
    await start();
    await set(false);
    await upgrade();
    await upgrade();
    expect(sync).not.toHaveBeenCalled();
    expect(state().value.visibility.overrides).toEqual({ 'pi:p:m': false });
  });
  it('签出清缓存且不写，签入恢复旧owner', async () => {
    await start();
    await set(false);
    host.select(null);
    await prefs.setModelVisibilityOwner(null, 2, 'signed-out');
    expect(enabled()).toBe(true);
    expect(await set(false)).toBe(false);
    host.select('owner-a');
    await start();
    expect(enabled()).toBe(false);
  });
});
describe('现有认领结果与一次迁移', () => {
  it('首个已认领owner导入全局，后续账号不继承', async () => {
    storage.setItem(base, '{"pi:p:m":false}');
    await start();
    expect(enabled()).toBe(false);
    expect(storage.getItem(base)).toBe('{"pi:p:m":false}');
    host.select('owner-b');
    Object.assign(host.claim, { claimed: false, canInitialize: false, claimedByOtherOwner: true });
    await start();
    expect(enabled()).toBe(true);
    expect(state().value.visibility.overrides).toEqual({});
  });
  it('已存在scoped开关优先于全局', async () => {
    storage.setItem(base, '{"pi:p:m":false}');
    storage.setItem(mapKey(), '{"pi:p:m":true}');
    await start();
    expect(enabled('m', false)).toBe(true);
  });
  it('本地profile只消费既有认领结果', async () => {
    storage.setItem(base, '{"pi:p:m":false}');
    host.select('local-v1');
    await start();
    expect(enabled()).toBe(false);
    expect(host.files.has('owner-a')).toBe(false);
  });
  it.each([false, true])(
    'legacy认领deferred时稳定owner仍可保存delta，不标导入成功(claimed=%s)',
    async (claimed) => {
      storage.setItem(base, '{"pi:p:m":false,"pi:p:manual":true}');
      Object.assign(host.claim, { claimed, canInitialize: false });
      await start();
      expect(enabled()).toBe(false);
      expect(await set(false, 'manual')).toBe(true);
      expect(state().initialized).toBe(false);
      expect(state().value.visibility.overrides).toEqual({ 'pi:p:manual': false });
      Object.assign(host.claim, { claimed: true, canInitialize: true });
      expect(await upgrade()).toBe(true);
      expect(enabled()).toBe(false);
      expect(enabled('manual')).toBe(false);
      expect(state().initialized).toBe(true);
    },
  );
  it('pending期间restore墓碑优先于后导入开关', async () => {
    storage.setItem(base, '{"pi:p:m":false}');
    host.claim.canInitialize = false;
    await start();
    await prefs.resetModelVisibilities('p', [{ agent: 'pi', modelId: 'm' }]);
    expect(enabled()).toBe(true);
    host.claim.canInitialize = true;
    await upgrade();
    expect(enabled()).toBe(true);
    expect(prefs.isModelVisibilityCustomized('pi', 'p', 'm')).toBe(false);
  });
  it.each(['pending', 'unstable'] as const)('%s归属不稳定时不写', async (mode) => {
    if (mode === 'pending') host.claim.profileOrigin = 'pending';
    else host.claim.canWriteOwnerScoped = false;
    await start();
    expect(await set(true)).toBe(false);
    expect(state().initialized).toBe(false);
  });
  it('profile来源pending即便有旧marker也等待，来源确认后刷新新鲜导入', async () => {
    storage.setItem(`${base}.migration-complete.owner.owner-a`, '1');
    storage.setItem(initKey(), JSON.stringify(init()));
    host.claim.profileOrigin = 'pending';
    await start();
    expect(await upgrade()).toBe(false);
    host.claim.profileOrigin = 'new';
    expect(await upgrade()).toBe(true);
    expect(enabled()).toBe(true);
  });
  it.each(['{', 'null', '[]', '{"pi:p:m":1}'])(
    '损坏旧全局%s不当empty，修复后显式刷新再导入',
    async (raw) => {
      storage.setItem(base, raw);
      await start();
      expect(getHostModelPresentationSnapshot()?.status).toBe('pending-migration');
      expect(enabled()).toBe(false);
      expect(state().initialized).toBe(false);
      storage.setItem(base, '{"pi:p:m":false}');
      expect(await upgrade()).toBe(true);
      expect(enabled()).toBe(false);
    },
  );
  it('损坏scoped源不被一次普通增量冒充修复或迁移成功', async () => {
    storage.setItem(mapKey(), '{');
    await start();
    expect(await set(false, 'manual')).toBe(true);
    expect(state().initialized).toBe(false);
    expect(enabled()).toBe(false);
    expect(storage.getItem(mapKey())).toBe('{');
    storage.setItem(mapKey(), '{"pi:p:m":false}');
    expect(await upgrade()).toBe(true);
    expect(enabled()).toBe(false);
    expect(enabled('manual')).toBe(false);
  });
  it('导入写失败无marker，重连可恢复且旧source不改变', async () => {
    storage.setItem(base, '{"pi:p:m":false}');
    host.options.failWrite = true;
    await start();
    expect(state().initialized).toBe(false);
    host.options.failWrite = false;
    await reopen();
    expect(state().initialized).toBe(true);
    expect(enabled()).toBe(false);
    expect(storage.getItem(base)).toBe('{"pi:p:m":false}');
  });
});
describe('adopt-local合法来源、目标优先与墓碑', () => {
  const seed = () => {
    Object.assign(host.claim, {
      claimed: false,
      canInitialize: false,
      claimedByOtherOwner: true,
      profileOrigin: 'adopted-local',
    });
    storage.setItem(mapKey('local-v1'), '{"pi:p:m":false,"pi:p:keep":true}');
    storage.setItem(
      initKey('local-v1'),
      JSON.stringify(
        init({
          eligibleForDefaults: true,
          defaults: { 'pi:p:m': true },
          scopes: ['["p","pi"]'],
          followCatalogKeys: ['pi:p:restored'],
        }),
      ),
    );
  };
  it('合法adopt保留本地开关/初始化/墓碑；不收养engine或favorites', async () => {
    seed();
    storage.setItem('xdt:modelEnginePrefs:v1:local-v1', '{"p:m":{"agent":"pi"}}');
    await start();
    expect(enabled()).toBe(false);
    expect(enabled('keep', false)).toBe(true);
    expect(state().value.visibility.initialization.defaults).toEqual({ 'pi:p:m': true });
    expect(state().value.engines).toEqual({});
    await reopen();
    expect(enabled()).toBe(false);
  });
  it('目标override、已初始化scope及restore优先，源数据不被消费删除', async () => {
    seed();
    storage.setItem(mapKey(), '{"pi:p:keep":false}');
    storage.setItem(
      initKey(),
      JSON.stringify(
        init({
          defaults: { 'pi:p:m': false },
          scopes: ['["p","pi"]'],
          followCatalogKeys: ['pi:p:m'],
        }),
      ),
    );
    await start();
    expect(enabled()).toBe(true);
    expect(enabled('m', false)).toBe(false);
    expect(enabled('keep')).toBe(false);
    expect(state().value.visibility.initialization.defaults['pi:p:m']).toBe(false);
    expect(storage.getItem(mapKey('local-v1'))).toBe('{"pi:p:m":false,"pi:p:keep":true}');
  });
  it.each(['existing', 'new', undefined] as const)(
    '不能从%s profile自行推断adopt',
    async (origin) => {
      seed();
      host.claim.profileOrigin = origin;
      await start();
      expect(enabled()).toBe(true);
      expect(state().value.visibility.overrides).toEqual({});
    },
  );
  it('adopt marker禁止再收养旧source', async () => {
    seed();
    storage.setItem(`${base}.local-adoption.owner.owner-a`, '1');
    await start();
    expect(enabled()).toBe(true);
  });
  it.each(['source', 'target', 'initialization'] as const)(
    '损坏%s不标完成，修复后新鲜重捕获',
    async (where) => {
      seed();
      const key =
        where === 'source'
          ? mapKey('local-v1')
          : where === 'target'
            ? mapKey()
            : initKey('local-v1');
      const before = storage.getItem(key);
      storage.setItem(key, '{');
      await start();
      expect(state().initialized).toBe(false);
      expect(enabled()).toBe(false);
      if (before === null) storage.removeItem(key);
      else storage.setItem(key, before);
      expect(await upgrade()).toBe(true);
      expect(enabled()).toBe(false);
    },
  );
});
describe('初始化历史不是有效默认快照', () => {
  it('全新profile记录首见baseline，后续目录改变/新增仍跟随当前目录', async () => {
    await start();
    await upgrade();
    expect(state().value.visibility.initialization.defaults).toEqual({ 'pi:p:m': true });
    await upgrade([catalog('pi', 'm', false), catalog('pi', 'added', true)]);
    expect(state().value.visibility.initialization.defaults).toEqual({ 'pi:p:m': true });
    expect(enabled('m', false)).toBe(false);
    expect(enabled('added')).toBe(true);
    expect(state().value.visibility.overrides).toEqual({});
    await reopen();
    expect(enabled('m', false)).toBe(false);
  });
  it.each(['existing', undefined] as const)(
    '空模型存储不能把%s profile猜成新profile',
    async (origin) => {
      host.claim.profileOrigin = origin;
      await start();
      await upgrade();
      expect(state().value.visibility.initialization).toMatchObject({
        eligibleForDefaults: false,
        defaults: {},
      });
      expect(enabled()).toBe(true);
    },
  );
  it.each(['scoped', 'legacy', 'history', 'engine', 'favorite', 'defaults-marker'] as const)(
    '已有%s证据不授予首跑资格，也不变成可见性开关',
    async (evidence) => {
      if (evidence === 'history') history.value = true;
      if (evidence === 'scoped') storage.setItem(mapKey(), '{}');
      if (evidence === 'legacy') storage.setItem(base, '{}');
      if (evidence === 'defaults-marker')
        storage.setItem(`${base}.defaults-migration.v1.owner.owner-a`, '1');
      if (evidence === 'engine')
        storage.setItem('xdt:modelEnginePrefs:v1:owner-a', '{"p:m":{"agent":"pi"}}');
      if (evidence === 'favorite')
        storage.setItem(
          'xdt:modelFavorites:v1:owner-a',
          '{"items":[{"providerId":"p","modelId":"m","agent":"pi"}]}',
        );
      await start();
      await upgrade();
      expect(state().value.visibility.initialization.eligibleForDefaults).toBe(false);
      expect(state().value.visibility.overrides).toEqual({});
      expect(enabled('m', false)).toBe(false);
    },
  );
  it('旧initialization缺eligibility/tombstones按旧格式保留，不误判损坏', async () => {
    storage.setItem(
      initKey(),
      JSON.stringify({ defaults: { 'pi:p:m': true }, scopes: [JSON.stringify(['p', 'pi'])] }),
    );
    await start();
    expect(state().initialized).toBe(true);
    expect(state().value.visibility.initialization.eligibleForDefaults).toBe(false);
    expect(enabled('m', false)).toBe(false);
  });
  it.each([false, true])('空目录前重启不消耗资格(empty=%s)', async (empty) => {
    await start();
    if (empty) await upgrade([]);
    await reopen();
    await upgrade();
    expect(state().value.visibility.initialization.defaults).toEqual({ 'pi:p:m': true });
  });
  it('空scope不标初始化，迟到agent/provider目录不覆盖显式开关', async () => {
    await start();
    await upgrade([{ ...catalog('codex'), models: { codex: [] } }]);
    expect(state().value.visibility.initialization.scopes).toEqual([]);
    await prefs.setModelVisibility('codex', 'p', 'm', false);
    await upgrade([catalog('codex'), { ...catalog(), id: 'other' }]);
    expect(enabled('m', true, 'codex')).toBe(false);
    expect(enabled('m', true, 'pi', 'other')).toBe(true);
    expect(state().value.visibility.initialization.scopes).toHaveLength(2);
  });
  it('声明的同agent alias复制显式值，不换版本；restore禁止旧alias复活', async () => {
    storage.setItem(mapKey(), '{"pi:p:m":true,"codex:p:m":false}');
    await start();
    await upgrade([catalog('pi', 'bridge/m', false), catalog('pi', 'bridge/m-2', false)]);
    expect(enabled('bridge/m', false)).toBe(true);
    expect(enabled('bridge/m-2', false)).toBe(false);
    await prefs.resetModelVisibilities('p', [{ agent: 'pi', modelId: 'bridge/m' }]);
    await upgrade([catalog('pi', 'bridge/m', false)]);
    expect(enabled('bridge/m', false)).toBe(false);
  });
  it('初始化写失败后保存新关闭开关再刷新不覆盖它', async () => {
    await start();
    host.options.failWrite = true;
    expect(await upgrade()).toBe(false);
    expect(state().value.visibility.initialization.scopes).toEqual([]);
    host.options.failWrite = false;
    await set(false);
    expect(await upgrade()).toBe(true);
    expect(enabled()).toBe(false);
  });
  it('图片/视频未指定开关也跟随最新目录，不生成历史快照override', async () => {
    await start();
    await upgrade();
    expect(enabled('image/a', true, 'claude-code')).toBe(true);
    expect(enabled('image/old', false, 'claude-code')).toBe(false);
    expect(enabled('video/new', true, 'claude-code')).toBe(true);
    expect(state().value.visibility.overrides).toEqual({});
  });
});
describe('并发、世代与延迟回执', () => {
  it('Host回执前不发布乐观变化，缺Web Locks不降级', async () => {
    vi.stubGlobal('navigator', {});
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = set(false);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(enabled()).toBe(true);
    release();
    expect(await pending).toBe(true);
    expect(enabled()).toBe(false);
  });
  it('另窗先完成后本窗冲突只回读，不用新revision重放旧输入', async () => {
    await start();
    state().value.visibility.overrides['pi:p:peer'] = false;
    state().revision++;
    expect(await set(false)).toBe(false);
    expect(enabled('peer')).toBe(false);
    expect(enabled()).toBe(true);
    expect(host.api.mutate).toHaveBeenCalledTimes(1);
  });
  it('另窗restore后旧写不能复活开关，通知无额外写风暴', async () => {
    await start();
    await set(false);
    delete state().value.visibility.overrides['pi:p:m'];
    state().value.visibility.initialization.followCatalogKeys.push('pi:p:m');
    state().revision++;
    expect(await set(true, 'other')).toBe(false);
    expect(enabled()).toBe(true);
    const calls = vi.mocked(host.api.mutate).mock.calls.length;
    host.publish();
    await Promise.resolve();
    expect(host.api.mutate).toHaveBeenCalledTimes(calls);
  });
  it('排队期间切owner，旧请求不可写新桶且新owner不被阻塞', async () => {
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = set(false);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    host.options.beforeWrite = null;
    host.select('owner-b');
    await start();
    expect(await set(true, 'new')).toBe(true);
    release();
    expect(await pending).toBe(false);
    expect(state().value.visibility.overrides).toEqual({ 'pi:p:new': true });
    expect(host.files.get('owner-a')!.value.visibility.overrides).toEqual({});
  });
  it('过期owner/generation/目录快照不写', async () => {
    await start();
    expect(await prefs.migrateModelVisibilityDefaults('other', 1, [catalog()])).toBe(false);
    expect(await prefs.migrateModelVisibilityDefaults('owner-a', 0, [catalog()])).toBe(false);
    expect(await prefs.migrateModelVisibilityDefaults('owner-a', 1, [catalog()], () => false)).toBe(
      false,
    );
    expect(host.api.mutate).not.toHaveBeenCalled();
  });
  it('另一窗完成导入的Host通知可解除pending，不重导本地旧值', async () => {
    storage.setItem(base, JSON.stringify({ 'pi:p:m': true }));
    host.claim.canInitialize = false;
    await start();
    const value = structuredClone(state().value);
    value.visibility.overrides['pi:p:m'] = false;
    host.initialized(value);
    host.publish();
    await vi.waitFor(() => expect(getHostModelPresentationSnapshot()?.status).toBe('ready'));
    expect(enabled()).toBe(false);
    expect(host.api.importLegacy).not.toHaveBeenCalled();
  });
});
it('导入native模型恢复当前路由默认，但手动override保持直到reset', async () => {
  await start();
  const agents = ['claude-code', 'codex', 'pi'] as const;
  const provider = buildUserProvider(
    {
      id: 'imported-native',
      name: 'Test',
      runtimes: Object.fromEntries(
        agents.map((agent) => [
          agent,
          {
            baseUrl: 'https://example.com/v1',
            models: [{ id: 'claude-test', name: 'Claude', api: 'anthropic-messages' }],
          },
        ]),
      ),
    },
    {
      modelRegistry: {
        schemaVersion: 5,
        updatedAt: '2026-09-13T00:00:00Z',
        models: [
          {
            id: 'claude-test',
            name: 'Claude',
            nativeApi: 'anthropic-messages',
            routes: [
              {
                providerId: 'imported-native',
                modelId: 'claude-test',
                agents: ['claude-code', 'codex'],
              },
            ],
          },
        ],
      },
    },
  );
  const current = () =>
    agents.map((agent) => prefs.isModelEnabled(agent, provider.id, provider.models[agent]![0]!));
  expect(current()).toEqual([true, false, true]);
  await prefs.setModelVisibility('pi', provider.id, 'claude-test', false);
  await prefs.setModelVisibility('codex', provider.id, 'claude-test', true);
  expect(current()).toEqual([true, true, false]);
  await prefs.resetModelVisibilities(
    provider.id,
    agents.map((agent) => ({ agent, modelId: 'claude-test' })),
  );
  expect(current()).toEqual([true, false, true]);
});
