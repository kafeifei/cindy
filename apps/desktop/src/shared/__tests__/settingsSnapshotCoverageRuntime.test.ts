import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  root: '', platform: 'darwin' as NodeJS.Platform,
  forbidden: vi.fn(() => { throw new Error('禁止启动、凭据、迁移、网络或写入'); }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// 只替换运行时边界，不替换 core/interaction/collections 的真实 inspection。
vi.mock('electron', () => ({
  app: { getPath: (name: string) => name === 'userData' ? state.root : state.forbidden() },
  ipcMain: { on: state.forbidden, handle: state.forbidden }, BrowserWindow: { getAllWindows: state.forbidden },
  safeStorage: { isEncryptionAvailable: state.forbidden, decryptString: state.forbidden },
  systemPreferences: { getMediaAccessStatus: state.forbidden },
}));
vi.mock('electron-store', () => ({ default: state.forbidden }));
vi.mock('../../main/logger.js', () => ({ createLogger: () => state.log }));
vi.mock('../../main/maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => state.log } }));
vi.mock('../../main/appSessionState.js', () => ({
  getActiveAppSession: state.forbidden, ownerScopedUserDataPath: state.forbidden, activeOwnerScopeKey: state.forbidden,
  getActiveDataOwnerPushStamp: state.forbidden, isAppSessionBoundaryPending: state.forbidden, dataOwnerStorageKey: (v: string) => `test-${v}`,
}));
vi.mock('../../main/authManager.js', () => ({ getAuthState: state.forbidden, getAccessToken: state.forbidden }));
vi.mock('../../main/ownerNamespaceMigration.js', () => ({
  hasExclusiveSharedLegacyUserDataAccess: state.forbidden, hasLegacyOwnerNamespaceClaim: state.forbidden,
  // 只读现有归属证据，与可能迁移/claim 的 getter 不同；空临时 profile 没有旧 claim。
  isLegacyOwnerNamespaceClaimOwnedBy: state.forbidden, isLegacyOwnerNamespaceClaimedByOtherOwner: () => false,
}));
vi.mock('../../main/im/ownerScopedStorage.js', () => ({ claimLegacyImPath: state.forbidden,
  ownerScopedImUserDataPath: state.forbidden, ownerScopedImSecrets: { read: state.forbidden, write: state.forbidden } }));
vi.mock('../../main/voice-input/VoiceDictionarySyncStore.js', () => ({ voiceDictionarySyncStore: new Proxy({}, { get: () => state.forbidden }) }));
vi.mock('../../main/utility-model/resolveAuxiliaryModelChain.js', () => ({ getEffectiveAuxiliaryModelChain: state.forbidden }));
vi.mock('../../main/input-devices/registry.js', () => ({ resumeInputDeviceTaskSlots: state.forbidden }));
vi.mock('../../main/security/trustedAppRenderer.js', () => ({ assertTrustedAppRendererEvent: state.forbidden }));
vi.mock('../../main/windowFocusClassifier.js', () => ({ isAppContentWindow: state.forbidden }));
vi.mock('../../main/cloudPilotDistribution.js', () => ({ isCloudPilotDistribution: () => false }));
vi.mock('../../main/usage/accountReferencePrice.js', () => ({ accountReferencePriceQuote: state.forbidden }));
vi.mock('../../main/maker-host/model-visibility-owner-claim.js', () => ({ claimLegacyModelVisibilityOwner: state.forbidden }));
vi.mock('../../main/maker-host/index.js', () => ({ getMakerIfReady: state.forbidden }));
vi.mock('../../main/maker-host/createDesktopProviderService.js', () => ({ getDesktopProviderService: state.forbidden }));
vi.mock('../../main/maker-host/model-visibility-mirror.js', () => ({ getModelVisibilityOverride: state.forbidden, waitForModelVisibilityMirror: state.forbidden }));
vi.mock('../../main/maker-host/newMakerDefaultsCache.js', () => ({ getSelectedNewMakerRoute: state.forbidden }));
// 四域及桌面 profile 使用显式 DI；默认入口若被误用立即失败。
vi.mock('../../main/host-settings/personalization.js', () => ({ currentSettingsOwner: state.forbidden, inspectPersonalizationForSnapshot: state.forbidden }));
vi.mock('../../main/host-settings/new-task-defaults.js', () => ({ inspectNewTaskDefaultsForSnapshot: state.forbidden }));
vi.mock('../../main/host-settings/desktop-preferences.js', () => ({ inspectDesktopPreferences: state.forbidden }));
vi.mock('../../main/appearance-settings-store.js', () => ({ inspectAppearanceSettings: state.forbidden }));
vi.mock('../../main/database-size-warning-settings.js', () => ({ inspectDatabaseSizeWarningSettings: state.forbidden }));
vi.mock('../../main/host-settings/readContext.js', () => ({
  getSettingsReadContext: () => ({ mode: 'cloud', dataOwnerId: 'owner-a', generation: 7,
    ownerRoot: path.join(state.root, 'owners', 'owner-a'), userDataPath: state.root,
    isAuthenticated: true, membershipKind: 'org', platform: state.platform, arch: 'x64' }),
  assertSettingsReadContext: state.forbidden,
}));
vi.mock('../../main/host-settings/publicIdentifiers.js', () => ({ getSettingsPublicIdentifiers: state.forbidden }));

import { CORE_SETTINGS_FIELD_IDS } from '../../main/host-settings/readers/core.js';
import { inspectCoreSettingsForSnapshot } from '../../main/host-settings/readers/coreRuntime.js';
import { PREFERENCE_SETTINGS_FIELD_IDS, inspectPreferenceSettingsForSnapshot, type PreferenceSettingsReaders } from '../../main/host-settings/readers/preferences.js';
import { INTERACTION_SETTINGS_FIELD_IDS, inspectInteractionSettings } from '../../main/host-settings/readers/interaction.js';
import { inspectDynamicSettingsCollections } from '../../main/host-settings/readers/collections.js';
import { collectSettingsInspection } from '../../main/host-settings/readSnapshot.js';
import { projectSettingsSnapshotV2 } from '../../main/host-settings/snapshotProjectionV2.js';
import type { ReadonlySettingsInspection } from '../../main/host-settings/readTypes.js';
import { SETTINGS_READ_FIELD_IDS, SETTINGS_READ_COLLECTION_IDS } from '../settingsReadCatalog.js';
import { settingsSnapshotReportV2Schema, SETTINGS_SNAPSHOT_V2_COMPATIBILITY_FIXTURE, SETTINGS_SNAPSHOT_V2_FIELD_IDS } from '../settingsSnapshot.js';
import { desktopPreferenceDefaults } from '../desktopPreferences.js';
import { DEFAULT_APPEARANCE_SETTINGS } from '../appearanceSettings.js';
import { emptyModelPresentationPreferences } from '../modelPresentationPreferences.js';
import { encodeCatalogModelPin } from '../catalogModelPin.js';
import type { HostSettingState, NewTaskDefaultSettings } from '../hostSettings.js';

const ownerRoot = () => path.join(state.root, 'owners', 'owner-a');
function ready<T>(value: T, customizedKeys: string[] = []): Extract<HostSettingState<T>, { status: 'ready' }> {
  return { status: 'ready', value, defaults: value, customizedKeys, revision: 'fixture-revision', isCustomized: customizedKeys.length > 0 };
}
function preferenceReaders(): PreferenceSettingsReaders {
  const defaults: NewTaskDefaultSettings = { harness: 'claude-code', providerId: null, modelId: null, effort: null,
    fast: false, thinking: false, worktree: false, planMode: false };
  return {
    newTaskDefaults: () => ready(defaults), personalization: () => ready({ isCustomized: false }),
    databaseWarning: () => ready({ thresholdGiB: 1, disabled: false }), appearance: () => ready(DEFAULT_APPEARANCE_SETTINGS),
    desktop: () => ({ status: 'ready', profileStamp: 'fixture-profile', revision: 'fixture-revision',
      value: desktopPreferenceDefaults(), defaults: desktopPreferenceDefaults(), customizedKeys: [], isCustomized: false }),
  };
}
function read(preferences = preferenceReaders()) {
  const options = { ownerRoot: ownerRoot(), userDataPath: state.root, ownerId: 'owner-a', ownerGeneration: 7,
    mode: 'cloud' as const, platform: state.platform, officialAccountFingerprint: 'account_a_123' };
  const parts = [
    inspectPreferenceSettingsForSnapshot(state.platform, preferences), inspectCoreSettingsForSnapshot(),
    inspectInteractionSettings(options), inspectDynamicSettingsCollections(options),
  ];
  const inspection = collectSettingsInspection(parts.map(part => () => part), () => {});
  const projection = projectSettingsSnapshotV2(inspection);
  const report = settingsSnapshotReportV2Schema.parse({ ...SETTINGS_SNAPSHOT_V2_COMPATIBILITY_FIXTURE, ...projection });
  return { parts, inspection, report };
}
function noWrites<T>(fn: () => T): T {
  const methods = ['writeFileSync', 'mkdirSync', 'unlinkSync', 'rmSync', 'renameSync', 'copyFileSync', 'readdirSync'] as const;
  const spies = methods.map(name => vi.spyOn(fs, name).mockImplementation(state.forbidden as never));
  try { return fn(); } finally { for (const spy of spies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); } }
}
function write(name: string, value: unknown, owner = true) {
  const file = path.join(owner ? ownerRoot() : state.root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function assertCoverage(parts: ReadonlySettingsInspection[]) {
  const owned = [...PREFERENCE_SETTINGS_FIELD_IDS, ...CORE_SETTINGS_FIELD_IDS, ...INTERACTION_SETTINGS_FIELD_IDS];
  expect(new Set(owned).size).toBe(owned.length);
  expect([...owned].sort()).toEqual([...SETTINGS_READ_FIELD_IDS].sort());
  // 真正执行结果独立于目录：删除实际 put/publish 或遗漏循环项必须使本断言失败。
  const produced = parts.flatMap(part => Object.keys(part.fields));
  expect(produced.length).toBe(456);
  expect(new Set(produced).size).toBe(456);
  expect(produced.sort()).toEqual([...SETTINGS_READ_FIELD_IDS].sort());
  for (const [index, expected] of [PREFERENCE_SETTINGS_FIELD_IDS, CORE_SETTINGS_FIELD_IDS, INTERACTION_SETTINGS_FIELD_IDS].entries()) {
    expect(Object.keys(parts[index]!.fields).sort()).toEqual([...expected].sort());
  }
  const collections = parts.flatMap(part => Object.keys(part.collections ?? {}));
  expect(collections.sort()).toEqual([...SETTINGS_READ_COLLECTION_IDS].sort());
}
beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-coverage-'));
  state.platform = 'darwin';
  vi.clearAllMocks();
  vi.stubGlobal('fetch', state.forbidden);
});
afterEach(() => {
  expect(state.forbidden).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  fs.rmSync(state.root, { recursive: true, force: true });
});

describe('production reader to v2 coverage seam', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('reads all 456 native leaves and projects the 453 v2 leaves on %s without placeholder fill', platform => {
    state.platform = platform;
    const { parts, inspection, report } = noWrites(() => read());
    assertCoverage(parts);
    for (const [id, field] of Object.entries(inspection.fields)) {
      expect(['value', 'unsupported', 'private'], id).toContain(field.status);
    }
    expect(Object.keys(report.fields)).toEqual([...SETTINGS_SNAPSHOT_V2_FIELD_IDS]);
    expect(Object.keys(inspection.fields).filter(id => !Object.hasOwn(report.fields, id)).sort())
      .toEqual(['gitSafety.autoInitProjectGit', 'gitSafety.mode', 'voice.composerLongPressEnabled']);
    // 所有旧版 wire 字段保留真实读取状态，新版字段仍必须有本地读取接线。
    for (const id of SETTINGS_SNAPSHOT_V2_FIELD_IDS) expect(report.fields[id].status, id).toBe(inspection.fields[id]!.status);
    expect(report.fields['im.wecom.notificationsEnabled']).toEqual({ status: 'private' });
    expect(report.collections.modelVisibility.status).toBe('migrationPending');
    expect(report.collections.modelParameterHistory.status).toBe('migrationPending');
    expect(report.collections.builtinToolOverrides).toMatchObject({ status: 'partial', total: null, omitted: null });
    expect(fs.readdirSync(state.root)).toEqual([]);
  });

  it('uses valid saved facts for all collection classes and preserves provenance through the real projection', () => {
    write('collaboration-settings.json', { workerSoftLimit: 6 }, false);
    write('memory-settings.json', { maker: false });
    write('auxiliary-model-settings.json', { models: [encodeCatalogModelPin({ agentKind: 'codex', providerId: 'private-provider', model: 'private-model' })] });
    write('bot-model-chain-settings.json', { modelChain: [{ harness: 'claude', providerId: 'private-provider', model: 'private-model', effort: 'high', fastMode: true }] });
    write('vision-bridge-settings.json', { enabled: true, primary: { providerId: 'private-provider', modelId: 'private-model' }, targetModels: ['private-model'] }, false);
    write('voice-input-data.v1.json', { settings: { language: 'ja', microphoneDeviceId: 'private-microphone', dictionarySyncEnabledOverride: false } });
    write('worklouder-codex-settings.json', { customAgentKeys: [{ type: 'task', sessionId: 'private-session' }], deviceEnabled: true });
    write('im-default-settings.json', { schemaVersion: 3, channels: { telegram: { agents: { codex: { model: 'private-model', effort: 'high' } } } } });
    write('slack-hook.json', { version: 2, accounts: { account_a_123: { slack: { enabled: true } } }, workspaces: {} });
    const presentation = emptyModelPresentationPreferences();
    presentation.visibility.overrides['pi:private-provider:private-model'] = false;
    presentation.engines['private-provider:private-model'] = { agent: 'cc' };
    presentation.favorites.items = [{ uid: 'fixture-favorite', providerId: 'private-provider', modelId: 'private-model', agent: 'pi' }];
    presentation.favorites.uidSeq = 2;
    write('host-model-presentation-preferences.json', { _initialized: true, preferences: presentation });
    write('model-disable-prefs.json', { disabledModels: { 'private-provider:private-model': true } });
    write('local-codex-provider-prefs.json', { providers: { private: { name: 'private-provider-name', removed: false } } });
    write('model-context-limit-prefs.json', { limits: { 'pi:private:private-model': 99999 } });
    write('model-price-overrides.json', { version: 1, entries: { fixture: { providerId: 'private-provider', agent: 'pi', modelId: 'private-model', values: { currency: 'CNY', cacheReadPerMtok: null, inputPerMtok: 0 }, baseReference: null, updatedAt: 'fixture-time' } } });
    write('host-new-task-defaults.json', { _initialized: true, _history: {
      vendor: 'cc', lastByVendor: {}, modelChosenByVendor: {}, defaultTupleCustomized: false, defaultTupleSelectionCustomized: false,
      effortByModel: { 'private-model': 'high' }, fastModeByModel: { 'private-model': false }, worktreeEnabled: false,
      worktreePreferenceCustomized: false, providerModelMemory: {},
    } });
    write('hook-workspace-prefs.json', { version: 1, entries: [{ channel: 'telegram', teamId: null, workspace: 'private-workspace', model: null, effort: null, agentKind: null, permissionMode: null, dirty: true }] });
    write('telegram-bot-behavior.json', { groupActivation: { '-12345': 'always' } });
    write('builtin-tools-settings.json', { builtinTools: { browser: { enabled: false } } });
    write('sidebar-settings.json', { hiddenMainViewGhostIds: ['private-plugin'] });
    write('ghost-cindy-prefs.json', { overrides: { 'private-plugin': { 'image.generate': 'private-model' } }, inflightLimits: { 'private-plugin': 2 } });
    write('ghost-errand-prefs.json', { errand: { 'private-plugin': { agentKind: 'cc', model: 'private-model', workingDir: '/private-fixture/workspace', fastMode: false } } });
    const { parts, inspection, report } = noWrites(() => read());
    assertCoverage(parts);
    for (const id of SETTINGS_SNAPSHOT_V2_FIELD_IDS) expect(report.fields[id].status, id).toBe(inspection.fields[id]!.status);
    for (const [id, collection] of Object.entries(report.collections)) {
      expect(collection.status, id).toBe(id === 'builtinToolOverrides' ? 'partial' : 'complete');
      expect(collection.entries.length, id).toBeGreaterThan(0);
    }
    expect(report.fields['collaboration.workerSoftLimit']).toMatchObject({ value: 6, source: 'override' });
    expect(report.fields['memory.maker']).toMatchObject({ value: false, source: 'override' });
    expect(report.fields['voice.language']).toMatchObject({ value: 'ja', source: 'unknown' });
    expect(report.fields['voice.refinerChain']).toEqual(report.fields['auxiliaryModel.models']);
    expect(report.fields['im.telegram.agents.codex.model']).toMatchObject({ value: { configured: true }, source: 'override' });
    const serialized = JSON.stringify(report);
    for (const secret of ['private-provider', 'private-model', 'private-microphone', 'private-session', 'private-workspace', 'private-plugin', '/private-fixture', '-12345']) expect(serialized).not.toContain(secret);
  });

  it('propagates preference migration and read failures instead of turning them into default values', () => {
    const readers = preferenceReaders();
    readers.newTaskDefaults = () => ({ status: 'migrationPending', revision: null });
    readers.desktop = () => ({ status: 'migrationPending', profileStamp: 'fixture-profile', revision: 'pending' });
    readers.personalization = () => ({ status: 'unreadable', revision: null });
    const { parts, report } = noWrites(() => read(readers));
    assertCoverage(parts);
    expect(report.fields['newTaskDefaults.harness']).toEqual({ status: 'migrationPending' });
    expect(report.fields['desktop.theme']).toEqual({ status: 'migrationPending' });
    expect(report.fields['personalization.customized']).toEqual({ status: 'unreadable' });
    expect(report.fields['appearance.uiFontSize'].status).toBe('value');
  });
});
