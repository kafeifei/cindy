import { ADDITIONAL_SETTINGS_DOMAINS, additionalSettingsSchemas, additionalSettingsMetadata, isAdditionalSettingsDomain, normalizeAdditionalSettingsChange } from './settingsEditableCatalog.js';
import { isValidAppearanceSetting, clampAppearanceWindowZoom, type AppearanceSettings } from './appearanceSettings.js';

export const NATIVE_HOST_SETTINGS_DOMAINS = ['newTaskDefaults', 'personalization', 'databaseWarning', 'appearance'] as const;
export const HOST_SETTINGS_DOMAINS = [...NATIVE_HOST_SETTINGS_DOMAINS, ...ADDITIONAL_SETTINGS_DOMAINS] as const;
export type HostSettingsDomain = typeof HOST_SETTINGS_DOMAINS[number];
export type SettingsHarness = 'claude-code' | 'codex' | 'pi';
export interface NewTaskDefaultSettings {
  harness: SettingsHarness;
  providerId: string | null;
  modelId: string | null;
  effort: string | null;
  fast: boolean;
  thinking: boolean;
  worktree: boolean;
  planMode: boolean;
}
export interface PersonalizationSettings { userPrompt: string }
export interface DatabaseWarningSettings { thresholdGiB: number; disabled: boolean }
export interface HostSettingsValues {
  newTaskDefaults: NewTaskDefaultSettings;
  personalization: PersonalizationSettings;
  databaseWarning: DatabaseWarningSettings;
  appearance: AppearanceSettings;
}
export interface SettingsOwnerStamp { dataOwnerId: string | null; ownerGeneration: number }
/** value is the saved override + current defaults, NOT proof of application to a running task/window. */
export type HostSettingState<T> =
  | { status: 'ready'; value: T; defaults: T; customizedKeys: string[]; revision: string; isCustomized: boolean }
  | { status: 'unreadable' | 'unavailable'; revision: null };
export interface HostSettingsSnapshot {
  ownerStamp: SettingsOwnerStamp | null;
  newTaskDefaults: HostSettingState<NewTaskDefaultSettings>;
  personalization: HostSettingState<{ isCustomized: boolean }>;
  databaseWarning: HostSettingState<DatabaseWarningSettings>;
  appearance: HostSettingState<AppearanceSettings>;
}
export interface NativeHostSettingsSnapshot extends HostSettingsSnapshot {
  userPrompt: HostSettingState<PersonalizationSettings>;
  history: import('./newTaskPreferenceHistory.js').NewTaskPreferenceHistory | null;
  operationIds: Partial<Record<HostSettingsDomain, string>>;
}
export interface HostSettingsRendererApi {
  get(): Promise<NativeHostSettingsSnapshot>;
  update(input: HostSettingsUpdate & { ownerStamp: SettingsOwnerStamp }): Promise<HostSettingsReceipt>;
  saveHistory(input: { ownerStamp: SettingsOwnerStamp; expectedRevision: string; history: import('./newTaskPreferenceHistory.js').NewTaskPreferenceHistory; importOnly: boolean }): Promise<NativeHostSettingsSnapshot>;
  importPrompt(input: { ownerStamp: SettingsOwnerStamp; expectedRevision: string; userPrompt: string }): Promise<NativeHostSettingsSnapshot>;
  onChanged(callback: (stamp: SettingsOwnerStamp | null) => void): () => void;
}
export interface HostSettingsChange {
  domain: HostSettingsDomain;
  set: Record<string, import('./settingsEditableCatalog.js').SettingsEditableValue>;
  clear: string[];
}
export interface HostSettingsUpdate {
  domain: HostSettingsDomain;
  expectedRevision: string;
  operationId: string;
  /** Opaque, Host-issued identity of a known local workspace; no paths accepted. */
  workspaceId?: string;
  set?: Record<string, unknown>;
  clear?: string[];
}
export interface HostSettingsReceipt {
  operationId: string;
  domain: string;
  status: 'saved' | 'rejected' | 'unknown';
  saved: boolean;
  application: 'next_task' | 'next_agent_start' | 'applied' | 'failed' | 'not_applied';
  revision?: string;
  code?: string;
}

/** Stable capability directory, not a claim that every category is writable. */
export const HOST_SETTINGS_CATALOG = [
  { domain: 'newTaskDefaults', access: 'write', scope: 'owner', applies: 'next_task', fields: { harness: 'claude-code | codex | pi', providerId: 'available provider id', modelId: 'available model id', effort: 'supported effort or null for explicit automatic', fast: 'boolean', thinking: 'boolean', worktree: 'boolean', planMode: 'boolean' } },
  { domain: 'personalization', access: 'write', scope: 'owner', applies: 'next_agent_start', fields: { userPrompt: 'string, at most 8000 characters; body read requires human consent' } },
  { domain: 'databaseWarning', access: 'write', scope: 'profile', applies: 'immediate', fields: { thresholdGiB: 'number 1..1024', disabled: 'boolean' } },
  { domain: 'appearance', access: 'write', scope: 'profile', applies: 'host_desktop_only', fields: { uiFamily: 'string <=256 characters', codeFamily: 'string <=256 characters', uiSize: 'integer 12..24', codeSize: 'integer 10..24', windowZoom: 'number 0.5..3, step 0.1' } },
  ...ADDITIONAL_SETTINGS_DOMAINS.map(domain => ({ domain, access: 'write' as const, ...additionalSettingsMetadata[domain], fields: Object.keys(additionalSettingsSchemas[domain].shape) })),
  { domain: 'currentTaskRuntime', access: 'dedicated_tool', tools: ['get_session_runtime', 'set_session_runtime'], applies: 'next_send' },
  { domain: 'bots', access: 'dedicated_tool', entry: { server: 'cindy_helper', category: 'bots' }, note: '按当前任务身份发现伙伴专用能力，不赋予跨伙伴权限；其余配置使用伙伴设置页。' },
  { domain: 'schedules', access: 'dedicated_tool', entry: { server: 'cindy_scheduler', category: 'scheduler' } },
  { domain: 'pluginsAndAccounts', access: 'dedicated_tool', tools: ['ghost_info', 'ghost_call', 'connect_account'] },
  { domain: 'memoryAndContext', access: 'dedicated_ui', areas: ['记忆内容查看与重置'], note: '开关使用 memory，压缩使用 claudeCompaction / piCompaction。内容删除不同于恢复默认。' },
  { domain: 'providersAndModelRouting', access: 'dedicated_ui', areas: ['模型供应商连接与模型管理', '子代理模型路由', '辅助模型及备用链', '视觉桥'], note: '不是新任务默认值；凭据使用专用授权入口，不返回正文。' },
  { domain: 'languageAndNotifications', access: 'dedicated_ui', applies: 'host_desktop_only', areas: ['系统通知授权'], note: '显示语言和通知偏好使用 desktopGeneral / desktopNotifications；不改变控制端。' },
  { domain: 'themesAndDesktopLayout', access: 'dedicated_ui', applies: 'host_desktop_only', areas: ['主题与主题导入', '桌面布局', '快捷键'], note: '不属于字体、字号与窗口缩放的四域写入接口。' },
  { domain: 'browserAndComputerUse', access: 'dedicated_ui', areas: ['浏览器自动化开关与 backend', '浏览器 profile 使用偏好', '平台电脑使用授权'], note: '平台授权依赖执行 Host；云实例没有对应桌面能力时不支持，不改控制端权限。' },
  { domain: 'mediaAndVoice', access: 'dedicated_ui', areas: ['语音服务模式与 ASR 来源', '自定义实时 ASR', '媒体模型来源'], note: '插件内生成偏好使用对应插件；无统一全局媒体配置工具。' },
  { domain: 'privacyAndDiagnostics', access: 'dedicated_ui', areas: ['分析统计开关', '崩溃自动上传', '网络调试', '手动上传日志'], note: '上传沿用隐私同意与专用确认，不能由通用设置接口触发。' },
  { domain: 'storageAndDataManagement', access: 'dedicated_ui', areas: ['媒体空间扫描与清理', '聊天附件维护', '数据库瘦身与备份', '会话导入'], note: '数据维护不等于数据库提醒设置；此目录不授权删除、迁移或导出数据。' },
  { domain: 'workspaceRuntimePreferences', access: 'dedicated_ui', areas: ['默认终端 shell', 'Git 自动快照'], note: '工作环境偏好不是新任务模型默认值。' },
  { domain: 'workspaceMcpSkills', access: 'dedicated_ui' },
  { domain: 'remoteControlPermissions', access: 'unsupported' },
  { domain: 'resourcesImageLifecycleUpdates', access: 'platform_policy' },
] as const;

export function isHostSettingsDomain(value: unknown): value is HostSettingsDomain {
  return typeof value === 'string' && HOST_SETTINGS_DOMAINS.includes(value as HostSettingsDomain);
}

const fields: Record<typeof NATIVE_HOST_SETTINGS_DOMAINS[number], readonly string[]> = {
  newTaskDefaults: ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking', 'worktree', 'planMode'],
  personalization: ['userPrompt'],
  databaseWarning: ['thresholdGiB', 'disabled'],
  appearance: ['uiFamily', 'codeFamily', 'uiSize', 'codeSize', 'windowZoom'],
};
const effortValues = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** Closed grammar shared by native UI and tools; never accepts paths, owners or permissions. */
export function normalizeHostSettingsChange(raw: unknown): HostSettingsChange {
  if (!isRecord(raw) || !isHostSettingsDomain(raw.domain)) throw new Error('INVALID_SETTINGS_CHANGE');
  if (Object.keys(raw).some((key) => !['domain', 'set', 'clear'].includes(key))) throw new Error('INVALID_SETTINGS_CHANGE');
  const domain = raw.domain;
  if (isAdditionalSettingsDomain(domain)) return normalizeAdditionalSettingsChange(domain, raw.set, raw.clear);
  if (raw.set !== undefined && !isRecord(raw.set)) throw new Error('INVALID_SETTINGS_CHANGE');
  if (raw.clear !== undefined && (!Array.isArray(raw.clear) || raw.clear.some((field) => typeof field !== 'string'))) throw new Error('INVALID_SETTINGS_CHANGE');
  const set: HostSettingsChange['set'] = {};
  const clear = [...new Set((raw.clear ?? []) as string[])].sort();
  if (clear.length > fields[domain].length || clear.some((field) => !fields[domain].includes(field))) throw new Error('INVALID_SETTINGS_CHANGE');
  for (const key of Object.keys((raw.set ?? {}) as Record<string, unknown>).sort()) {
    if (!fields[domain].includes(key) || clear.includes(key)) throw new Error('INVALID_SETTINGS_CHANGE');
    const value = (raw.set as Record<string, unknown>)[key];
    if (domain === 'personalization') {
      if (typeof value !== 'string' || value.length > 8000) throw new Error('INVALID_SETTINGS_CHANGE');
      set[key] = value;
    } else if (domain === 'newTaskDefaults') {
      if (key === 'harness') {
        if (typeof value !== 'string' || !['claude-code', 'codex', 'pi'].includes(value)) throw new Error('INVALID_SETTINGS_CHANGE');
        set[key] = value as SettingsHarness;
      } else if (['providerId', 'modelId'].includes(key)) {
        if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f]/.test(value)) throw new Error('INVALID_SETTINGS_CHANGE');
        set[key] = value.trim();
      } else if (key === 'effort') {
        if (value !== null && (typeof value !== 'string' || !effortValues.includes(value))) throw new Error('INVALID_SETTINGS_CHANGE');
        set[key] = value;
      } else {
        if (typeof value !== 'boolean') throw new Error('INVALID_SETTINGS_CHANGE');
        set[key] = value;
      }
    } else if (domain === 'databaseWarning') {
      if (key === 'disabled') {
        if (typeof value !== 'boolean') throw new Error('INVALID_SETTINGS_CHANGE');
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 1024) throw new Error('INVALID_SETTINGS_CHANGE');
      set[key] = value as number | boolean;
    } else {
      if (!isValidAppearanceSetting(key, value)) throw new Error('INVALID_SETTINGS_CHANGE');
      set[key] = typeof value === 'string' ? value.trim() : key === 'windowZoom' ? clampAppearanceWindowZoom(value) : value;
    }
  }
  if (Object.keys(set).length + clear.length === 0) throw new Error('INVALID_SETTINGS_CHANGE');
  return { domain, set, clear };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
