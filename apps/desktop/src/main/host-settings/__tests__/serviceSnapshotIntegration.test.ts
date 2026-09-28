import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostSettingsDomain, HostSettingsUpdate } from '../../../shared/hostSettings.js';

const isolated = vi.hoisted(() => ({
  root: '', owner: 'fixture-owner', generation: 1, pending: false,
  forbiddenOwnerLoad: vi.fn(() => { throw new Error('No session loading or owner-scoped getter'); }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron', () => ({ app: { getPath: () => isolated.root } }));
vi.mock('../../logger.js', () => ({ createLogger: () => isolated.logger }));
vi.mock('../../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => isolated.logger } }));
vi.mock('../../appSessionState.js', () => ({
  activeOwnerScopeKey: () => String(isolated.generation),
  peekCommittedAppSession: () => ({ mode: 'cloud', dataOwnerId: isolated.owner, generation: isolated.generation }),
  isAppSessionBoundaryPending: () => isolated.pending,
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  getActiveAppSession: isolated.forbiddenOwnerLoad,
  ownerScopedUserDataPath: isolated.forbiddenOwnerLoad,
}));
import {
  configureHostSettingsApplication, getHostSettings, getHostSettingsOperation,
  onHostSettingsChanged, readHostSettings, updateHostSettings,
} from '../index.js';
import { projectSettingsSnapshot } from '../snapshotProjection.js';
import { inspectPreferenceSettingsForSnapshot } from '../readers/preferences.js';
import { captureHostPersonalization } from '../startup.js';
import { importLegacyPersonalization, inspectPersonalizationForSnapshot, settingsOwnerFilePath } from '../personalization.js';
import { setNewTaskDefaultRecommendation, inspectNewTaskDefaultsForSnapshot } from '../new-task-defaults.js';
import { writeDatabaseSizeWarningSettings } from '../../database-size-warning-settings.js';

const confirm = vi.fn(async () => true);
const appearance = vi.fn();
const warning = vi.fn();
const validate = vi.fn(async () => {});
const caller = { id: 'fixture-session', assertCurrent: () => {}, confirm };
const disposers: Array<() => void> = [];
async function change(domain: HostSettingsDomain, values: Pick<HostSettingsUpdate, 'set' | 'clear'>) {
  const current = await getHostSettings(caller, domain);
  if (current.status !== 'ready' || !('operationId' in current)) throw new Error('fixture settings not ready');
  return { domain, expectedRevision: current.revision, operationId: current.operationId, ...values };
}
beforeEach(() => {
  isolated.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-service-snapshot-'));
  isolated.owner = 'fixture-owner'; isolated.generation += 1; isolated.pending = false;
  vi.clearAllMocks(); confirm.mockResolvedValue(true); appearance.mockImplementation(() => {}); warning.mockImplementation(() => {});
  configureHostSettingsApplication({ appearance, databaseWarning: warning, validateNewTaskDefaults: validate });
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  try { expect(isolated.forbiddenOwnerLoad).not.toHaveBeenCalled(); }
  finally { fs.rmSync(isolated.root, { recursive: true, force: true }); }
});

describe('真实 Host 领域保存到脱敏快照的集成', () => {
  it('真实 owner ForSnapshot 从纯内存定位读取，不触发通用会话 getter 或写盘', () => {
    const dir = path.join(isolated.root, 'owners', `test-${isolated.owner}`);
    fs.mkdirSync(dir, { recursive: true });
    const promptFile = path.join(dir, 'host-personalization.json');
    const defaultsFile = path.join(dir, 'host-new-task-defaults.json');
    const promptBytes = JSON.stringify({ _initialized: true, userPrompt: 'private-fixture-body' });
    const defaultsBytes = JSON.stringify({ _initialized: true, worktree: true });
    fs.writeFileSync(promptFile, promptBytes); fs.writeFileSync(defaultsFile, defaultsBytes);
    const writes = [vi.spyOn(fs, 'writeFileSync'), vi.spyOn(fs, 'mkdirSync'), vi.spyOn(fs, 'unlinkSync')];
    try {
      expect(settingsOwnerFilePath('host-personalization.json')).toBe(promptFile);
      expect(inspectPersonalizationForSnapshot()).toMatchObject({ status: 'ready', value: { isCustomized: true } });
      expect(inspectNewTaskDefaultsForSnapshot()).toMatchObject({ status: 'ready', value: { worktree: true } });
      for (const spy of writes) expect(spy).not.toHaveBeenCalled();
      expect(isolated.forbiddenOwnerLoad).not.toHaveBeenCalled();
      expect(fs.readFileSync(promptFile, 'utf8')).toBe(promptBytes);
      expect(fs.readFileSync(defaultsFile, 'utf8')).toBe(defaultsBytes);
    } finally { writes.forEach(spy => spy.mockRestore()); }
  });

  it('owner 缺失时直接静态拒绝定位，不回退到全局或临时目录', () => {
    isolated.owner = '';
    expect(() => settingsOwnerFilePath('host-personalization.json')).toThrow();
    expect(inspectPersonalizationForSnapshot()).toEqual({ status: 'unavailable', revision: null });
    expect(inspectNewTaskDefaultsForSnapshot()).toEqual({ status: 'unavailable', revision: null });
    expect(fs.readdirSync(isolated.root)).toEqual([]);
  });

  it('v2区别待迁移与已初始化默认，读取不写盘且不交出正文', async () => {
    const before = inspectPreferenceSettingsForSnapshot('darwin');
    expect(before.fields['newTaskDefaults.modelId']).toEqual({ status: 'migrationPending' });
    expect(before.fields['personalization.customized']).toEqual({ status: 'migrationPending' });
    expect(before.fields['desktop.theme']).toEqual({ status: 'migrationPending' });
    expect(before.fields['databaseWarning.thresholdGiB']).toEqual({ status: 'value', value: 10, source: 'default' });
    expect(fs.readdirSync(isolated.root)).toEqual([]);
    await updateHostSettings(caller, await change('personalization', { set: { userPrompt: 'PRIVATE-TEST-PROMPT' } }));
    await updateHostSettings(caller, await change('newTaskDefaults', { set: { planMode: false } }));
    const after = inspectPreferenceSettingsForSnapshot('darwin');
    expect(after.fields['personalization.customized']).toEqual({ status: 'value', value: true, source: 'override' });
    expect(after.fields['newTaskDefaults.plan']).toEqual({ status: 'value', value: false, source: 'override' });
    expect(JSON.stringify(after)).not.toContain('PRIVATE-TEST-PROMPT');
    await updateHostSettings(caller, await change('personalization', { clear: ['userPrompt'] }));
    await updateHostSettings(caller, await change('newTaskDefaults', { clear: ['planMode'] }));
    const cleared = inspectPreferenceSettingsForSnapshot('darwin');
    expect(cleared.fields['personalization.customized']).toEqual({ status: 'value', value: false, source: 'default' });
    expect(cleared.fields['newTaskDefaults.plan']).toEqual({ status: 'value', value: false, source: 'default' });
    expect(inspectPreferenceSettingsForSnapshot('linux').fields['desktop.agentIslandEnabled']).toEqual({ status: 'unsupported' });
  });

  it('第一次查询和投影不创建任何 profile 或 owner 文件', () => {
    const result = projectSettingsSnapshot(readHostSettings());
    expect(result.databaseWarning).toMatchObject({ status: 'supported', fields: { thresholdGiB: { value: 10, source: 'default' } } });
    expect(result.personalization).toMatchObject({ fields: { customized: { value: false, source: 'default' } } });
    expect(fs.readdirSync(isolated.root)).toEqual([]);
  });

  it('确认后写真实文件，变化通知驱动投影；显式默认值与 clear 不混同', async () => {
    const changed = vi.fn(); disposers.push(onHostSettingsChanged(changed));
    const request = await change('databaseWarning', { set: { thresholdGiB: 10, disabled: false } });
    const receipt = await updateHostSettings(caller, request);
    expect(receipt).toMatchObject({ status: 'saved', saved: true, application: 'applied' });
    expect(confirm).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(warning).toHaveBeenCalledOnce();
    const file = path.join(isolated.root, 'database-size-warning-settings.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ thresholdGiB: 10, disabled: false });
    expect(projectSettingsSnapshot(readHostSettings()).databaseWarning).toMatchObject({ fields: {
      thresholdGiB: { value: 10, source: 'override' }, disabled: { value: false, source: 'override' },
    } });
    const clear = await updateHostSettings(caller, await change('databaseWarning', { clear: ['thresholdGiB', 'disabled'] }));
    expect(clear.saved).toBe(true);
    expect(projectSettingsSnapshot(readHostSettings()).databaseWarning).toMatchObject({ fields: {
      thresholdGiB: { value: 10, source: 'default' }, disabled: { value: false, source: 'default' },
    } });
  });

  it('保存个性化正文但查询/投影不含正文，clear 后不能重新导入旧值', async () => {
    const body = '仅用于隔离测试的个性化说明';
    const receipt = await updateHostSettings(caller, await change('personalization', { set: { userPrompt: body } }));
    expect(receipt).toMatchObject({ saved: true, application: 'next_agent_start' });
    const file = path.join(isolated.root, 'owners', `test-${isolated.owner}`, 'host-personalization.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).userPrompt).toBe(body);
    expect(JSON.stringify(readHostSettings())).not.toContain(body);
    const snapshot = projectSettingsSnapshot(readHostSettings());
    expect(snapshot.personalization).toMatchObject({ fields: { customized: { value: true, source: 'override' } } });
    expect(JSON.stringify(snapshot)).not.toMatch(/userPrompt|revision|hash|仅用于/);
    await updateHostSettings(caller, await change('personalization', { clear: ['userPrompt'] }));
    const state = readHostSettings().personalization;
    if (state.status !== 'ready') throw new Error('fixture');
    const unchanged = fs.readFileSync(file, 'utf8');
    const changed = vi.fn(); disposers.push(onHostSettingsChanged(changed));
    const rename = vi.spyOn(fs, 'renameSync');
    try {
      expect(await importLegacyPersonalization(body, { dataOwnerId: isolated.owner, ownerGeneration: isolated.generation }, state.revision)).toBe('already_initialized');
      expect(rename).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(fs.readFileSync(file, 'utf8')).toBe(unchanged);
    } finally { rename.mockRestore(); }
    expect(projectSettingsSnapshot(readHostSettings()).personalization).toMatchObject({ fields: { customized: { value: false } } });
  });

  it('启动从 Host 读正文，拒绝控制端副本；生成上下文保持尾部拼接，旧任务不热改', async () => {
    await updateHostSettings(caller, await change('personalization', { set: { userPrompt: 'Host 第一版' } }));
    const first: Parameters<typeof captureHostPersonalization>[0] = {
      userPrompt: '控制端副本', makerMemoryEnabled: true, displayReasoning: 'summarized',
      hostStartupPreferences: { userPrompt: '控制端伪造快照' },
    };
    captureHostPersonalization(first);
    first.userPrompt += '\n\n项目生成上下文';
    expect(first.hostStartupPreferences).toEqual({ userPrompt: 'Host 第一版', makerMemoryEnabled: true, displayReasoning: 'summarized' });
    expect(first.userPrompt).toBe('Host 第一版\n\n项目生成上下文');
    await updateHostSettings(caller, await change('personalization', { set: { userPrompt: 'Host 第二版' } }));
    expect(first.hostStartupPreferences?.userPrompt).toBe('Host 第一版');
    const next: Parameters<typeof captureHostPersonalization>[0] = {};
    captureHostPersonalization(next);
    expect(next.userPrompt).toBe('Host 第二版');
  });

  it('损坏的个性化文件阻止启动，不偷偷使用默认值或控制端副本', () => {
    const dir = path.join(isolated.root, 'owners', `test-${isolated.owner}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'host-personalization.json');
    fs.writeFileSync(file, '{broken-fixture');
    expect(() => captureHostPersonalization({ userPrompt: '不应启用' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken-fixture');
  });

  it('新任务默认值持久化后只报告 next_task，并保留显式选择的来源', async () => {
    setNewTaskDefaultRecommendation({ dataOwnerId: isolated.owner, ownerGeneration: isolated.generation }, {
      harness: 'codex', providerId: 'provider-example', modelId: 'recommended-model', effort: 'high',
      fast: false, thinking: true, worktree: false, planMode: false,
    });
    const receipt = await updateHostSettings(caller, await change('newTaskDefaults', { set: { modelId: 'selected-model', planMode: true } }));
    expect(receipt).toMatchObject({ saved: true, application: 'next_task' });
    expect(validate).toHaveBeenCalledOnce();
    expect(projectSettingsSnapshot(readHostSettings(), { models: new Set(['selected-model']), providers: new Set(['provider-example']) }).newTaskDefaults).toMatchObject({ boundary: 'nextTask', fields: {
      modelId: { value: 'selected-model', source: 'override' }, providerId: { value: 'provider-example', source: 'default' },
      plan: { value: true, source: 'override' },
    } });
    expect(JSON.parse(fs.readFileSync(path.join(isolated.root, 'owners', `test-${isolated.owner}`, 'host-new-task-defaults.json'), 'utf8')).modelId).toBe('selected-model');
  });

  it('字体正文只留 Host，快照只带自定义标志和数值', async () => {
    await updateHostSettings(caller, await change('appearance', { set: { uiFamily: '仅本地测试字体', uiSize: 16, windowZoom: 1.2 } }));
    expect(appearance).toHaveBeenCalledOnce();
    const snapshot = projectSettingsSnapshot(readHostSettings());
    expect(snapshot.appearance).toMatchObject({ fields: { uiFontCustomized: { value: true, source: 'override' }, uiFontSize: { value: 16 }, zoomFactor: { value: 1.2 } } });
    expect(JSON.stringify(snapshot)).not.toContain('仅本地测试字体');
  });

  it('应用失败仍报告已保存，同 ID 重试不再次确认/写入/应用', async () => {
    warning.mockImplementation(() => { throw new Error('模拟应用失败，不应进入回执'); });
    const changed = vi.fn(); disposers.push(onHostSettingsChanged(changed));
    const request = await change('databaseWarning', { set: { thresholdGiB: 20 } });
    const first = await updateHostSettings(caller, request);
    const second = await updateHostSettings(caller, request);
    expect(first).toMatchObject({ status: 'saved', saved: true, application: 'failed' }); expect(second).toEqual(first);
    expect(getHostSettingsOperation(caller, request.operationId)).toMatchObject(first);
    expect(confirm).toHaveBeenCalledOnce(); expect(warning).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce();
    expect(projectSettingsSnapshot(readHostSettings()).databaseWarning).toMatchObject({ fields: { thresholdGiB: { value: 20, source: 'override' } } });
  });

  it('原子发布成功后回读故障，不把已经写入的更改报告成未保存', async () => {
    const file = path.join(isolated.root, 'database-size-warning-settings.json');
    const request = await change('databaseWarning', { set: { thresholdGiB: 25 } });
    const originalRename = fs.renameSync;
    const originalRead = fs.readFileSync;
    let published = false;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      originalRename(from, to);
      if (String(to) === file) published = true;
    });
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (published && String(args[0]) === file) throw Object.assign(new Error('模拟回读故障'), { code: 'EACCES' });
      return originalRead(...args);
    }) as typeof fs.readFileSync);
    try {
      const receipt = await updateHostSettings(caller, request);
      expect(published).toBe(true);
      expect(receipt).toMatchObject({ status: 'saved', saved: true });
      expect(receipt.revision).toEqual(expect.any(String));
    } finally { read.mockRestore(); rename.mockRestore(); }
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).thresholdGiB).toBe(25);
  });

  it('拒绝确认后不保存，投影保持原默认值', async () => {
    confirm.mockResolvedValue(false);
    const receipt = await updateHostSettings(caller, await change('databaseWarning', { set: { disabled: true } }));
    expect(receipt).toMatchObject({ saved: false, status: 'rejected', code: 'CONFIRMATION_REQUIRED' });
    expect(fs.readdirSync(isolated.root)).toEqual([]);
    expect(projectSettingsSnapshot(readHostSettings()).databaseWarning).toMatchObject({ fields: { disabled: { value: false, source: 'default' } } });
  });

  it('确认期间 owner generation 变化即拒绝保存，不污染新 owner', async () => {
    const request = await change('personalization', { set: { userPrompt: '上一身份的测试说明' } });
    confirm.mockImplementationOnce(async () => { isolated.generation += 1; return true; });
    expect(await updateHostSettings(caller, request)).toMatchObject({ saved: false, code: 'OWNER_CHANGED' });
    expect(fs.readdirSync(isolated.root)).toEqual([]);
    expect(projectSettingsSnapshot(readHostSettings()).personalization).toMatchObject({ fields: { customized: { value: false } } });
  });

  it('个性化普通查询不询问正文，只有单独批准读取才返回正文', async () => {
    const body = '仅本地保存的测试说明';
    await updateHostSettings(caller, await change('personalization', { set: { userPrompt: body } }));
    confirm.mockClear();
    expect(JSON.stringify(await getHostSettings(caller, 'personalization'))).not.toContain(body);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(false);
    await expect(getHostSettings(caller, 'personalization', true)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const approved = await getHostSettings(caller, 'personalization', true);
    expect(approved).toMatchObject({ value: { userPrompt: body } });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(projectSettingsSnapshot(readHostSettings()))).not.toContain(body);
  });

  it('旧 UI writer 写入也通知，过期 CAS 拒绝覆盖，投影反映磁盘新值', async () => {
    const request = await change('databaseWarning', { set: { thresholdGiB: 30 } });
    const changed = vi.fn(); disposers.push(onHostSettingsChanged(changed));
    await writeDatabaseSizeWarningSettings({ thresholdGiB: 40 });
    expect(changed).toHaveBeenCalledOnce();
    expect(await updateHostSettings(caller, request)).toMatchObject({ saved: false, code: 'CONFLICT' });
    expect(projectSettingsSnapshot(readHostSettings()).databaseWarning).toMatchObject({ fields: { thresholdGiB: { value: 40 } } });
  });

  it('坏文件读为 unavailable，不删除、不修复、不把默认值报成真实设置', () => {
    const file = path.join(isolated.root, 'database-size-warning-settings.json');
    fs.writeFileSync(file, '{broken-fixture');
    expect(projectSettingsSnapshot(readHostSettings()).databaseWarning).toEqual({ status: 'unavailable', scope: 'profile', boundary: 'immediate' });
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken-fixture');
  });
});
