import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeHostSettingsSnapshot, HostSettingsRendererApi } from '../../shared/hostSettings';

const host = vi.hoisted(() => ({ root: '', owner: 'owner-a', generation: 1, pending: false, toast: vi.fn(),
  forbiddenOwnerLoad: vi.fn(() => { throw new Error('No session loading or owner-scoped getter'); }),
}));
vi.mock('electron', () => ({ app: { getPath: () => host.root } }));
vi.mock('../../main/appSessionState.js', () => ({
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  getActiveAppSession: host.forbiddenOwnerLoad,
  ownerScopedUserDataPath: host.forbiddenOwnerLoad,
  peekCommittedAppSession: () => ({ mode: 'local', dataOwnerId: host.owner, generation: host.generation }),
  isAppSessionBoundaryPending: () => host.pending,
}));
vi.mock('../../main/logger.js', () => ({ createLogger: () => ({ info() {}, warn() {} }) }));
vi.mock('../lib/toast', () => ({ toast: { error: host.toast } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }));
const values = new Map<string, string>();
const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
const stamp = () => ({ dataOwnerId: host.owner, ownerGeneration: host.generation });
const recommendation = { harness: 'codex' as const, modelId: 'recommended', providerId: 'provider', effort: 'medium', fast: false, thinking: true, worktree: false, planMode: false };
const stops: Array<() => void> = [];
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 15));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); values.clear();
  host.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-renderer-defaults-'));
  host.owner = 'owner-a'; host.generation++; host.pending = false;
  vi.stubGlobal('window', { localStorage }); vi.stubGlobal('localStorage', localStorage);
});
afterEach(async () => {
  stops.splice(0).forEach(stop => stop()); await settle(); vi.unstubAllGlobals();
  try { expect(host.forbiddenOwnerLoad).not.toHaveBeenCalled(); }
  finally { fs.rmSync(host.root, { recursive: true, force: true }); }
});

function seedLegacy() {
  values.set('xdt:newMakerDraft:v1:owner-a', JSON.stringify({ vendor: 'codex', workingDir: '/example/project',
    extraDirs: ['/example/private'], writableDirs: ['/example/write'], attachments: ['private attachment'], prompt: 'private draft',
    defaultTupleCustomized: true, defaultTupleSelectionCustomized: true, modelChosenByVendor: { codex: true, pi: true },
    lastByVendor: { codex: { model: 'saved', providerId: 'chosen', effort: 'high', permissionMode: 'bypassPermissions', planMode: true },
      pi: { model: 'pi-model', providerId: 'pi-provider', effort: 'low', permissionMode: 'auto' } },
    effortByModel: { saved: 'low' }, fastModeByModel: { saved: true }, worktreeEnabled: true, worktreePreferenceCustomized: true }));
  values.set('xdt:providerModelMemory:v2:owner-a', JSON.stringify({
    'codex:chosen': { lastModel: 'saved', effortByModel: { saved: 'medium', other: 'low' }, fastByModel: { saved: true }, thinkingByModel: { saved: false } },
    'pi:pi-provider': { lastModel: 'pi-model', effortByModel: { 'pi-model': 'low' }, fastByModel: {}, thinkingByModel: {} },
  }));
}
async function setup() {
  const service = await import('../../main/host-settings/new-task-defaults');
  service.setNewTaskDefaultRecommendation(stamp(), recommendation);
  const snapshot = (): NativeHostSettingsSnapshot => ({ ownerStamp: stamp(), newTaskDefaults: service.inspectNewTaskDefaults(), history: service.readNewTaskPreferenceHistory(),
    personalization: { status: 'unavailable', revision: null }, databaseWarning: { status: 'unavailable', revision: null }, appearance: { status: 'unavailable', revision: null }, userPrompt: { status: 'unavailable', revision: null }, operationIds: {} });
  const save = async (input: Parameters<HostSettingsRendererApi['saveHistory']>[0]) => {
    await service.saveNewTaskPreferenceHistory(input.history, input.ownerStamp, input.expectedRevision, input.importOnly);
    return snapshot();
  };
  const api = { get: vi.fn(async () => snapshot()), saveHistory: vi.fn(save), update: vi.fn(), importPrompt: vi.fn(),
    onChanged: (callback: Parameters<HostSettingsRendererApi['onChanged']>[0]) => service.onNewTaskDefaultsChanged(() => callback(stamp())) };
  (window as unknown as { electronAPI: unknown }).electronAPI = { hostSettings: api };
  const draft = await import('../state/newMakerDraft');
  const memory = await import('../state/providerModelMemory');
  const generation = await import('../contexts/dataOwnerGeneration');
  const { connectHostNewTaskPreferences } = await import('../state/hostNewTaskPreferences');
  const selectOwner = (owner: string) => {
    host.owner = owner; host.generation++;
    generation.setDataOwnerGeneration(owner, host.generation);
    draft.setNewMakerDraftOwner(owner); memory.setProviderModelMemoryOwner(owner);
  };
  selectOwner(host.owner); service.setNewTaskDefaultRecommendation(stamp(), recommendation);
  const connect = () => { const stop = connectHostNewTaskPreferences(); stops.push(stop); return stop; };
  return { service, snapshot, api, save, draft, memory, selectOwner, connect };
}

 describe('Renderer 从 Host 加载并 CAS 保存新任务默认值', () => {
  it('迁移只发白名单并保留完整 lastModel/历史/显式选择与权限，草稿目录仍留本机', async () => {
    seedLegacy(); const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.service.readNewTaskPreferenceHistory()?.providerModelMemory['codex:chosen'].lastModel).toBe('saved'));
    expect(h.api.saveHistory).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(h.api.saveHistory.mock.calls[0][0]);
    expect(sent).not.toContain('/example'); expect(sent).not.toContain('private'); expect(sent).not.toContain('attachments');
    expect(h.draft.getDraft()).toMatchObject({ workingDir: '/example/project', lastByVendor: { codex: { model: 'saved', effort: 'high', permissionMode: 'bypassPermissions' }, pi: { model: 'pi-model' } }, modelChosenByVendor: { codex: true, pi: true } });
    expect(h.memory.snapshotForHost(host.owner)?.['codex:chosen'].lastModel).toBe('saved');
    expect(h.draft.getDraft().effortByModel.saved).toBe('low');
  });
  it('Host 已初始化/恢复默认后，旧 localStorage 和窗口重挂载不会重导旧设置', async () => {
    seedLegacy(); const h = await setup();
    await h.service.commitNewTaskDefaults({ set: { modelId: 'host-selected' } });
    const stop = h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('host-selected'));
    expect(h.api.saveHistory).not.toHaveBeenCalled();
    await h.service.commitNewTaskDefaults({ clear: ['modelId'] });
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended'));
    stop(); h.connect(); await settle();
    expect(h.api.saveHistory).not.toHaveBeenCalled();
    expect(h.draft.getDraft().defaultTupleSelectionCustomized).toBe(false);
    expect(h.draft.getDraft().lastByVendor.pi.model).toBe('');
  });
  it('用户选模/调档/worktree/plan 合并为一次 CAS，原 localStorage 默认值不再写入', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended'));
    const expectedRevision = h.snapshot().newTaskDefaults.revision;
    h.api.saveHistory.mockClear();
    h.draft.patchVendorPrefs('codex', { model: 'chosen', providerId: 'provider', effort: 'high', planMode: true });
    h.memory.setProviderModelChoice('codex', 'provider', 'chosen', 'high');
    h.memory.setProviderModelFast('codex', 'provider', 'chosen', true);
    h.memory.setProviderModelThinking('codex', 'provider', 'chosen', false);
    h.draft.setFastModeForModel('chosen', true); h.draft.setWorktreePreference(true);
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { modelId: 'chosen', effort: 'high', fast: true, thinking: false, worktree: true, planMode: true } }));
    expect(h.api.saveHistory).toHaveBeenCalledTimes(1);
    expect(h.api.saveHistory.mock.calls[0][0]).toMatchObject({ expectedRevision, importOnly: false, ownerStamp: stamp() });
    expect(values.has('xdt:newMakerDraft:v1:owner-a')).toBe(false);
    expect(values.has('xdt:providerModelMemory:v2:owner-a')).toBe(false);
  });
  it('等待初次读取时用户的新选择保留，但只合并此次编辑而非覆盖 Host 历史', async () => {
    seedLegacy(); const h = await setup();
    await h.service.commitNewTaskDefaults({ set: { modelId: 'host-selected', worktree: false } });
    const gate = deferred<NativeHostSettingsSnapshot>(); h.api.get.mockReturnValueOnce(gate.promise); h.connect();
    h.draft.patchVendorPrefs('codex', { model: 'clicked', providerId: 'provider', effort: 'medium' });
    gate.resolve(h.snapshot());
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { modelId: 'clicked', worktree: false } }));
    expect(h.service.readNewTaskPreferenceHistory()?.lastByVendor.pi?.model).toBe('');
  });
  it('旧 CAS 碰到 Host reset 后只回读，不拿新 revision 自动重放旧整表', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended'));
    h.api.saveHistory.mockClear();
    h.api.saveHistory.mockImplementationOnce(async input => {
      await h.service.commitNewTaskDefaults({ clear: ['modelId', 'providerId', 'harness', 'effort', 'fast', 'thinking', 'planMode', 'worktree'] });
      return h.save(input);
    });
    h.draft.patchVendorPrefs('codex', { model: 'stale-click', providerId: 'provider' });
    await vi.waitFor(() => expect(host.toast).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended'));
    expect(h.api.saveHistory).toHaveBeenCalledTimes(1);
    expect(h.snapshot().newTaskDefaults).toMatchObject({ customizedKeys: [] });
  });
  it('owner 切换后迟到读取不导入、不覆盖新 owner；同 owner 新 generation 也隔离', async () => {
    seedLegacy(); const h = await setup();
    const old = h.snapshot(); const gate = deferred<NativeHostSettingsSnapshot>(); h.api.get.mockReturnValueOnce(gate.promise);
    const stop = h.connect(); stop(); h.selectOwner('owner-b');
    h.service.setNewTaskDefaultRecommendation(stamp(), { ...recommendation, modelId: 'b-model' }); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('b-model'));
    gate.resolve(old); await settle();
    expect(h.draft.getDraft().lastByVendor.codex.model).toBe('b-model');
    expect(h.api.saveHistory.mock.calls.every(([input]) => input.ownerStamp.dataOwnerId === 'owner-b')).toBe(true);
    expect(h.memory.snapshotForHost('owner-b')?.['codex:chosen']).toBeUndefined();
    const stale = h.snapshot(); h.selectOwner('owner-b');
    await expect(h.save({ ownerStamp: stale.ownerStamp!, expectedRevision: stale.newTaskDefaults.revision!, history: stale.history!, importOnly: false })).rejects.toMatchObject({ code: 'OWNER_CHANGED' });
  });
  it('模型/引擎不可用时 Renderer 推荐和 fallback 不修改 Host 选择', async () => {
    seedLegacy(); const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.service.readNewTaskPreferenceHistory()).not.toBeNull());
    expect(h.draft.applySuggestedDefaultTuple({ vendor: 'pi', providerId: 'other', model: 'replacement' })).toBe(false);
    expect(h.draft.fallbackUnavailableVendor(new Set(['pi']))).toBe(false);
    h.service.setNewTaskDefaultRecommendation(stamp(), { ...recommendation, modelId: null, providerId: null, effort: null });
    await settle();
    expect(h.draft.getDraft()).toMatchObject({ vendor: 'codex', lastByVendor: { codex: { model: 'saved', providerId: 'chosen' } } });
  });
  it('Host 默认 Fast/Thinking 覆盖新推荐型号的旧历史，普通偏好保存不冻结默认值', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended'));
    await h.service.applyHostRemoteDraftPreference({ agent: 'codex', providerId: 'provider', modelId: 'later-recommendation', active: false, fast: true, thinking: false });
    h.service.setNewTaskDefaultRecommendation(stamp(), { ...recommendation, modelId: 'later-recommendation' });
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('later-recommendation'));
    expect(h.memory.getProviderModelFast('codex', 'provider', 'later-recommendation')).toBe(false);
    expect(h.memory.getProviderModelThinking('codex', 'provider', 'later-recommendation')).toBe(true);
    h.draft.setWorktreePreference(true);
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { worktree: true }, customizedKeys: ['worktree'] }));
  });
  it('冷启动缺历史槽保持空值，不把 Renderer 种子型号导入 Host', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.service.readNewTaskPreferenceHistory()).not.toBeNull());
    expect(h.service.readNewTaskPreferenceHistory()?.lastByVendor.pi?.model).toBe('');
    expect(h.service.readNewTaskPreferenceHistory()?.lastByVendor.cc?.model).toBe('');
  });
  it('写入回执包含另一个窗口修改时，只重放排队的新编辑而非旧整表', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended')); h.api.saveHistory.mockClear();
    const gate = deferred<void>(); let committed = false;
    h.api.saveHistory.mockImplementationOnce(async input => {
      await h.save(input); committed = true; await gate.promise;
      await h.service.commitNewTaskDefaults({ set: { worktree: true } });
      return h.snapshot();
    });
    h.draft.patchVendorPrefs('codex', { model: 'clicked', providerId: 'provider' });
    await vi.waitFor(() => expect(committed).toBe(true));
    h.draft.patchVendorPrefs('codex', { planMode: true });
    gate.resolve();
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { modelId: 'clicked', worktree: true, planMode: true } }));
    expect(h.api.saveHistory).toHaveBeenCalledTimes(2);
  });
  it('微任务批次内取消修改不提交已撤销的 pending；在飞写入期间反向编辑可保存', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended')); h.api.saveHistory.mockClear();
    h.draft.patchVendorPrefs('codex', { planMode: true }); h.draft.patchVendorPrefs('codex', { planMode: false });
    await settle(); expect(h.api.saveHistory).not.toHaveBeenCalled();
    const gate = deferred<void>(); let entered = false;
    h.api.saveHistory.mockImplementationOnce(async input => { entered = true; await gate.promise; return h.save(input); });
    h.draft.patchVendorPrefs('codex', { planMode: true }); await vi.waitFor(() => expect(entered).toBe(true));
    h.draft.patchVendorPrefs('codex', { planMode: false }); gate.resolve();
    await vi.waitFor(() => expect(h.api.saveHistory).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { planMode: false } }));
  });
  it('首次读取失败后同 owner 的 onChanged 可恢复加载，随后编辑正常 CAS 保存', async () => {
    seedLegacy(); const h = await setup();
    h.api.get.mockRejectedValueOnce(new Error('temporary IPC failure')); h.connect();
    await vi.waitFor(() => expect(host.toast).toHaveBeenCalled());
    await h.service.commitNewTaskDefaults({ set: { modelId: 'host-recovered', worktree: false } });
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('host-recovered'));
    expect(h.api.saveHistory).not.toHaveBeenCalled();
    h.draft.patchVendorPrefs('codex', { planMode: true });
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { modelId: 'host-recovered', worktree: false, planMode: true } }));
    expect(h.api.saveHistory).toHaveBeenCalledTimes(1);
    expect(h.api.saveHistory.mock.calls[0][0].importOnly).toBe(false);
  });
  it('首次读取失败后再次编辑触发回读，只合并这次编辑，不重放旧 localStorage', async () => {
    seedLegacy(); const h = await setup();
    await h.service.commitNewTaskDefaults({ set: { modelId: 'host-selected', worktree: false } });
    h.api.get.mockRejectedValueOnce(new Error('temporary IPC failure')); h.connect();
    await vi.waitFor(() => expect(host.toast).toHaveBeenCalled());
    h.draft.patchVendorPrefs('codex', { model: 'clicked-after-failure', providerId: 'provider', effort: 'medium' });
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { modelId: 'clicked-after-failure', worktree: false, planMode: false } }));
    expect(h.service.readNewTaskPreferenceHistory()?.lastByVendor.pi?.model).toBe('');
    expect(h.api.saveHistory).toHaveBeenCalledTimes(1);
    expect(h.api.saveHistory.mock.calls[0][0].importOnly).toBe(false);
  });
  it('坏文件期间读取与重试均 fail closed，修复后的通知不重放失败期间旧整表', async () => {
    seedLegacy(); const h = await setup();
    await h.service.commitNewTaskDefaults({ set: { modelId: 'host-selected', worktree: false } });
    const file = path.join(host.root, 'owners', `test-${host.owner}`, 'host-new-task-defaults.json');
    const good = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, '{invalid');
    h.connect(); await vi.waitFor(() => expect(host.toast).toHaveBeenCalledTimes(1));
    h.draft.patchVendorPrefs('codex', { model: 'must-not-replay', providerId: 'provider' });
    await vi.waitFor(() => expect(host.toast).toHaveBeenCalledTimes(2));
    expect(h.api.saveHistory).not.toHaveBeenCalled(); expect(fs.readFileSync(file, 'utf8')).toBe('{invalid');
    fs.writeFileSync(file, good);
    await h.service.commitNewTaskDefaults({ set: { worktree: true } });
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('host-selected'));
    expect(h.api.saveHistory).not.toHaveBeenCalled();
    h.draft.patchVendorPrefs('codex', { planMode: true });
    await vi.waitFor(() => expect(h.snapshot().newTaskDefaults).toMatchObject({ value: { modelId: 'host-selected', worktree: true, planMode: true } }));
  });
  it('工作目录/附加目录/附件不是默认值，不触发 Host 写入，也不丢本机工作区持久化', async () => {
    const h = await setup(); h.connect();
    await vi.waitFor(() => expect(h.draft.getDraft().lastByVendor.codex.model).toBe('recommended')); h.api.saveHistory.mockClear();
    h.draft.patchDraft({ workingDir: '/example/project', extraDirs: ['/example/private'], writableDirs: ['/example/write'] });
    await settle(); expect(h.api.saveHistory).not.toHaveBeenCalled();
    expect(JSON.parse(values.get('xdt:newMakerDraft:v1:owner-a:workspace')!)).toMatchObject({ workingDir: '/example/project' });
    expect(values.get('xdt:newMakerDraft:v1:owner-a:workspace')).not.toContain('/example/private');
  });
});
