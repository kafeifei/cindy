import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewTaskPreferenceHistory } from '../../../shared/newTaskPreferenceHistory';
import { normalizeHostSettingsChange } from '../../../shared/hostSettings.js';

const host = vi.hoisted(() => ({ root: '', owner: 'owner-a', generation: 1, pending: false,
  forbidden: vi.fn(() => { throw new Error('No session load or owner-scoped getter'); }),
}));
vi.mock('electron', () => ({ app: { getPath: () => host.root } }));
vi.mock('../../appSessionState.js', () => ({
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  getActiveAppSession: host.forbidden,
  ownerScopedUserDataPath: host.forbidden,
  peekCommittedAppSession: () => ({ mode: 'local', dataOwnerId: host.owner, generation: host.generation }),
  isAppSessionBoundaryPending: () => host.pending,
}));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info() {}, warn() {} }) }));
import { inspectNewTaskDefaults, commitNewTaskDefaults, readNewTaskPreferenceHistory, saveNewTaskPreferenceHistory, setNewTaskDefaultRecommendation, applyHostRemoteDraftPreference } from '../new-task-defaults';
import { installHostNewMakerDefaultsSource } from '../cache';
import { getRemoteNewMakerDefaults, getWorkerDefaultsFromNewMaker, syncNewMakerDraftCache, getSelectedNewMakerRoute } from '../../maker-host/newMakerDefaultsCache';

const stamp = () => ({ dataOwnerId: host.owner, ownerGeneration: host.generation });
const recommendation = { harness: 'codex' as const, providerId: 'connected', modelId: 'recommended', effort: 'medium', fast: false, thinking: true, worktree: false, planMode: false };
function revision() { const state = inspectNewTaskDefaults(); if (state.status !== 'ready') throw new Error('fixture unreadable'); return state.revision; }
function legacy(): NewTaskPreferenceHistory {
  return { vendor: 'codex', defaultTupleCustomized: true, defaultTupleSelectionCustomized: true,
    modelChosenByVendor: { codex: true, pi: true },
    lastByVendor: { codex: { model: 'saved', effort: 'high', providerId: 'chosen', permissionMode: 'bypassPermissions', planMode: true },
      pi: { model: 'pi-history', effort: 'low', providerId: 'pi-provider', permissionMode: 'auto' } },
    effortByModel: { saved: 'low', other: 'medium' }, fastModeByModel: { saved: true, other: false },
    worktreeEnabled: true, worktreePreferenceCustomized: true,
    providerModelMemory: { 'codex:chosen': { lastModel: 'saved', effortByModel: { saved: 'medium', other: 'high' }, fastByModel: { saved: true }, thinkingByModel: { saved: false } },
      'pi:pi-provider': { lastModel: 'pi-history', effortByModel: { 'pi-history': 'low' }, fastByModel: {}, thinkingByModel: {} } } };
}
beforeEach(() => {
  host.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-host-defaults-'));
  host.owner = 'owner-a'; host.generation++; host.pending = false;
  setNewTaskDefaultRecommendation(stamp(), recommendation);
  installHostNewMakerDefaultsSource();
});
afterEach(() => {
  try { expect(host.forbidden).not.toHaveBeenCalled(); }
  finally { fs.rmSync(host.root, { recursive: true, force: true }); }
});

describe('Host 新任务默认值迁移与真源', () => {
  it('纯读不创建配置；没有当前 owner 的推荐时保持空模型而不是 Opus', () => {
    expect(inspectNewTaskDefaults()).toMatchObject({ status: 'ready', value: recommendation });
    expect(fs.readdirSync(host.root)).toEqual([]);
    host.generation++;
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { modelId: null, providerId: null } });
    expect(fs.readdirSync(host.root)).toEqual([]);
  });
  it('一次性迁移保留每个引擎/来源历史、lastModel、显式选择、权限与全部调档', async () => {
    const history = legacy();
    await saveNewTaskPreferenceHistory(history, stamp(), revision(), true);
    expect(readNewTaskPreferenceHistory()).toEqual(history);
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { harness: 'codex', providerId: 'chosen', modelId: 'saved', effort: 'high', fast: true, thinking: false, worktree: true, planMode: true } });
    expect(getRemoteNewMakerDefaults('codex')).toMatchObject({ effort: 'high', model: 'saved', permissionMode: 'bypassPermissions', modelChosenByUser: true, hostAuthoritative: true, planMode: true });
    expect(getWorkerDefaultsFromNewMaker('codex')).toMatchObject({ effort: 'low', model: 'saved' });
    expect(getRemoteNewMakerDefaults('pi')).toMatchObject({ model: 'pi-history', permissionMode: 'auto' });
  });
  it('Host 已改及 reset 的初始化墓碑阻止旧 localStorage 重导', async () => {
    await commitNewTaskDefaults({ set: { modelId: 'host-choice' } });
    expect(await saveNewTaskPreferenceHistory(legacy(), stamp(), revision(), true)).toBe('already_initialized');
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { modelId: 'host-choice' } });
    await commitNewTaskDefaults({ clear: ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking', 'worktree', 'planMode'] });
    expect(await saveNewTaskPreferenceHistory(legacy(), stamp(), revision(), true)).toBe('already_initialized');
    expect(inspectNewTaskDefaults()).toMatchObject({ value: recommendation, customizedKeys: [] });
  });
  it('失效 CAS、owner 切换和同 owner generation 变化都不能写入', async () => {
    const old = revision(); const owner = stamp();
    await commitNewTaskDefaults({ set: { worktree: true } });
    await expect(saveNewTaskPreferenceHistory(legacy(), owner, old, true)).rejects.toMatchObject({ code: 'CONFLICT' });
    host.owner = 'owner-b'; host.generation++;
    await expect(saveNewTaskPreferenceHistory(legacy(), owner, revision(), false)).rejects.toMatchObject({ code: 'OWNER_CHANGED' });
    host.owner = owner.dataOwnerId;
    await expect(saveNewTaskPreferenceHistory(legacy(), owner, revision(), true)).rejects.toMatchObject({ code: 'OWNER_CHANGED' });
    expect(readNewTaskPreferenceHistory()?.worktreeEnabled).toBe(true);
  });
  it('目录推荐变化/供应商失联不偷偷替换显式选择；读取不会覆盖 Host 文件', async () => {
    await saveNewTaskPreferenceHistory(legacy(), stamp(), revision(), true);
    const file = path.join(host.root, 'owners', `test-${host.owner}`, 'host-new-task-defaults.json'); const before = fs.readFileSync(file, 'utf8');
    setNewTaskDefaultRecommendation(stamp(), { ...recommendation, providerId: null, modelId: null, effort: null });
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { modelId: 'saved', providerId: 'chosen', effort: 'high' } });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
  it('reset 删除旧型号的调档而非新推荐型号，之后无关偏好保存不复活', async () => {
    await saveNewTaskPreferenceHistory(legacy(), stamp(), revision(), true);
    await commitNewTaskDefaults({ clear: ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking', 'worktree', 'planMode'] });
    const history = readNewTaskPreferenceHistory()!;
    expect(history.effortByModel.saved).toBeUndefined();
    expect(history.providerModelMemory['codex:chosen'].thinkingByModel.saved).toBeUndefined();
    expect(history.providerModelMemory['codex:chosen'].lastModel).toBe('saved');
    await saveNewTaskPreferenceHistory(history, stamp(), revision(), false);
    expect(inspectNewTaskDefaults()).toMatchObject({ value: recommendation, customizedKeys: [] });
  });
  it('Renderer 整包旧镜像在 Host source 存在时不能覆盖；owner 切换不泄漏旧缓存', async () => {
    await commitNewTaskDefaults({ set: { modelId: 'host-choice' } });
    expect(syncNewMakerDraftCache({ ownerStamp: stamp(), vendor: 'pi', lastByVendor: { pi: { model: 'renderer' } }, effortByModel: {}, fastModeByModel: {} }, stamp(), 'old', false)).toBe(false);
    expect(getRemoteNewMakerDefaults('codex').model).toBe('host-choice');
    host.owner = 'owner-b'; host.generation++;
    expect(getWorkerDefaultsFromNewMaker('codex')).toEqual({});
    expect(getSelectedNewMakerRoute('local:owner-a:1')).toBeUndefined();
  });
  it('没有 Renderer 的远端显式选择与非选中型号调档都写入 Host', async () => {
    await applyHostRemoteDraftPreference({ agent: 'pi', providerId: 'provider', modelId: 'remote-model', active: true, effort: 'high', fast: true, thinking: false });
    await applyHostRemoteDraftPreference({ agent: 'pi', providerId: 'provider', modelId: 'other', active: false, effort: 'low', fast: false });
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { harness: 'pi', modelId: 'remote-model', effort: 'high', fast: true, thinking: false } });
    expect(readNewTaskPreferenceHistory()?.providerModelMemory['pi:provider']).toMatchObject({ lastModel: 'remote-model', effortByModel: { other: 'low' } });
  });
  it('未改变的局部显式 override 不因保存历史扩成整组路由；空模型也保留显式 false/null', async () => {
    await commitNewTaskDefaults({ set: { modelId: 'partial' } });
    await saveNewTaskPreferenceHistory(readNewTaskPreferenceHistory(), stamp(), revision(), false);
    expect(inspectNewTaskDefaults()).toMatchObject({ customizedKeys: ['modelId'] });
    await commitNewTaskDefaults({ set: { modelId: null, effort: null, fast: false, thinking: false } });
    await saveNewTaskPreferenceHistory(readNewTaskPreferenceHistory(), stamp(), revision(), false);
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { modelId: null, effort: null, fast: false, thinking: false } });
  });
  it('历史路由原字节保留，新增 helper 输入的 trim 不反向改写旧型号', async () => {
    const history = legacy();
    history.lastByVendor.codex!.providerId = '  chosen  ';
    history.lastByVendor.codex!.model = '  saved  ';
    await saveNewTaskPreferenceHistory(history, stamp(), revision(), true);
    expect(inspectNewTaskDefaults()).toMatchObject({ value: { providerId: '  chosen  ', modelId: '  saved  ' } });
    expect(readNewTaskPreferenceHistory()?.lastByVendor.codex).toEqual(history.lastByVendor.codex);
    expect(normalizeHostSettingsChange({ domain: 'newTaskDefaults', set: { providerId: '  chosen  ', modelId: '  saved  ' } }).set)
      .toEqual({ providerId: 'chosen', modelId: 'saved' });
  });
  it.each(['workingDir', 'attachments', 'writableDirs', 'prompt'])('迁移白名单拒绝任务字段 %s', async field => {
    await expect(saveNewTaskPreferenceHistory({ ...legacy(), [field]: 'not-settings' }, stamp(), revision(), true)).rejects.toThrow('INVALID_PREFERENCE_HISTORY');
    expect(fs.readdirSync(host.root)).toEqual([]);
  });
});
