/** 原引擎选择/清除/分桶/并发合同；持久化断言从浏览器乐观写改为 Host 回执与 CAS。 */
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
import * as prefs from '../state/modelEnginePrefs';
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../state/providerModelMemory', () => ({
  hasAnyProviderModelOverride: () => false,
  hasProviderModelHistory: () => false,
}));
let storage: PreferenceMemoryStorage;
let host: ReturnType<typeof createModelPresentationTestHost>;
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
const read = () => prefs.getModelEngineOverride('example', 'model');
const set = (agent: 'cc' | 'codex' | 'pi') =>
  prefs.setModelEngineOverride('example', 'model', agent);
const clear = () => prefs.clearModelEngineOverride('example', 'model');
describe('modelEnginePrefs · Host 正本', () => {
  it('默认空表返回undefined，不写推荐快照', async () => {
    await start();
    expect(read()).toBeUndefined();
    expect(prefs.hasAnyModelEngineOverride()).toBe(false);
    expect(prefs.hasModelEngineOverride('example', 'model')).toBe(false);
    expect(storage.length).toBe(0);
  });
  it.each(['cc', 'codex', 'pi'] as const)('合法引擎%s往返并跨连接恢复', async (agent) => {
    await start();
    expect(await set(agent)).toBe(true);
    expect(read()).toBe(agent);
    expect(prefs.hasModelEngineOverride('example', 'model')).toBe(true);
    expect(host.files.get('owner-a')!.value.engines).toEqual({ 'example:model': { agent } });
    expect(storage.length).toBe(0);
    __resetHostModelPresentationForTest();
    await start();
    expect(read()).toBe(agent);
  });
  it('同名模型不同来源互不覆盖', async () => {
    await start();
    await set('cc');
    await prefs.setModelEngineOverride('other', 'model', 'pi');
    expect(read()).toBe('cc');
    expect(prefs.getModelEngineOverride('other', 'model')).toBe('pi');
  });
  it('clear真删key不留推荐快照，且不动其它模型', async () => {
    await start();
    await set('cc');
    await prefs.setModelEngineOverride('other', 'model', 'pi');
    await clear();
    expect(read()).toBeUndefined();
    expect(host.files.get('owner-a')!.value.engines).toEqual({ 'other:model': { agent: 'pi' } });
    __resetHostModelPresentationForTest();
    await start();
    expect(read()).toBeUndefined();
  });
  it.each([
    ['*', 'model', 'cc'],
    ['', 'model', 'cc'],
    ['example', '', 'cc'],
    ['example', 'model', 'orca'],
  ])('非法写入 %j %j %j 被拒绝', async (provider, model, agent) => {
    await start();
    expect(await prefs.setModelEngineOverride(provider, model, agent as never)).toBe(false);
    expect(host.api.mutate).not.toHaveBeenCalled();
    expect(read()).toBeUndefined();
  });
  it('保留位读取与清除都不碰真实来源', async () => {
    await start();
    await set('cc');
    expect(prefs.getModelEngineOverride('*', 'model')).toBeUndefined();
    expect(await prefs.clearModelEngineOverride('*', 'model')).toBe(false);
    expect(read()).toBe('cc');
  });
  it('一次导入保留合法枚举，退役枚举跟随推荐，保留source不再回写', async () => {
    const raw = JSON.stringify({
      'example:model': { agent: 'pi' },
      'example:retired': { agent: 'orca' },
    });
    storage.setItem(`${prefs.__STORAGE_KEY}:owner-a`, raw);
    await start();
    expect(read()).toBe('pi');
    expect(prefs.getModelEngineOverride('example', 'retired')).toBeUndefined();
    await set('cc');
    expect(storage.getItem(`${prefs.__STORAGE_KEY}:owner-a`)).toBe(raw);
  });
  it.each(['{', 'null', '[]', '1', '{"p:m":null}', '{"p:m":"cc"}', '{"p:m":{"effort":"high"}}'])(
    '损坏source %s不当成empty或成功',
    async (raw) => {
      storage.setItem(`${prefs.__STORAGE_KEY}:owner-a`, raw);
      await start();
      expect(read()).toBeUndefined();
      expect(getHostModelPresentationSnapshot()?.status).toBe('pending-migration');
      expect(host.files.get('owner-a')!.initialized).toBe(false);
      expect(storage.getItem(`${prefs.__STORAGE_KEY}:owner-a`)).toBe(raw);
    },
  );
  it('不导入无owner全局键，符号owner只读取编码精确键', async () => {
    storage.setItem(prefs.__STORAGE_KEY, JSON.stringify({ 'example:model': { agent: 'cc' } }));
    host.select('member/a:b');
    storage.setItem(
      `${prefs.__STORAGE_KEY}:member%2Fa%3Ab`,
      JSON.stringify({ 'example:model': { agent: 'pi' } }),
    );
    await start();
    expect(read()).toBe('pi');
  });
  it('owner分桶及通知；签出不可写；已持久化旧桶不丢', async () => {
    await start();
    await set('cc');
    const listener = vi.fn();
    const off = prefs.subscribeModelEnginePrefs(listener);
    host.select('owner-b');
    prefs.setModelEnginePrefsOwner('owner-b');
    expect(listener).toHaveBeenCalled();
    await start();
    expect(read()).toBeUndefined();
    await set('pi');
    host.select('owner-a');
    await start();
    expect(read()).toBe('cc');
    host.select(null);
    await start();
    expect(read()).toBeUndefined();
    expect(await set('pi')).toBe(false);
    off();
  });
  it('订阅按已提交变化发布，同值/重复clear不产生新版本', async () => {
    await start();
    const listener = vi.fn();
    const off = prefs.subscribeModelEnginePrefs(listener);
    await set('cc');
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await set('cc');
    expect(listener).toHaveBeenCalledTimes(calls);
    await clear();
    const clears = listener.mock.calls.length;
    await clear();
    expect(listener).toHaveBeenCalledTimes(clears);
    off();
    await set('pi');
    expect(listener).toHaveBeenCalledTimes(clears);
  });
  it('Host通知重读共享真相，旧浏览器事件不能回滚', async () => {
    await start();
    await set('cc');
    const state = host.files.get('owner-a')!;
    state.value.engines['example:model'] = { agent: 'pi' };
    state.revision++;
    host.publish();
    await vi.waitFor(() => expect(read()).toBe('pi'));
    storage.setItem(`${prefs.__STORAGE_KEY}:owner-a`, '{}');
    host.publish();
    await vi.waitFor(() => expect(read()).toBe('pi'));
  });
  it.each(['set', 'clear'] as const)(
    '不同窗交错%s冲突不覆盖新条目，回读后新操作可成功',
    async (operation) => {
      await start();
      await set('cc');
      const state = host.files.get('owner-a')!;
      state.value.engines['peer:model'] = { agent: 'codex' };
      state.revision++;
      expect(await (operation === 'set' ? set('pi') : clear())).toBe(false);
      expect(read()).toBe('cc');
      expect(prefs.getModelEngineOverride('peer', 'model')).toBe('codex');
      expect(await (operation === 'set' ? set('pi') : clear())).toBe(true);
      expect(prefs.getModelEngineOverride('peer', 'model')).toBe('codex');
    },
  );
  it('旧revision不重放，不复活已恢复推荐项', async () => {
    await start();
    await set('cc');
    const state = host.files.get('owner-a')!;
    delete state.value.engines['example:model'];
    state.revision++;
    expect(await prefs.setModelEngineOverride('other', 'model', 'pi')).toBe(false);
    expect(read()).toBeUndefined();
    expect(host.files.get('owner-a')!.value.engines).toEqual({});
    expect(await prefs.setModelEngineOverride('other', 'model', 'pi')).toBe(true);
    expect(read()).toBeUndefined();
  });
  it('同key竞争只承认CAS胜者，后一次新显式选择可改', async () => {
    await start();
    const state = host.files.get('owner-a')!;
    state.value.engines['example:model'] = { agent: 'codex' };
    state.revision++;
    expect(await set('pi')).toBe(false);
    expect(read()).toBe('codex');
    expect(await set('pi')).toBe(true);
    expect(read()).toBe('pi');
  });
  it('没有Web Locks不降级浏览器写，仍等待Host回执', async () => {
    vi.stubGlobal('navigator', {});
    await start();
    let release!: () => void;
    host.options.beforeWrite = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = set('pi');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(read()).toBeUndefined();
    expect(storage.length).toBe(0);
    release();
    expect(await pending).toBe(true);
    expect(read()).toBe('pi');
  });
  it('Host写失败不宣称内存成功，下一次显式重试可成功', async () => {
    await start();
    host.options.failWrite = true;
    expect(await set('cc')).toBe(false);
    expect(read()).toBeUndefined();
    host.options.failWrite = false;
    expect(await set('cc')).toBe(true);
  });
  it('SSR不抛且不制造未持久化override', async () => {
    vi.stubGlobal('window', undefined);
    expect(await set('cc')).toBe(false);
    expect(read()).toBeUndefined();
  });
});
