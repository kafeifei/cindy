import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSettingsSnapshot, NativeHostSettingsSnapshot } from '../../../shared/hostSettings.js';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  snapshot: null as HostSettingsSnapshot | null,
  history: vi.fn(),
  catalog: vi.fn(),
  trusted: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => fixture.handlers.set(name, handler) },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../../security/trustedAppRenderer.js', () => ({ assertTrustedAppRendererEvent: fixture.trusted }));
vi.mock('../../windowFocusClassifier.js', () => ({ isAppContentWindow: () => true }));
vi.mock('../../utils/ipcValidate.js', () => ({ throwIpcError: (code: string) => { throw new Error(code); } }));
vi.mock('../../appearance-settings-ipc.js', () => ({ applySavedAppearance: vi.fn() }));
vi.mock('../catalog.js', () => ({ validateSettingsModelSelection: vi.fn(), refreshSettingsModelRecommendation: fixture.catalog }));
vi.mock('../new-task-defaults.js', () => ({ readNewTaskPreferenceHistory: fixture.history, saveNewTaskPreferenceHistory: vi.fn() }));
vi.mock('../personalization.js', () => ({
  currentSettingsOwner: () => fixture.snapshot?.ownerStamp,
  assertSettingsOwner: vi.fn(), importLegacyPersonalization: vi.fn(),
  inspectPersonalization: () => ({ status: 'ready', value: { userPrompt: 'fixture-body' }, defaults: { userPrompt: '' }, customizedKeys: ['userPrompt'], revision: 'prompt-revision', isCustomized: true }),
}));
vi.mock('../additionalModels.js', () => ({ readModelSettings: vi.fn(), validateModelSettingsChange: vi.fn(), commitModelSettings: vi.fn() }));
vi.mock('../additionalApplication.js', () => ({ applyAdditionalSettings: vi.fn() }));
vi.mock('../additionalNative.js', () => ({ nativeSettingsOperations: {} }));
vi.mock('../index.js', () => ({
  readHostSettings: () => fixture.snapshot,
  getHostSettings: async (_caller: unknown, domain: keyof Omit<HostSettingsSnapshot, 'ownerStamp'>) => {
    const state = fixture.snapshot![domain];
    return state.status === 'ready' ? { ...state, operationId: `operation-${domain}` } : state;
  },
  updateHostSettings: vi.fn(), onHostSettingsChanged: vi.fn(), configureHostSettingsApplication: vi.fn(),
}));
import { registerHostSettingsIpc } from '../ipc.js';

registerHostSettingsIpc(() => {});
beforeEach(() => {
  vi.clearAllMocks();
  fixture.catalog.mockResolvedValue(undefined);
  fixture.history.mockImplementation(() => { throw new Error('UNREADABLE'); });
  fixture.snapshot = {
    ownerStamp: { dataOwnerId: 'fixture-owner', ownerGeneration: 1 },
    newTaskDefaults: { status: 'unreadable', revision: null },
    personalization: { status: 'ready', value: { isCustomized: true }, defaults: { isCustomized: false }, customizedKeys: ['userPrompt'], revision: 'prompt-revision', isCustomized: true },
    databaseWarning: { status: 'unavailable', revision: null },
    appearance: { status: 'unavailable', revision: null },
  };
});

describe('原生 Host 设置快照的领域隔离', () => {
  it('默认值坏文件保留不可读状态，不让历史读取阻断个性化查询', async () => {
    const result = await fixture.handlers.get('host-settings:get')!({ sender: { id: 1 } }) as NativeHostSettingsSnapshot;
    expect(fixture.trusted).toHaveBeenCalled();
    expect(fixture.history).not.toHaveBeenCalled();
    expect(result.newTaskDefaults).toEqual({ status: 'unreadable', revision: null });
    expect(result.history).toBeNull();
    expect(result.userPrompt).toMatchObject({ status: 'ready', value: { userPrompt: 'fixture-body' } });
    expect(result.operationIds).toEqual({ personalization: 'operation-personalization' });
  });

  it('模型目录不可用仅封闭新任务领域，其它设置仍可读取', async () => {
    fixture.catalog.mockRejectedValue(new Error('fixture catalog unavailable'));
    const result = await fixture.handlers.get('host-settings:get')!({ sender: { id: 1 } }) as NativeHostSettingsSnapshot;
    expect(result.newTaskDefaults).toEqual({ status: 'unavailable', revision: null });
    expect(result.history).toBeNull();
    expect(fixture.history).not.toHaveBeenCalled();
    expect(result.userPrompt.status).toBe('ready');
    expect(result.operationIds.newTaskDefaults).toBeUndefined();
  });

  it('默认值可读时仍读取原生偏好历史', async () => {
    const value = { harness: 'codex' as const, providerId: null, modelId: null, effort: null, fast: false, thinking: true, worktree: false, planMode: false };
    fixture.snapshot!.newTaskDefaults = { status: 'ready', value, defaults: value, customizedKeys: [], revision: 'defaults-revision', isCustomized: false };
    fixture.history.mockReturnValue(null);
    const result = await fixture.handlers.get('host-settings:get')!({ sender: { id: 1 } }) as NativeHostSettingsSnapshot;
    expect(fixture.history).toHaveBeenCalledOnce();
    expect(result.operationIds.newTaskDefaults).toBe('operation-newTaskDefaults');
  });
});
