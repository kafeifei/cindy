import type { DesktopPreferencesSnapshot, DesktopPreferenceKey } from '../../../shared/desktopPreferences.js';
import type { HostSettingState } from '../../../shared/hostSettings.js';
import { AGENT_ISLAND_SOUND_EVENTS } from '../../../shared/agentIsland.js';
import type { SettingsSnapshotFieldId } from '../../../shared/settingsReadCatalog.js';
import { inspectAppearanceSettings } from '../../appearance-settings-store.js';
import { inspectDatabaseSizeWarningSettings } from '../../database-size-warning-settings.js';
import { inspectNewTaskDefaultsForSnapshot } from '../new-task-defaults.js';
import { inspectPersonalizationForSnapshot } from '../personalization.js';
import { inspectDesktopPreferences } from '../desktop-preferences.js';
import { inspectedValue, type ReadonlySettingsInspection, type ReadonlySettingInspection } from '../readTypes.js';

const firstDomains = {
  newTaskDefaults: { harness: 'harness', modelId: 'modelId', providerId: 'providerId', effort: 'effort', fast: 'fast', thinking: 'thinking', worktree: 'worktree', plan: 'planMode' },
  personalization: { customized: 'isCustomized' },
  databaseWarning: { thresholdGiB: 'thresholdGiB', disabled: 'disabled' },
  appearance: { uiFontSize: 'uiSize', codeFontSize: 'codeSize', zoomFactor: 'windowZoom', uiFontCustomized: 'uiFamily', codeFontCustomized: 'codeFamily' },
} as const;
const desktopKeys = [
  'theme', 'locale', 'sidebarPinnedMode', 'sidebarMainMode', 'ghostPanelRestoreMode', 'notificationsEnabled',
  'swallowActivationClick', 'composerSendShortcut', 'webLinkOpenPreference', 'localLinkOpenPreference',
  'streamFadePreference', 'promptRecommendationEnabled', 'messageNavRailEnabled', 'feishuNotificationsEnabled',
  'networkDebugEnabled', 'agentIslandEnabled', 'agentIslandMascotSkin',
] as const satisfies readonly DesktopPreferenceKey[];
export const PREFERENCE_SETTINGS_FIELD_IDS = [
  ...Object.entries(firstDomains).flatMap(([domain, mapping]) => Object.keys(mapping).map(key => `${domain}.${key}`)),
  ...desktopKeys.map(key => `desktop.${key}`), 'desktop.themeFamilyIdConfigured', 'desktop.agentIslandDisplayTargetConfigured',
  'desktop.agentIslandSoundSettings.enabled', ...AGENT_ISLAND_SOUND_EVENTS.map(event => `desktop.agentIslandSoundSettings.sounds.${event}`),
] as readonly SettingsSnapshotFieldId[];

type NativeState = HostSettingState<object> | { status: 'migrationPending'; revision: null };
export interface PreferenceSettingsReaders {
  newTaskDefaults: typeof inspectNewTaskDefaultsForSnapshot;
  personalization: typeof inspectPersonalizationForSnapshot;
  databaseWarning: typeof inspectDatabaseSizeWarningSettings;
  appearance: typeof inspectAppearanceSettings;
  desktop: () => DesktopPreferencesSnapshot;
}
const stores: PreferenceSettingsReaders = {
  newTaskDefaults: inspectNewTaskDefaultsForSnapshot, personalization: inspectPersonalizationForSnapshot,
  databaseWarning: inspectDatabaseSizeWarningSettings, appearance: inspectAppearanceSettings, desktop: inspectDesktopPreferences,
};

/** 固定字段映射只拿领域允许的值，不上传revision、profile身份、历史或正文。 */
export function inspectPreferenceSettingsForSnapshot(platform: NodeJS.Platform, readers: PreferenceSettingsReaders = stores): ReadonlySettingsInspection {
  const fields: Record<string, ReadonlySettingInspection> = {};
  for (const domain of Object.keys(firstDomains) as Array<keyof typeof firstDomains>) {
    let state: NativeState;
    try { state = readers[domain](); } catch { state = { status: 'unreadable', revision: null }; }
    for (const [leaf, key] of Object.entries(firstDomains[domain])) {
      const id = `${domain}.${leaf}`;
      if (state.status !== 'ready') { fields[id] = { status: state.status }; continue; }
      const customized = domain === 'personalization' ? state.isCustomized : state.customizedKeys.includes(key);
      const value = domain === 'appearance' && leaf.endsWith('Customized')
        ? customized : (state.value as Record<string, unknown>)[key];
      fields[id] = inspectedValue(value, customized ? 'override' : 'default');
    }
  }
  let desktop: DesktopPreferencesSnapshot;
  try { desktop = readers.desktop(); }
  catch { desktop = { status: 'unreadable', profileStamp: '', revision: null }; }
  const publish = (id: string, key: DesktopPreferenceKey, value: unknown) => {
    fields[id] = platform !== 'darwin' && id.startsWith('desktop.agentIsland')
      ? { status: 'unsupported' }
      : desktop.status === 'ready' ? inspectedValue(value, desktop.customizedKeys.includes(key) ? 'override' : 'default')
      : { status: desktop.status };
  };
  for (const key of desktopKeys) publish(`desktop.${key}`, key, desktop.status === 'ready' ? desktop.value[key] : undefined);
  publish('desktop.themeFamilyIdConfigured', 'themeFamilyId', desktop.status === 'ready' && desktop.customizedKeys.includes('themeFamilyId'));
  publish('desktop.agentIslandDisplayTargetConfigured', 'agentIslandDisplayTarget', desktop.status === 'ready' && desktop.value.agentIslandDisplayTarget.mode === 'display');
  publish('desktop.agentIslandSoundSettings.enabled', 'agentIslandSoundSettings', desktop.status === 'ready' && desktop.value.agentIslandSoundSettings.enabled);
  for (const event of AGENT_ISLAND_SOUND_EVENTS) {
    const sound = desktop.status === 'ready' ? desktop.value.agentIslandSoundSettings.sounds[event] : null;
    publish(`desktop.agentIslandSoundSettings.sounds.${event}`, 'agentIslandSoundSettings', sound?.type === 'custom'
      ? { type: 'custom', configured: true } : sound?.type === 'builtin' ? { type: 'builtin', id: sound.id } : null);
  }
  return { fields };
}
