import {
  DEFAULT_AGENT_ISLAND_DISPLAY_TARGET, DEFAULT_AGENT_ISLAND_MASCOT_SKIN,
  DEFAULT_AGENT_ISLAND_SOUND_SETTINGS, isAgentIslandMascotSkin,
  normalizeAgentIslandDisplayTarget, normalizeAgentIslandSoundSettings,
  type AgentIslandDisplayTarget, type AgentIslandMascotSkin, type AgentIslandSoundSettings,
} from './agentIsland';
import { SUPPORTED_LOCALES, type LocalePreference } from './locale';

/** 仅属本地 profile 的偏好，不是 owner store，也不可直接作为公开或 wire 快照。 */
export interface DesktopPreferences {
  theme: 'system' | 'light' | 'dark';
  themeFamilyId: string;
  locale: LocalePreference;
  sidebarPinnedMode: 'text' | 'card' | 'list';
  sidebarMainMode: 'text' | 'list';
  ghostPanelRestoreMode: 'bubble' | 'sidebar';
  notificationsEnabled: boolean;
  swallowActivationClick: boolean;
  composerSendShortcut: 'enter' | 'modifier-enter';
  webLinkOpenPreference: 'external' | 'sidebar';
  localLinkOpenPreference: 'external' | 'sidebar';
  streamFadePreference: 'on' | 'off';
  promptRecommendationEnabled: boolean;
  messageNavRailEnabled: boolean;
  feishuNotificationsEnabled: boolean;
  agentIslandEnabled: boolean;
  agentIslandSoundSettings: AgentIslandSoundSettings;
  agentIslandMascotSkin: AgentIslandMascotSkin;
  agentIslandDisplayTarget: AgentIslandDisplayTarget;
  networkDebugEnabled: boolean;
}
export type DesktopPreferenceKey = keyof DesktopPreferences;

/** 默认值只参与解释，不复制到磁盘；音效组展开为六个叶子。 */
export function desktopPreferenceDefaults(): DesktopPreferences {
  return {
    theme: 'system', themeFamilyId: 'cindy', locale: 'system', sidebarPinnedMode: 'text', sidebarMainMode: 'list',
    ghostPanelRestoreMode: 'bubble', notificationsEnabled: true, swallowActivationClick: false,
    composerSendShortcut: 'enter', webLinkOpenPreference: 'external', localLinkOpenPreference: 'sidebar',
    streamFadePreference: 'on', promptRecommendationEnabled: true, messageNavRailEnabled: true,
    feishuNotificationsEnabled: false, agentIslandEnabled: false,
    agentIslandSoundSettings: normalizeAgentIslandSoundSettings(DEFAULT_AGENT_ISLAND_SOUND_SETTINGS),
    agentIslandMascotSkin: DEFAULT_AGENT_ISLAND_MASCOT_SKIN,
    agentIslandDisplayTarget: normalizeAgentIslandDisplayTarget(DEFAULT_AGENT_ISLAND_DISPLAY_TARGET),
    networkDebugEnabled: false,
  };
}
export const DESKTOP_PREFERENCE_KEYS = Object.keys(desktopPreferenceDefaults()) as DesktopPreferenceKey[];
export const DESKTOP_PREFERENCE_STORAGE_KEYS: Record<DesktopPreferenceKey, string> = {
  theme: 'theme', themeFamilyId: 'theme.familyId', locale: 'language', sidebarPinnedMode: 'sidebar.cardMode',
  sidebarMainMode: 'sidebar.mainListMode', ghostPanelRestoreMode: 'ghostPanel.restoreMode',
  notificationsEnabled: 'notifications.enabled', swallowActivationClick: 'input.swallowActivationClick',
  composerSendShortcut: 'chat.sendShortcutPreference', webLinkOpenPreference: 'chat.webLinkOpenPreference',
  localLinkOpenPreference: 'chat.localLinkOpenPreference', streamFadePreference: 'chat.streamFadePreference',
  promptRecommendationEnabled: 'prompt-recommendation-enabled', messageNavRailEnabled: 'chat.messageNavRail.enabled',
  feishuNotificationsEnabled: 'notifications.feishuEnabled', agentIslandEnabled: 'notifications.agentIslandEnabled',
  agentIslandSoundSettings: 'notifications.agentIslandSoundSettings', agentIslandMascotSkin: 'notifications.agentIslandMascotSkin',
  agentIslandDisplayTarget: 'notifications.agentIslandDisplayTarget', networkDebugEnabled: 'experimental.debug-network',
};
const enums: Partial<Record<DesktopPreferenceKey, readonly string[]>> = {
  theme: ['system', 'light', 'dark'], locale: ['system', ...SUPPORTED_LOCALES],
  sidebarPinnedMode: ['text', 'card', 'list'], sidebarMainMode: ['text', 'list'], ghostPanelRestoreMode: ['bubble', 'sidebar'],
  composerSendShortcut: ['enter', 'modifier-enter'], webLinkOpenPreference: ['external', 'sidebar'],
  localLinkOpenPreference: ['external', 'sidebar'], streamFadePreference: ['on', 'off'],
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 共用边界归一化；Island 兼容别名仍由 agentIsland.ts 统一解释。 */
export function normalizeDesktopPreference<K extends DesktopPreferenceKey>(key: K, value: unknown): DesktopPreferences[K] {
  let next: unknown = value;
  if (enums[key]) {
    if (typeof value !== 'string' || !enums[key]!.includes(value)) throw new Error('Invalid desktop preference');
  } else if (key === 'themeFamilyId') {
    if (typeof value !== 'string' || !value.length || value.length > 512) throw new Error('Invalid desktop theme family');
  } else if (key === 'agentIslandMascotSkin') {
    if (!isAgentIslandMascotSkin(value)) throw new Error('Invalid desktop mascot');
  } else if (key === 'agentIslandSoundSettings' || key === 'agentIslandDisplayTarget') {
    if (!record(value) || JSON.stringify(value).length > 32 * 1024) throw new Error('Invalid desktop preference group');
    next = key === 'agentIslandSoundSettings' ? normalizeAgentIslandSoundSettings(value) : normalizeAgentIslandDisplayTarget(value);
  } else if (typeof value !== 'boolean') throw new Error('Invalid desktop preference');
  return next as DesktopPreferences[K];
}
export function normalizeDesktopPreferenceOverrides(raw: unknown): Partial<DesktopPreferences> {
  if (!record(raw)) throw new Error('Invalid desktop preferences');
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DESKTOP_PREFERENCE_KEYS.includes(key as DesktopPreferenceKey)) throw new Error('Unknown desktop preference');
    result[key] = normalizeDesktopPreference(key as DesktopPreferenceKey, value);
  }
  return result;
}
export type DesktopPreferencesSnapshot =
  | { status: 'ready'; profileStamp: string; revision: string; value: DesktopPreferences; defaults: DesktopPreferences; customizedKeys: DesktopPreferenceKey[]; isCustomized: boolean }
  | { status: 'migrationPending'; profileStamp: string; revision: string }
  | { status: 'unreadable'; profileStamp: string; revision: null };
export interface DesktopPreferencesUpdate {
  profileStamp: string;
  expectedRevision: string;
  set?: Partial<DesktopPreferences>;
  clear?: DesktopPreferenceKey[];
  importOnly: boolean;
}
/** 仅经本地固定 channel 的 preload 暴露，不接入 device-link 或 remoteRenderer。 */
export interface DesktopPreferencesReaderApi {
  get(): Promise<DesktopPreferencesSnapshot>;
  getSync(): DesktopPreferencesSnapshot | null;
  onChanged(callback: (profileStamp: string) => void): () => void;
}
export interface DesktopPreferencesRendererApi extends DesktopPreferencesReaderApi {
  update(request: DesktopPreferencesUpdate): Promise<DesktopPreferencesSnapshot>;
}
export const DESKTOP_PREFERENCES_CHANNELS = {
  get: 'desktop-preferences:get', getSync: 'desktop-preferences:get-sync',
  update: 'desktop-preferences:update', changed: 'desktop-preferences:changed',
} as const;
export function validateDesktopPreferencesUpdate(raw: unknown): DesktopPreferencesUpdate {
  if (!record(raw) || Object.keys(raw).some(k => !['profileStamp', 'expectedRevision', 'set', 'clear', 'importOnly'].includes(k))
    || typeof raw.profileStamp !== 'string' || !raw.profileStamp.length || raw.profileStamp.length > 256
    || typeof raw.expectedRevision !== 'string' || !raw.expectedRevision.length || raw.expectedRevision.length > 256
    || typeof raw.importOnly !== 'boolean') throw new Error('Invalid desktop preferences request');
  if (raw.clear !== undefined && (!Array.isArray(raw.clear) || raw.clear.length > DESKTOP_PREFERENCE_KEYS.length
    || raw.clear.some(k => !DESKTOP_PREFERENCE_KEYS.includes(k)))) throw new Error('Invalid desktop preferences clear');
  if (raw.importOnly && raw.clear !== undefined) throw new Error('Import cannot clear preferences');
  return { profileStamp: raw.profileStamp, expectedRevision: raw.expectedRevision, importOnly: raw.importOnly,
    ...(raw.set !== undefined ? { set: normalizeDesktopPreferenceOverrides(raw.set) } : {}),
    ...(raw.clear !== undefined ? { clear: raw.clear as DesktopPreferenceKey[] } : {}) };
}
