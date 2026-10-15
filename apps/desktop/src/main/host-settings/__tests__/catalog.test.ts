import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderView } from '@cindy/model-providers';

const host = vi.hoisted(() => ({ owner: { dataOwnerId: 'owner-a', ownerGeneration: 1 }, list: vi.fn(), getter: vi.fn(), recommend: vi.fn(), enabled: true }));
vi.mock('../../maker-host/createDesktopProviderService.js', () => ({ getDesktopProviderService: host.getter }));
vi.mock('../../maker-host/index.js', () => ({ getMakerIfReady: () => ({ listAvailableAgents: () => ['pi', 'codex'] }) }));
vi.mock('../../maker-host/model-visibility-mirror.js', () => ({ waitForModelVisibilityMirror: async () => {}, getModelVisibilityOverride: () => host.enabled }));
vi.mock('../personalization.js', () => ({ currentSettingsOwner: () => ({ ...host.owner }), assertSettingsOwner: (owner: typeof host.owner) => { if (JSON.stringify(owner) !== JSON.stringify(host.owner)) throw new Error('OWNER_CHANGED'); } }));
vi.mock('../new-task-defaults.js', () => ({ setNewTaskDefaultRecommendation: host.recommend }));
import { recommendSettingsModel, refreshSettingsModelRecommendation, validateSettingsModelSelection } from '../catalog';

const model = { id: 'available-model', status: 'active', mode: 'chat', defaultEnabled: true, efforts: ['low', 'high'], defaultEffort: 'low', supportsFastMode: false };
function provider(overrides: Record<string, unknown> = {}): ProviderView {
  return { id: 'custom', source: 'user', auth: { type: 'api-key' }, connected: true, agents: ['pi'], routing: {}, models: { pi: [model] }, ...overrides } as unknown as ProviderView;
}
beforeEach(() => {
  vi.clearAllMocks(); host.owner = { dataOwnerId: 'owner-a', ownerGeneration: 1 }; host.enabled = true;
  host.list.mockResolvedValue([provider()]); host.getter.mockReturnValue({ listProviders: host.list });
});

describe('Host 新任务默认模型只读推荐', () => {
  it('产品推荐缺席时从执行端真实可用自定义目录推荐，不硬编码模型', () => {
    expect(recommendSettingsModel([provider()], ['pi'])).toEqual({ vendor: 'pi', providerId: 'custom', model: 'available-model', effort: 'low' });
  });
  it.each([{ connected: false }, { suspended: true }, { modelDiscoveryFailure: { kind: 'failed' } }, { models: { pi: [{ ...model, disabled: true }] } }])('不可执行目录项不推荐 %j', overrides => {
    expect(recommendSettingsModel([provider(overrides)], ['pi'])).toBeNull();
  });
  it('没有 Harness、模型隐藏或空目录时为空，不制造 Opus 占位', () => {
    expect(recommendSettingsModel([provider()], [])).toBeNull();
    host.enabled = false;
    expect(recommendSettingsModel([provider()], ['pi'])).toBeNull();
    expect(recommendSettingsModel([], ['pi'])).toBeNull();
  });
  it('尊重可用目录推荐位/排序，不支持的默认 effort 留空', () => {
    const candidates = provider({ models: { pi: [model, { ...model, id: 'marked', newSessionDefault: ['pi'], defaultEffort: 'unsupported' }] } });
    expect(recommendSettingsModel([candidates], ['pi'])).toMatchObject({ model: 'marked', effort: null });
  });
  it('getter 与列表均显式禁副作用，只有内存推荐被更新', async () => {
    await refreshSettingsModelRecommendation();
    expect(host.getter).toHaveBeenCalledWith({ allowSideEffects: false });
    expect(host.list).toHaveBeenCalledWith({ allowSideEffects: false, includeMediaReadiness: false });
    expect(host.recommend).toHaveBeenCalledWith(host.owner, expect.objectContaining({ modelId: 'available-model', harness: 'pi' }));
  });
  it('owner/generation 在异步目录读取时变化，不发布旧推荐', async () => {
    host.list.mockImplementation(async () => { host.owner.ownerGeneration++; return [provider()]; });
    await expect(refreshSettingsModelRecommendation()).rejects.toThrow('OWNER_CHANGED');
    expect(host.recommend).not.toHaveBeenCalled();
  });
  it('准入配置不可读时清掉内存推荐并报告失败，不冒充可用默认值', async () => {
    host.list.mockRejectedValue(new Error('MODEL_ACCESS_UNREADABLE'));
    await expect(refreshSettingsModelRecommendation()).rejects.toThrow('MODEL_ACCESS_UNREADABLE');
    expect(host.recommend).toHaveBeenCalledWith(host.owner, expect.objectContaining({ modelId: null, providerId: null }));
  });
  it('显式失效模型拒绝验证，而不是验证另一个回退型号', async () => {
    await expect(validateSettingsModelSelection({ harness: 'pi', providerId: 'custom', modelId: 'removed', effort: null, fast: false, thinking: true, worktree: false, planMode: false })).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });
});
