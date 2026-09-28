// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSettingsRendererApi, NativeHostSettingsSnapshot, SettingsOwnerStamp } from '../../shared/hostSettings';
import { getUserPrompt, getUserPromptView, resetUserPrompt, setUserPrompt, setUserPromptOwner } from '@/lib/userPromptStore';
import { getDataOwnerGeneration, setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';

interface Saved { value: string; customized: boolean; initialized: boolean; revision: number }
const saved = new Map<string, Saved>();
let changed: ((stamp: SettingsOwnerStamp | null) => void) | undefined;
let serial = 0;
const stamp = (): SettingsOwnerStamp => {
  const owner = getDataOwnerGeneration();
  return { dataOwnerId: owner.dataOwnerId, ownerGeneration: owner.generation };
};
function state(): Saved {
  const id = stamp().dataOwnerId!;
  if (!saved.has(id)) saved.set(id, { value: '', customized: false, initialized: false, revision: 1 });
  return saved.get(id)!;
}
function snapshot(): NativeHostSettingsSnapshot {
  const current = state();
  return {
    ownerStamp: stamp(),
    newTaskDefaults: { status: 'unavailable', revision: null },
    databaseWarning: { status: 'unavailable', revision: null },
    appearance: { status: 'unavailable', revision: null },
    personalization: { status: 'ready', value: { isCustomized: current.customized }, defaults: { isCustomized: false }, customizedKeys: [], isCustomized: current.customized, revision: String(current.revision) },
    userPrompt: { status: 'ready', value: { userPrompt: current.value }, defaults: { userPrompt: '' }, customizedKeys: current.customized ? ['userPrompt'] : [], isCustomized: current.customized, revision: String(current.revision) },
    history: null,
    operationIds: { personalization: `operation-${++serial}` },
  };
}
const api = {
  get: vi.fn<HostSettingsRendererApi['get']>(),
  importPrompt: vi.fn<HostSettingsRendererApi['importPrompt']>(),
  update: vi.fn<HostSettingsRendererApi['update']>(),
  saveHistory: vi.fn<HostSettingsRendererApi['saveHistory']>(),
  onChanged: vi.fn<HostSettingsRendererApi['onChanged']>(),
};
function owner(id: string | null) { setDataOwnerGeneration(id); setUserPromptOwner(id); }
const ready = () => vi.waitFor(() => expect(getUserPromptView().ready).toBe(true));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear(); saved.clear(); vi.resetAllMocks();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { hostSettings: api } });
  api.get.mockImplementation(async () => snapshot());
  api.onChanged.mockImplementation(callback => { changed = callback; return () => { changed = undefined; }; });
  api.importPrompt.mockImplementation(async input => {
    const current = state();
    if (!current.initialized) {
      current.value = input.userPrompt;
      current.customized = input.userPrompt !== '';
      current.initialized = true;
      current.revision += 1;
    }
    return snapshot();
  });
  api.update.mockImplementation(async input => {
    const current = state();
    if (input.expectedRevision !== String(current.revision)) return { domain: input.domain, operationId: input.operationId, status: 'rejected', saved: false, application: 'not_applied', code: 'CONFLICT' };
    current.value = input.clear ? '' : input.set!.userPrompt as string;
    current.customized = !input.clear;
    current.initialized = true;
    current.revision += 1;
    return { domain: input.domain, operationId: input.operationId, status: 'saved', saved: true, application: 'next_agent_start', revision: String(current.revision) };
  });
});
afterEach(() => { owner(null); localStorage.clear(); });

describe('Host 个性化显示缓存与一次性迁移', () => {
  it('将无作用域旧值交给首位 owner 的 Host，保留原文但不让另一账号认领', async () => {
    localStorage.setItem('userPrompt.value', 'legacy prompt');
    owner('owner-a'); await ready();
    expect(getUserPrompt()).toBe('legacy prompt');
    expect(api.importPrompt).toHaveBeenCalledWith(expect.objectContaining({ userPrompt: 'legacy prompt', ownerStamp: stamp() }));
    expect(localStorage.getItem('userPrompt.value')).toBe('legacy prompt');
    expect(localStorage.getItem('userPrompt.hostMigrationOwner')).toBe('owner-a');
    owner('owner-b'); await ready();
    expect(getUserPrompt()).toBe(''); expect(api.importPrompt).toHaveBeenCalledOnce();
  });
  it('优先导入 owner 旧值而不是无作用域正文', async () => {
    localStorage.setItem('userPrompt.value', 'legacy prompt');
    localStorage.setItem('userPrompt.value.owner-a', 'owner prompt');
    owner('owner-a'); await ready();
    expect(getUserPrompt()).toBe('owner prompt');
    expect(localStorage.getItem('userPrompt.value.owner-a')).toBe('owner prompt');
  });
  it('已初始化的 Host 值和 reset 标记不被旧 localStorage 覆盖', async () => {
    localStorage.setItem('userPrompt.value.owner-a', 'old');
    saved.set('owner-a', { value: 'host', customized: true, initialized: true, revision: 3 });
    owner('owner-a'); await ready(); expect(getUserPrompt()).toBe('host');
    await resetUserPrompt(); await ready();
    expect(api.update).toHaveBeenLastCalledWith(expect.objectContaining({ clear: ['userPrompt'] }));
    expect(api.update.mock.lastCall![0]).not.toHaveProperty('set');
    owner(null); owner('owner-a'); await ready();
    expect(getUserPromptView()).toMatchObject({ value: '', customized: false });
  });
  it('没有 Host API 时不把旧 localStorage 当成权威，也不假报保存成功', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    localStorage.setItem('userPrompt.value.owner-a', 'old');
    owner('owner-a');
    expect(getUserPrompt()).toBe('');
    await expect(setUserPrompt('new')).rejects.toThrow('SETTINGS_NOT_READY');
  });
  it('等待 Host 确认后才更新；显式空串仍保留 override', async () => {
    owner('owner-a'); await ready();
    const result = deferred<Awaited<ReturnType<HostSettingsRendererApi['update']>>>();
    api.update.mockImplementationOnce(() => result.promise);
    const pending = setUserPrompt('new'); await vi.waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(getUserPrompt()).toBe('');
    state().value = 'new'; state().customized = true; state().revision += 1;
    result.resolve({ domain: 'personalization', operationId: 'op', status: 'saved', saved: true, application: 'next_agent_start', revision: String(state().revision) });
    await pending; await ready(); expect(getUserPrompt()).toBe('new');
    await setUserPrompt(''); await ready();
    expect(getUserPromptView()).toMatchObject({ value: '', customized: true });
  });
  it('等待首次加载时切换 owner，不把旧草稿保存给新 owner', async () => {
    const response = deferred<NativeHostSettingsSnapshot>();
    api.get.mockImplementationOnce(() => response.promise);
    owner('owner-a'); const old = snapshot();
    const pending = setUserPrompt('old draft');
    owner('owner-b'); await ready(); response.resolve(old);
    await expect(pending).rejects.toThrow('OWNER_CHANGED');
    expect(api.update).not.toHaveBeenCalled(); expect(getUserPrompt()).toBe('');
  });
  it('保存等待期间切换 owner，不接受上一身份的回执或回读', async () => {
    owner('owner-a'); await ready();
    const response = deferred<Awaited<ReturnType<HostSettingsRendererApi['update']>>>();
    api.update.mockImplementationOnce(() => response.promise);
    const pending = setUserPrompt('old'); await vi.waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    owner('owner-b'); await ready();
    response.resolve({ operationId: 'op', domain: 'personalization', saved: true, status: 'saved', application: 'next_agent_start' });
    await expect(pending).rejects.toThrow('OWNER_CHANGED'); expect(getUserPrompt()).toBe('');
  });
  it('迟到的旧查询不能覆盖更新通知后的新查询', async () => {
    owner('owner-a'); await ready(); const old = snapshot();
    const response = deferred<NativeHostSettingsSnapshot>();
    api.get.mockImplementationOnce(() => response.promise);
    changed!(stamp()); state().value = 'latest'; state().revision += 1; changed!(stamp());
    await vi.waitFor(() => expect(getUserPrompt()).toBe('latest'));
    response.resolve(old); await Promise.resolve(); await Promise.resolve();
    expect(getUserPrompt()).toBe('latest');
  });
  it('坏文件状态不伪装成默认值，拒绝保存', async () => {
    api.get.mockImplementationOnce(async () => ({ ...snapshot(), userPrompt: { status: 'unreadable', revision: null } }));
    owner('owner-a'); await vi.waitFor(() => expect(getUserPromptView().unavailable).toBe(true));
    await expect(setUserPrompt('new')).rejects.toThrow('SETTINGS_NOT_READY');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('保存已确认但回读失败时仍成功，不诱导重放已保存的操作', async () => {
    owner('owner-a'); await ready(); api.get.mockRejectedValueOnce(new Error('fixture unavailable'));
    await expect(setUserPrompt('saved')).resolves.toBeUndefined();
    await vi.waitFor(() => expect(getUserPromptView().unavailable).toBe(true));
    expect(getUserPrompt()).toBe('saved');
  });
  it('外部变化后拒绝用编辑开始时的旧 revision 覆盖', async () => {
    owner('owner-a'); await ready(); const revision = getUserPromptView().revision!;
    state().value = 'external'; state().revision += 1; changed!(stamp());
    await vi.waitFor(() => expect(getUserPrompt()).toBe('external'));
    await expect(setUserPrompt('draft', revision)).rejects.toThrow('CONFLICT');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('Host 拒绝保存时保留回读后的真实值，不伪造成功', async () => {
    owner('owner-a'); await ready();
    api.update.mockResolvedValueOnce({ operationId: 'op', domain: 'personalization', status: 'rejected', saved: false, application: 'not_applied', code: 'CONFLICT' });
    await expect(setUserPrompt('not saved')).rejects.toThrow('CONFLICT'); await ready();
    expect(getUserPrompt()).toBe('');
  });
  it('退出立即清正文、撤销订阅，同 owner 重复通知不重新迁移', async () => {
    owner('owner-a'); await ready(); const count = api.get.mock.calls.length;
    setUserPromptOwner('owner-a'); expect(api.get).toHaveBeenCalledTimes(count);
    owner(null); expect(getUserPromptView()).toMatchObject({ value: '', ready: false }); expect(changed).toBeUndefined();
  });
  it('拒绝超过 8000 字符的正文，不调用 Host', async () => {
    owner('owner-a'); await ready();
    await expect(setUserPrompt('x'.repeat(8001))).rejects.toThrow('INVALID_PARAMS');
    expect(api.update).not.toHaveBeenCalled();
  });
});
