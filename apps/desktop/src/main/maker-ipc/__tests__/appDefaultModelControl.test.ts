import type { BotModelRoute } from '../../../shared/botModelChain';
import type { ProviderView } from '@cindy/model-providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppDefaultModel, inspectAppDefaultModel, validateTaskModel, resolveTaskModelSelection } from '../appDefaultModelControl';
import { setNewMakerDraftCache, syncNewMakerDraftCache } from '../../maker-host/newMakerDefaultsCache';

const host = vi.hoisted(() => ({ owner: 'owner:1', enabled: true, connected: true, agents: ['codex'],
  enableSecond: false, revision: 'revision-1', providers: vi.fn(), service: vi.fn(), commit: vi.fn() }));
vi.mock('../../maker-host/index.js', () => ({ getMakerIfReady: () => ({ listAvailableAgents: () => host.agents }) }));
vi.mock('../../maker-host/createDesktopProviderService.js', () => ({ getDesktopProviderService: host.service }));
vi.mock('../../host-settings/new-task-defaults.js', () => ({
  inspectNewTaskDefaults: () => ({ status: 'ready', revision: host.revision }),
  commitNewTaskDefaults: host.commit,
}));
vi.mock('../../maker-host/model-visibility-mirror.js', () => ({
  waitForModelVisibilityMirror: async () => {}, getModelVisibilityOverride: (_a: string, _p: string, model: string) => host.enabled && (model === 'luna' || (model === 'sol' && host.enableSecond)),
}));
vi.mock('../../appSessionState.js', () => ({
  activeOwnerScopeKey: () => host.owner, isAppSessionBoundaryPending: () => false,
}));
const route = { harness: 'codex' as const, providerId: 'openai', model: 'luna', effort: 'medium', fastMode: false };
const mirror = (selectedRoute: BotModelRoute = route) => setNewMakerDraftCache({ selectedRoute,
  lastByVendor: {}, fastModeByModel: {}, effortByModel: {} }, host.owner);
const id = JSON.stringify(['codex', 'openai', 'luna']);

beforeEach(() => {
  vi.clearAllMocks();
  host.enableSecond = false; host.revision = 'revision-1';
  host.owner = 'owner:1'; host.enabled = true; host.connected = true; host.agents = ['codex'];
  host.service.mockReturnValue({ listProviders: host.providers });
  host.providers.mockImplementation(async () => [{ id: 'openai', source: 'builtin', connected: host.connected, agents: ['codex'], routing: { codex: { upstream: 'https://example.invalid', authStrategy: 'oauth-passthrough' } },
    models: { codex: ['luna', 'sol'].map(model => ({ id: model, status: 'active', mode: 'chat', defaultEnabled: true,
      efforts: ['low', 'medium'], defaultEffort: 'medium', supportsFastMode: true })) } }] as ProviderView[]);
  host.commit.mockImplementation(async (_mutation, options) => { options.assertCurrent(); return { revision: 'revision-saved' }; });
  mirror();
});

describe('直接写入 Host 的应用默认模型', () => {
  it('查询只列出启用且连接的模型，不修复连接配置、不触发保存', async () => {
    expect(await inspectAppDefaultModel()).toMatchObject({ current: route, available: [{ id, route }] });
    expect((await inspectAppDefaultModel()).available).toHaveLength(1);
    expect(host.service).toHaveBeenCalledWith({ allowSideEffects: false });
    expect(host.providers).toHaveBeenCalledWith({ allowSideEffects: false, includeMediaReadiness: false });
    expect(host.commit).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'disconnected', 'missing harness'] as const)('拒绝已失效选择 %s，不偷偷选其它模型', async failure => {
    await inspectAppDefaultModel();
    if (failure === 'disabled') host.enabled = false;
    if (failure === 'disconnected') host.connected = false;
    if (failure === 'missing harness') host.agents = [];
    await expect(changeAppDefaultModel(id)).rejects.toThrow();
    expect(host.commit).not.toHaveBeenCalled();
    expect((await inspectAppDefaultModel()).current).toEqual(route);
  });
  it('validates the complete task route including harness, account and tuning without changing defaults', async () => {
    expect(await validateTaskModel(route)).toBe(true);
    for (const patch of [{ harness: 'pi' as const }, { providerId: 'another-account' }, { effort: 'ultra' }]) {
      expect(await validateTaskModel({ ...route, ...patch })).toBe(false);
    }
    host.connected = false;
    expect(await validateTaskModel(route)).toBe(false);
    expect((await inspectAppDefaultModel()).current).toEqual(route);
  });
  it('resolves a one-task selection without changing application preferences', async () => {
    expect(await resolveTaskModelSelection({ id, effort: 'low', fastMode: true })).toEqual({ ...route, effort: 'low', fastMode: true });
    expect(await resolveTaskModelSelection({ id })).toEqual(route);
    expect((await inspectAppDefaultModel()).current).toEqual(route);
    expect(host.commit).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'disconnected', 'harness', 'account', 'effort', 'fast'] as const)('rejects an unavailable one-task selection: %s', async failure => {
    const selection = { id, effort: 'medium', fastMode: false };
    if (failure === 'disabled') host.enabled = false;
    if (failure === 'disconnected') host.connected = false;
    if (failure === 'harness') host.agents = [];
    if (failure === 'account') selection.id = JSON.stringify(['codex', 'other-account', 'luna']);
    if (failure === 'effort') selection.effort = 'ultra';
    if (failure === 'fast') {
      const providers = await host.providers(); providers[0].models.codex[0].supportsFastMode = false;
      host.providers.mockResolvedValue(providers); selection.fastMode = true;
    }
    await expect(resolveTaskModelSelection(selection)).rejects.toThrow();
  });
  it('acknowledges only persisted Host defaults without requiring a renderer mirror', async () => {
    expect(await changeAppDefaultModel(id, 'low')).toEqual({
      current: { ...route, effort: 'low' }, saved: true, revision: 'revision-saved', application: 'next_task',
    });
    expect(host.commit).toHaveBeenCalledWith({ set: {
      harness: 'codex', providerId: 'openai', modelId: 'luna', effort: 'low', fast: false,
    } }, { expectedRevision: 'revision-1', assertCurrent: expect.any(Function) });
    expect((await inspectAppDefaultModel()).current).toEqual(route);
  });
  it('保存失败不伪造成功回执', async () => {
    host.commit.mockRejectedValue(new Error('CONFLICT'));
    await expect(changeAppDefaultModel(id)).rejects.toThrow('CONFLICT');
  });
  it.each(['openai', null])('只改 effort 时保留 Fast，来源 %s', async providerId => {
    mirror({ ...route, providerId, fastMode: true });
    expect((await changeAppDefaultModel(id, 'low')).current).toEqual({ ...route, effort: 'low', fastMode: true });
  });
  it('重新选择未传额外参数时保留当前 effort/Fast', async () => {
    mirror({ ...route, effort: 'low', fastMode: true });
    expect((await changeAppDefaultModel(id)).current).toEqual({ ...route, effort: 'low', fastMode: true });
  });
  it('目标能力不支持 Fast 时显式换模不会携带旧 Fast', async () => {
    mirror({ ...route, fastMode: true });
    const providers = await host.providers(); providers[0].models.codex[0].supportsFastMode = false;
    host.providers.mockResolvedValue(providers);
    expect((await changeAppDefaultModel(id, 'low')).current.fastMode).toBe(false);
  });
  it.each([true, false])('切模型恢复 Host 每来源调档记忆，包括 false Fast=%s', async rememberedFast => {
    host.enableSecond = true;
    setNewMakerDraftCache({ selectedRoute: route, lastByVendor: {}, effortByModel: {}, fastModeByModel: {},
      providerModelMemory: { 'codex:openai': { effortByModel: { sol: 'low' }, fastByModel: { sol: rememberedFast } } } }, host.owner);
    expect((await changeAppDefaultModel(JSON.stringify(['codex', 'openai', 'sol']))).current).toEqual({ ...route, model: 'sol', effort: 'low', fastMode: rememberedFast });
  });
  it('只按目标能力约束用户本次显式选择，不改其它记忆', async () => {
    host.enableSecond = true;
    setNewMakerDraftCache({ selectedRoute: route, lastByVendor: {}, effortByModel: {}, fastModeByModel: {},
      providerModelMemory: { 'codex:openai': { effortByModel: { sol: 'removed-effort' }, fastByModel: { sol: true } } } }, host.owner);
    const providers = await host.providers(); providers[0].models.codex[1].supportsFastMode = false;
    host.providers.mockResolvedValue(providers);
    const target = (await inspectAppDefaultModel()).available.find(item => item.route.model === 'sol');
    expect(target?.route).toMatchObject({ effort: 'medium', fastMode: false });
    expect(host.commit).not.toHaveBeenCalled();
  });
  it('目录读取期间 owner 切换时拒绝写入', async () => {
    const providers = await host.providers();
    host.providers.mockImplementation(async () => { host.owner = 'owner:2'; return providers; });
    await expect(changeAppDefaultModel(id)).rejects.toThrow('账号');
    expect(host.commit).not.toHaveBeenCalled();
  });
  it('实际提交锁内重验 owner 和调用方，不只是读取前检查', async () => {
    const assertCaller = vi.fn();
    host.commit.mockImplementation(async (_mutation, options) => { host.owner = 'owner:2'; options.assertCurrent(); });
    await expect(changeAppDefaultModel(id, undefined, assertCaller)).rejects.toThrow('账号');
    expect(assertCaller).toHaveBeenCalledTimes(2);
  });
  it('不支持的 effort 不写入', async () => {
    await expect(changeAppDefaultModel(id, 'ultra')).rejects.toThrow('不可用');
    expect(host.commit).not.toHaveBeenCalled();
  });
});
