/** Main 兼容门面只有 Host 正本，不再接收 Renderer 整表/策略作为权限或可见性真相。 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { isModelVisible, type ProviderView } from '@cindy/model-providers';
import {
  emptyModelPresentationPreferences,
  type ModelPresentationPreferencesSnapshot,
} from '../../../shared/modelPresentationPreferences';
const host = vi.hoisted(() => ({
  snapshot: {
    status: 'unavailable',
    revision: null,
    ownerStamp: null,
  } as ModelPresentationPreferencesSnapshot,
  listeners: [] as Array<() => void>,
}));
vi.mock('../../host-settings/model-presentation-preferences', () => ({
  inspectModelPresentationPreferences: () => structuredClone(host.snapshot),
  onModelPresentationPreferencesChanged: (listener: () => void) => {
    host.listeners.push(listener);
    return () => {};
  },
}));
import {
  __resetModelVisibilityMirrorForTest,
  clearModelVisibilityMirror,
  waitForModelVisibilityMirror,
  getModelVisibilityOverride,
  getModelVisibilityMirrorSnapshot,
  setModelVisibilityMirror,
  syncModelVisibilityMirror,
  syncModelVisibilityMirrorForOwner,
} from '../model-visibility-mirror';
const stamp = { dataOwnerId: 'owner-a', ownerGeneration: 1 };
function ready(overrides: Record<string, boolean> = {}) {
  const value = emptyModelPresentationPreferences();
  value.visibility.overrides = overrides;
  host.snapshot = {
    status: 'ready',
    initialized: true,
    revision: 'revision',
    ownerStamp: stamp,
    value,
  };
}
const publish = () => host.listeners.forEach((listener) => listener());
beforeEach(() => {
  host.snapshot = { status: 'unavailable', revision: null, ownerStamp: null };
  __resetModelVisibilityMirrorForTest();
});
afterEach(() => {
  __resetModelVisibilityMirrorForTest();
  vi.useRealTimers();
});
describe('visibility Host 门面', () => {
  it.each(['unavailable', 'unreadable'] as const)(
    '%s不猜测默认开启，只有目录bootstrap允许空映射',
    (status) => {
      host.snapshot = { status, ownerStamp: stamp, revision: null };
      expect(() => getModelVisibilityOverride('pi', 'p', 'm')).toThrow(
        'MODEL_VISIBILITY_NOT_READY',
      );
      expect(() => getModelVisibilityMirrorSnapshot()).toThrow();
      expect(getModelVisibilityMirrorSnapshot([], true)).toEqual({});
    },
  );
  it('没有任何Renderer推送也可读Host显式值，agent/provider/model不串', () => {
    ready({ 'claude-code:p:m': false, 'codex:other:m': true, 'pi:p:private:m:private': false });
    expect(getModelVisibilityOverride('claude-code', 'p', 'm')).toBe(false);
    expect(getModelVisibilityOverride('codex', 'other', 'm')).toBe(true);
    expect(getModelVisibilityOverride('codex', 'p', 'm')).toBeUndefined();
    expect(getModelVisibilityOverride('pi', 'p:private', 'm:private')).toBe(false);
  });
  it('每次读取Host最新整表，返回副本不能改正本', () => {
    ready({ 'pi:p:a': false });
    const copy = getModelVisibilityMirrorSnapshot();
    copy['pi:p:a'] = true;
    expect(getModelVisibilityOverride('pi', 'p', 'a')).toBe(false);
    ready({ 'pi:p:b': true });
    expect(getModelVisibilityOverride('pi', 'p', 'a')).toBeUndefined();
    expect(getModelVisibilityOverride('pi', 'p', 'b')).toBe(true);
  });
  it.each([null, [], { 'pi:p:a': true }, { 'pi:p:a': 'invalid' }])(
    '旧Renderer payload %j不能替代正本或清空',
    (payload) => {
      ready({ 'pi:p:a': false });
      setModelVisibilityMirror(payload, { fallback: true, pending: false });
      expect(getModelVisibilityOverride('pi', 'p', 'a')).toBe(false);
    },
  );
  it('变化通知只比较Host当前值，输入脏值/策略不能制造重复失效', () => {
    const notify = vi.fn();
    ready({ 'pi:p:a': false });
    expect(syncModelVisibilityMirror({}, notify)).toBe(true);
    expect(syncModelVisibilityMirror({ dirty: 1 }, notify, { fallback: false })).toBe(false);
    ready({ 'pi:p:a': true });
    expect(syncModelVisibilityMirror({}, notify)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('旧sync拒绝错误owner/过期generation/边界切换，不接收迟到策略', () => {
    const notify = vi.fn();
    ready({ 'pi:p:a': false });
    expect(
      syncModelVisibilityMirrorForOwner(
        {},
        { dataOwnerId: 'old', ownerGeneration: 1 },
        stamp,
        false,
        notify,
      ),
    ).toBe(false);
    expect(
      syncModelVisibilityMirrorForOwner({}, { ...stamp, ownerGeneration: 0 }, stamp, false, notify),
    ).toBe(false);
    expect(syncModelVisibilityMirrorForOwner({}, stamp, stamp, true, notify)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(syncModelVisibilityMirrorForOwner({}, stamp, stamp, false, notify)).toBe(true);
    expect(getModelVisibilityOverride('pi', 'p', 'a')).toBe(false);
  });
  it('未知route为undefined交给当前目录默认，历史初始化不是有效可见性', () => {
    ready({ 'pi:p:on': true, 'pi:p:off': false });
    if (host.snapshot.status !== 'ready') throw new Error();
    host.snapshot.value.visibility.initialization.defaults['pi:p:new'] = false;
    expect(getModelVisibilityOverride('pi', 'p', 'on')).toBe(true);
    expect(getModelVisibilityOverride('pi', 'p', 'off')).toBe(false);
    expect(getModelVisibilityOverride('pi', 'p', 'new')).toBeUndefined();
    expect(isModelVisible(getModelVisibilityOverride('pi', 'p', 'new'), true)).toBe(true);
    expect(isModelVisible(getModelVisibilityOverride('pi', 'p', 'new'), false)).toBe(false);
  });
  it('provider列表不制造额外off override，旧客户端也沿用目录默认', () => {
    ready({ 'pi:p:on': true });
    const providers = [
      {
        id: 'p',
        agents: ['pi'],
        models: {
          pi: [
            { id: 'on', defaultEnabled: false },
            { id: 'new', defaultEnabled: true },
          ],
        },
      },
    ] as unknown as ProviderView[];
    expect(getModelVisibilityMirrorSnapshot(providers)).toEqual({ 'pi:p:on': true });
  });
  it('恢复默认删除override，后续显式off仍优先', () => {
    ready();
    if (host.snapshot.status !== 'ready') throw new Error();
    host.snapshot.value.visibility.initialization.followCatalogKeys.push('pi:p:m');
    expect(getModelVisibilityOverride('pi', 'p', 'm')).toBeUndefined();
    host.snapshot.value.visibility.overrides['pi:p:m'] = false;
    expect(getModelVisibilityOverride('pi', 'p', 'm')).toBe(false);
  });
  it('pending不能以空表完成等待，Host初始化通知才唤醒', async () => {
    host.snapshot = {
      status: 'pending-migration',
      initialized: false,
      revision: 'revision',
      ownerStamp: stamp,
      value: emptyModelPresentationPreferences(),
    };
    const done = vi.fn();
    const waiting = waitForModelVisibilityMirror().then(done);
    publish();
    setModelVisibilityMirror({ 'pi:p:forged': true });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    expect(getModelVisibilityMirrorSnapshot([], true)).toEqual({});
    ready({ 'pi:p:on': true, 'pi:p:off': false });
    publish();
    await waiting;
    expect(done).toHaveBeenCalledOnce();
    expect(getModelVisibilityOverride('pi', 'p', 'off')).toBe(false);
  });
  it('已初始化的空表不是未初始化，可立即读取目录默认', async () => {
    ready();
    await expect(waitForModelVisibilityMirror()).resolves.toBeUndefined();
    expect(getModelVisibilityOverride('pi', 'p', 'new')).toBeUndefined();
  });
  it('超时与账号边界拒绝等待，切到新Host文件后恢复', async () => {
    vi.useFakeTimers();
    const timeout = expect(waitForModelVisibilityMirror(100)).rejects.toThrow(
      'MODEL_VISIBILITY_NOT_READY',
    );
    await vi.advanceTimersByTimeAsync(100);
    await timeout;
    const boundary = expect(waitForModelVisibilityMirror()).rejects.toThrow(
      'MODEL_VISIBILITY_NOT_READY',
    );
    clearModelVisibilityMirror();
    await boundary;
    ready({ 'pi:p:new': true });
    await expect(waitForModelVisibilityMirror()).resolves.toBeUndefined();
    expect(getModelVisibilityOverride('pi', 'p', 'new')).toBe(true);
  });
});
