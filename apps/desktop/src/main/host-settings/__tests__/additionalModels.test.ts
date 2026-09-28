import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const context = vi.hoisted(() => ({ root: '', owner: 'first', generation: 1, pending: false,
  connected: true, modelsPerAgent: 1, routeStamp: '1:0',
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('electron', () => ({ app: { getPath: () => context.root } }));
vi.mock('../../logger.js', () => ({ createLogger: () => context.log }));
vi.mock('../../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => context.log } }));
vi.mock('../../appSessionState.js', () => ({
  peekCommittedAppSession: () => ({ mode: 'cloud', dataOwnerId: context.owner, generation: context.generation }),
  getActiveAppSession: () => ({ mode: 'cloud', dataOwnerId: context.owner, generation: context.generation }),
  activeOwnerScopeKey: () => `${context.owner}:${context.generation}`,
  isAppSessionBoundaryPending: () => context.pending,
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  ownerScopedUserDataPath: (...segments: string[]) => path.join(context.root, 'owners', `test-${context.owner}`, ...segments),
}));
vi.mock('../../im/ownerScopedStorage.js', () => ({
  claimLegacyImPath: vi.fn(),
  ownerScopedImUserDataPath: (...segments: string[]) => path.join(context.root, 'owners', `test-${context.owner}`, ...segments),
}));

vi.mock('../catalog.js', () => ({ refreshSettingsModelRecommendation: async () => ({
  providers: [{ id: 'fixture-provider', name: 'Fixture Provider', source: 'user', connected: context.connected,
    agents: ['claude-code', 'codex', 'pi'], auth: { method: 'api-key' },
    models: Object.fromEntries(['claude-code', 'codex', 'pi'].map(agent => [agent, Array.from({ length: context.modelsPerAgent }, (_, index) => ({ id: index === 0 ? 'fixture-model' : `fixture-${index}`, name: 'Fixture Model', type: 'chat',
      efforts: ['low', 'high'], defaultEffort: 'high', supportsFastMode: true, defaultEnabled: true }))])),
  }], agents: ['claude-code', 'codex', 'pi'], assertCurrent() {},
}) }));
vi.mock('../../maker-host/model-visibility-mirror.js', () => ({ getModelVisibilityOverride: () => undefined, waitForModelVisibilityMirror: async () => {} }));
vi.mock('../../maker-host/index.js', () => ({ getMakerIfReady: () => ({ listAvailableAgents: () => ['claude-code', 'codex', 'pi'] }) }));
vi.mock('../../maker-host/createDesktopProviderService.js', () => ({ getDesktopProviderService: () => ({ listProviders: async () => [] }) }));
vi.mock('../../maker-host/active-catalog.js', () => ({ getActiveCatalog: () => ({}), getActiveCatalogRevision: () => 1 }));
vi.mock('../../maker-host/provider-route.js', () => ({ getProviderRouteMutationStamp: () => context.routeStamp }));
vi.mock('../../usage/ledgerCurrency.js', () => ({ currentLedgerCurrency: () => 'USD' }));
vi.mock('../../usage/accountReferencePrice.js', () => ({ accountReferencePriceQuote: () => ({ currency: 'USD', inputPerMtok: 2, outputPerMtok: 10, source: 'reference' }) }));
vi.mock('../../cindy-brain/index.js', () => ({ getHostPluginPreferenceContext: () => [{ id: 'fixture-plugin', name: 'Fixture Plugin', supported: { cindy: true, agent: true, mainView: true }, options: { 'image.generate': [{ id: 'fixture-image', label: 'Fixture Image' }] } }], notifyHostPluginPreferenceChanged: vi.fn() }));
vi.mock('../../maker-host/provider-order-store.js', () => ({ readProviderOrder: () => [] }));
vi.mock('../../utility-model/oneshotProviderUsability.js', () => ({ hasOneshotProviderCredential: () => true }));
vi.mock('../../utility-model/textOneshotPinOptions.js', () => ({ buildTextOneshotPinOptions: () => [{ id: 'fixture-pin', label: 'Fixture Auxiliary Model' }] }));
vi.mock('../../ownerNamespaceMigration.js', () => ({ isLegacyOwnerNamespaceClaimedByOtherOwner: () => true, hasExclusiveSharedLegacyUserDataAccess: () => false, hasLegacyOwnerNamespaceClaim: () => false }));

import { configureHostSettingsApplication, getHostSettings, updateHostSettings } from '../index.js';
import { normalizeHostSettingsChange, type HostSettingsDomain, type HostSettingsUpdate } from '../../../shared/hostSettings.js';
import { modelSettingsChoices, readModelSettings, validateModelSettingsChange, commitModelSettings } from '../additionalModels.js';
import { emptyModelPresentationPreferences } from '../../../shared/modelPresentationPreferences.js';
import { readModelContextLimit } from '../../maker-host/model-context-limit-store.js';
import { readModelDisableOverrides } from '../../maker-host/model-disable-store.js';
import { readSubagentModelSettings } from '../../maker-host/subagent-model-settings-store.js';
import { readImDefaultSettings } from '../../im/defaultSettingsStore.js';
import { readVisionBridgeSettings, isTargetModelsCustomized } from '../../vision-bridge/vision-bridge-settings-store.js';
import { nativePluginSettings } from '../additionalPlugins.js';
import { configureAdditionalNativeOperations } from '../additionalRuntime.js';
import { commitHostModelPrices, getHostModelPriceStore, readModelPriceOverrideView, inspectModelPriceOverrides } from '../../usage/modelPriceOverrideStore.js';
const confirm = vi.fn(async () => true);
const caller = { id: 'model-test', assertCurrent() {}, confirm };
const route = { providerId: 'fixture-provider', modelId: 'fixture-model' };
async function request(domain: HostSettingsDomain, values: Pick<HostSettingsUpdate, 'set' | 'clear'>) {
  const state = await getHostSettings(caller, domain);
  if (state.status !== 'ready' || !('operationId' in state)) throw new Error(`Not ready: ${domain}`);
  return { domain, expectedRevision: state.revision, operationId: state.operationId, ...values };
}
beforeEach(() => { configureHostSettingsApplication({ models: { read: readModelSettings, validate: validateModelSettingsChange, commit: commitModelSettings }, appearance() {}, databaseWarning() {}, async validateNewTaskDefaults() {} }); context.root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-models-')); context.owner = 'first'; context.generation++; context.pending = false; context.connected = true; context.modelsPerAgent = 1; vi.clearAllMocks(); confirm.mockResolvedValue(true); });
afterEach(() => fs.rmSync(context.root, { recursive: true, force: true }));
describe('model and IM settings native persistence', () => {
  it.each(['modelVisibility', 'modelEngines', 'modelFavorites', 'modelContext'] as const)(
    'keeps all 267 catalog routes in %s, including disconnected providers', async domain => {
      context.modelsPerAgent = 89;
      context.connected = false;
      const choices = await modelSettingsChoices(domain);
      expect(choices.entries).toHaveLength(267);
      expect(new Set(choices.entries.map(option => JSON.stringify(option.value))).size).toBe(267);
      expect(choices.entries.at(-1)?.value).toEqual({ providerId: 'fixture-provider', modelId: 'fixture-88', harness: 'pi' });
    });
  it('rejects an oversized catalog without silently truncating routes', async () => {
    context.modelsPerAgent = 171;
    await expect(modelSettingsChoices('modelVisibility')).rejects.toThrow('MODEL_CATALOG_TOO_LARGE');
  });
  it('retains untouched sparse price records, their original baseline and unknown metadata', async () => {
    const store = getHostModelPriceStore();
    const target = { providerId: 'fixture-provider', agent: 'pi' as const, modelId: 'fixture-model' };
    const key = JSON.stringify([target.providerId, target.agent, target.modelId]);
    const original = { ...target, values: { inputPerMtok: 3 }, baseReference: { currency: 'USD' as const, inputPerMtok: 1, outputPerMtok: 5, cacheReadPerMtok: null, cacheCreatePerMtok: null }, updatedAt: '2026-09-01T00:00:00.000Z', future: true };
    await store.commitAtomic({ set: { version: 1, entries: { [key]: original } } });
    const before = store.inspect(); if (before.status !== 'ready') throw new Error('fixture');
    const effective = readModelPriceOverrideView(target, undefined).effective!;
    await commitHostModelPrices([{ ...target, currency: effective.currency, inputPerMtok: effective.inputPerMtok, outputPerMtok: effective.outputPerMtok, cacheReadPerMtok: effective.cacheReadPerMtok ?? null, cacheCreatePerMtok: effective.cacheCreatePerMtok ?? null },
      { ...target, modelId: 'another-model', currency: 'USD', inputPerMtok: 4, outputPerMtok: 8, cacheReadPerMtok: null, cacheCreatePerMtok: null }], undefined, { expectedRevision: before.revision });
    const after = store.inspect(); if (after.status !== 'ready') throw new Error('fixture');
    const raw = inspectModelPriceOverrides(path.join(context.root, 'owners', 'test-first'));
    if (raw.status !== 'ready') throw new Error('fixture');
    expect((raw.raw.entries as Record<string, unknown>)[key]).toEqual(original);
    await expect(commitHostModelPrices([], undefined, { expectedRevision: before.revision })).rejects.toThrow();
  });
  it('saves Plugin pins through the owner store without changing other capabilities or unknown metadata', async () => {
    configureAdditionalNativeOperations({ plugins: nativePluginSettings } as never);
    const dir = path.join(context.root, 'owners', 'test-first'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'ghost-cindy-prefs.json');
    fs.writeFileSync(file, JSON.stringify({ future: true, overrides: { 'fixture-plugin': { 'video.generate': 'saved-video', future: 'keep' } }, inflightLimits: { 'fixture-plugin': 2 } }));
    expect(await updateHostSettings(caller, await request('pluginCindy', { set: { imageGenerate: [{ ghostId: 'fixture-plugin', model: 'fixture-image' }] } }))).toMatchObject({ saved: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ future: true, overrides: { 'fixture-plugin': { 'image.generate': 'fixture-image', 'video.generate': 'saved-video', future: 'keep' } }, inflightLimits: { 'fixture-plugin': 2 } });
    expect(await updateHostSettings(caller, await request('pluginCindy', { set: { imageGenerate: [{ ghostId: 'fixture-plugin', model: 'unavailable-image' }] } }))).toMatchObject({ saved: false, code: 'MODEL_UNAVAILABLE' });
    await updateHostSettings(caller, await request('pluginCindy', { clear: ['imageGenerate'] }));
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).overrides['fixture-plugin']).toEqual({ 'video.generate': 'saved-video', future: 'keep' });
  });
  it('passive reads do not claim legacy files or create defaults', async () => {
    for (const domain of ['subagentModel', 'auxiliaryModel', 'visionBridge', 'botModelChain', 'imGlobal', 'imFeishu', 'imWechat'] as const) {
      expect(await getHostSettings(caller, domain)).toMatchObject({ status: 'ready', customizedKeys: [] });
    }
    expect(fs.readdirSync(context.root)).toEqual([]);
  });
  it('updates and clears both halves of the native subagent route', async () => {
    expect(await updateHostSettings(caller, await request('subagentModel', { set: { claudeCode: route } }))).toMatchObject({ saved: true });
    expect(readSubagentModelSettings()).toMatchObject({ claudeCode: route.modelId, claudeCodeProviderId: route.providerId });
    await updateHostSettings(caller, await request('subagentModel', { clear: ['claudeCode'] }));
    expect(readSubagentModelSettings()).toMatchObject({ claudeCode: null, claudeCodeProviderId: null });
  });
  it('rejects a disconnected new route after the human confirmation wait', async () => {
    const input = await request('subagentModel', { set: { claudeCode: route } });
    confirm.mockImplementationOnce(async () => { context.connected = false; return true; });
    expect(await updateHostSettings(caller, input)).toMatchObject({ saved: false, code: 'MODEL_UNAVAILABLE' });
    expect(readSubagentModelSettings().claudeCode).toBeNull();
  });
  it('rejects unsupported effort and duplicate bot routes even if other parameters differ', async () => {
    const item = { harness: 'codex', providerId: route.providerId, model: route.modelId, effort: 'ultra', fastMode: false };
    expect(await updateHostSettings(caller, await request('botModelChain', { set: { modelChain: [item] } }))).toMatchObject({ saved: false, code: 'EFFORT_UNSUPPORTED' });
    expect(() => normalizeHostSettingsChange({ domain: 'botModelChain', set: { modelChain: [item, { ...item, effort: 'low' }] } })).toThrow();
  });
  it('preserves per-channel IM overrides and explicitly chosen defaults', async () => {
    await updateHostSettings(caller, await request('imFeishu', { set: { permissionMode: 'auto' } }));
    expect(await getHostSettings(caller, 'imFeishu')).toMatchObject({ customizedKeys: ['permissionMode'] });
    await updateHostSettings(caller, await request('imSlack', { set: { codex: { ...route, effort: 'low' } } }));
    expect(readImDefaultSettings('slack').agents.codex).toEqual({ providerId: route.providerId, model: route.modelId, effort: 'low' });
    await updateHostSettings(caller, await request('imFeishu', { clear: ['permissionMode'] }));
    expect((await getHostSettings(caller, 'imFeishu')).status).toBe('ready');
    expect(readImDefaultSettings('slack').agents.codex.model).toBe(route.modelId);
  });
  it('keeps the existing WeChat agent and permission boundaries', async () => {
    expect(await updateHostSettings(caller, await request('imWechat', { set: { agentKind: 'pi' } }))).toMatchObject({ saved: false });
    expect(await updateHostSettings(caller, await request('imWechat', { set: { permissionMode: 'bypassPermissions' } }))).toMatchObject({ saved: false });
    expect(readImDefaultSettings('wechat').agentKind).toBe('claude-code');
  });
  it('invalidates the native vision cache and preserves explicit empty target selection', async () => {
    expect(readVisionBridgeSettings().enabled).toBe(false);
    await updateHostSettings(caller, await request('visionBridge', { set: { enabled: true, primary: route, targetModels: [] } }));
    expect(readVisionBridgeSettings()).toMatchObject({ enabled: true, primary: route, targetModels: [] });
    expect(isTargetModelsCustomized()).toBe(true);
    await updateHostSettings(caller, await request('visionBridge', { clear: ['targetModels'] }));
    expect(isTargetModelsCustomized()).toBe(false);
  });
  it('edits model preference axes independently and keeps native favorite identities', async () => {
    const dir = path.join(context.root, 'owners', 'test-first'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'host-model-presentation-preferences.json');
    fs.writeFileSync(file, JSON.stringify({ _initialized: true, preferences: emptyModelPresentationPreferences() }));
    const target = { ...route, harness: 'codex' };
    expect(await updateHostSettings(caller, await request('modelVisibility', { set: { entries: [{ ...target, enabled: false }] } }))).toMatchObject({ saved: true });
    expect(await updateHostSettings(caller, await request('modelFavorites', { set: { entries: [{ ...target, effort: 'low', fast: true }] } }))).toMatchObject({ saved: true });
    const firstUid = JSON.parse(fs.readFileSync(file, 'utf8')).preferences.favorites.items[0].uid;
    await updateHostSettings(caller, await request('modelEngines', { set: { entries: [target] } }));
    await updateHostSettings(caller, await request('modelVisibility', { clear: ['entries'] }));
    const native = JSON.parse(fs.readFileSync(file, 'utf8')).preferences;
    expect(native.favorites.items[0].uid).toBe(firstUid);
    expect(native.engines).toEqual({ 'fixture-provider:fixture-model': { agent: 'codex' } });
    expect(native.visibility.overrides).toEqual({});
  });
  it('updates actual context limits and disabled model/provider maps', async () => {
    const target = { ...route, harness: 'codex' };
    expect(await updateHostSettings(caller, await request('modelContext', { set: { entries: [{ ...target, limit: 32000 }] } }))).toMatchObject({ saved: true });
    expect(readModelContextLimit('codex', route.providerId, route.modelId)).toBe(32000);
    expect(await updateHostSettings(caller, await request('modelAccess', { set: { models: [route], providers: [route.providerId] } }))).toMatchObject({ saved: true });
    expect(readModelDisableOverrides()).toEqual({ disabledModels: { 'fixture-provider:fixture-model': true }, disabledProviders: { 'fixture-provider': true } });
    await updateHostSettings(caller, await request('modelAccess', { clear: ['models'] }));
    expect(readModelDisableOverrides().disabledProviders).toEqual({ 'fixture-provider': true });
    await updateHostSettings(caller, await request('modelContext', { clear: ['entries'] }));
    expect(readModelContextLimit('codex', route.providerId, route.modelId)).toBeNull();
  });
  it('fails closed on corrupt native fields without normalizing away the bytes', async () => {
    const file = path.join(context.root, 'vision-bridge-settings.json');
    const raw = '{"enabled":"bad-value"}'; fs.writeFileSync(file, raw);
    expect(await getHostSettings(caller, 'visionBridge')).toMatchObject({ status: 'unreadable' });
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
  });
});
