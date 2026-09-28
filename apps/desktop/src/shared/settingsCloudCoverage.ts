import { SETTINGS_READ_CATALOG, SETTINGS_READ_COLLECTION_IDS, SETTINGS_READ_EXTERNAL_CATALOG, type SettingsSnapshotFieldId } from './settingsReadCatalog.js';

export type CloudSettingsCoverage = { kind: 'editable'; domain: string; field: string }
  | { kind: 'dedicated' | 'notApplicable' | 'derived'; reason: string };
const edit = (domain: string, field: string): CloudSettingsCoverage => ({ kind: 'editable', domain, field });
/** Catalog audit for Linux cloud Hosts. Availability is still checked by each live native adapter. */
export function cloudSettingsFieldCoverage(id: SettingsSnapshotFieldId): CloudSettingsCoverage | undefined {
  if (!SETTINGS_READ_CATALOG[id].platforms.includes('linux')) return { kind: 'notApplicable', reason: 'Requires a different operating system.' };
  const [domain, ...segments] = id.split('.'), field = segments.join('.');
  if (domain === 'newTaskDefaults') return edit(domain, field === 'plan' ? 'planMode' : field);
  if (domain === 'personalization') return edit(domain, 'userPrompt');
  if (domain === 'appearance') return edit(domain, ({uiFontSize:'uiSize',codeFontSize:'codeSize',zoomFactor:'windowZoom',uiFontCustomized:'uiFamily',codeFontCustomized:'codeFamily'} as Record<string,string>)[field]!);
  if (['databaseWarning','collaboration','agentResource','gitSafety','memory','silentEncryptedRetry','chatEmbedding','lsp','terminal','auxiliaryModel','botModelChain','visionBridge'].includes(domain!)) return edit(domain!, field);
  if (domain === 'compaction') return edit(field === 'piAutoCompactPct' ? 'piCompaction' : 'claudeCompaction', field);
  if (domain === 'subagentModel') return edit(domain, field === 'claudeCodeProviderId' ? 'claudeCode' : field);
  if (domain === 'contacts') return edit(field === 'deviceSyncEnabled' ? 'contactsSync' : domain, field);
  if (domain === 'windowBehavior') return edit('linuxWindow', field);
  if (domain === 'analytics') return edit('privacy',field);
  if (domain === 'logUpload') return edit('diagnostics',field);
  if (domain === 'shortcuts') return edit('shortcuts','entries');
  if (domain === 'desktop') {
    if (field.startsWith('agentIsland')) return {kind:'notApplicable',reason:'Agent Island is a desktop platform feature.'};
    const key = field === 'themeFamilyIdConfigured' ? 'themeFamilyId' : field;
    return edit(['theme','themeFamilyId','locale','sidebarPinnedMode','sidebarMainMode','ghostPanelRestoreMode'].includes(key) ? 'desktopGeneral'
      : ['notificationsEnabled','feishuNotificationsEnabled','swallowActivationClick','networkDebugEnabled'].includes(key) ? 'desktopNotifications' : 'desktopChat',key);
  }
  if (domain === 'im') {
    if (segments[0] === 'localTelegram') return ['botNameConfigured','soulConfigured'].includes(segments[1]!) ? edit('telegramPersona',segments[1]!.replace('Configured','')) : edit('telegramBehavior',segments[1]!);
    if (segments[0] === 'wecom' && segments[1] === 'notificationsEnabled') return edit('wecomNotifications','enabled');
    if (segments[0] === 'official') {
      if (segments[1] === 'slackLifecycleAnnouncement') return edit('officialHooks','lifecycleAnnouncement');
      if (segments[1]!.endsWith('DefaultWorkspaceConfigured')) return edit('officialHooks',segments[1]!.replace('Configured',''));
      return {kind:'dedicated',reason:'Connection and server selection belong to the native IM binding flow.'};
    }
    if (segments[1] === 'groupPermissionMode' && segments[0] !== 'feishu') return {kind:'notApplicable',reason:'The native runtime consumes group permissions only for Feishu; other channel values are not active settings.'};
    const group = 'im' + segments[0]![0]!.toUpperCase() + segments[0]!.slice(1);
    return edit(group,segments[1] === 'agents' ? segments[2] === 'claude-code' ? 'claudeCode' : segments[2]! : segments[1]!);
  }
  if (domain === 'browser') return field === 'backend' ? edit('browserBackend','kind') : field === 'enabled' ? edit('browserTools','browser') : {kind:'dedicated',reason:'Copying personal browser login data requires its native consent flow and an available source profile.'};
  if (domain === 'computer') return edit('computerTools','computer');
  if (domain === 'android') return field === 'enabled' ? edit('androidTools','android') : {kind:'dedicated',reason:'ADB executable and device selection require the native Android setup flow; absent on the target cloud runtime.'};
  if (domain === 'voice') return {kind:'notApplicable',reason:'Desktop microphone and dictation settings require an audio device; the target cloud runtime has none.'};
  if (domain === 'worklouder' || domain === 'gamepad') return {kind:'notApplicable',reason:'Requires an attached physical input device.'};
  if (domain === 'deviceLink') return {kind:'dedicated',reason:'Remote desktop/control consent and device permissions use the existing device connection flow.'};
  if (domain === 'updateChannel' || domain === 'autoUpdate') return {kind:'notApplicable',reason:'This cloud runtime is updated by its instance image policy, not the desktop updater.'};
  return undefined;
}
const collections: Record<string, CloudSettingsCoverage> = {
  modelVisibility:edit('modelVisibility','entries'),modelEngines:edit('modelEngines','entries'),modelFavorites:edit('modelFavorites','entries'),modelDisable:edit('modelAccess','models'),
  providerPresentation:edit('providerNames','entries'),modelContextBudget:edit('modelContext','entries'),modelPrices:edit('modelPrices','entries'),
  modelParameterHistory:{kind:'derived',reason:'Recent model choices are written by actual selections; they are not an independent settings editor.'},
  visionBridgeTargets:edit('visionBridge','targetModels'),imWorkspacePrefs:edit('imWorkspaces','entries'),telegramGroupActivation:edit('telegramGroups','always'),
  builtinToolOverrides:edit('workspaceTools','ssh'),pluginSidebar:edit('pluginSidebar','hidden'),pluginCindyPrefs:edit('pluginCindy','imageGenerate'),pluginErrandPrefs:edit('pluginErrand','routes'),
};
export const CLOUD_SETTINGS_COLLECTION_COVERAGE = Object.fromEntries(SETTINGS_READ_COLLECTION_IDS.map(id => [id, collections[id]]));
export const CLOUD_SETTINGS_EXTERNAL_COVERAGE = Object.fromEntries(SETTINGS_READ_EXTERNAL_CATALOG.map(entry => [entry.id,{kind:'dedicated' as const,reason:`Existing ${entry.entry} ${entry.kind} flow; not a generic settings mutation.`}]));
