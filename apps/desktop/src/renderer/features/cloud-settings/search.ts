import type { SettingsSearchEntry } from '@/components/settings/settingsSearchTypes';
import {
  CLOUD_SETTINGS_GROUPS,
  type CloudSettingsDomain,
  type CloudSettingsTab,
} from '../../../shared/cloudSettings';
const targetDomain: Record<string, CloudSettingsDomain> = {
  'settings-collaboration': 'collaboration',
  'settings-agent-resource': 'agentResource',
  'settings-search-target-general-git-safety': 'gitSafety',
  'settings-search-target-general-experimental': 'lsp',
  'settings-search-target-personalization-user-prompt': 'personalization',
  'settings-search-target-personalization-memory': 'memory',
  'settings-contacts': 'contacts',
  'settings-search-target-personalization-compaction': 'claudeCompaction',
  'settings-search-target-personalization-terminal-shell': 'terminal',
  'settings-search-target-personalization-tips': 'silentEncryptedRetry',
};
export function cloudSearchEntryAllowed(
  entry: SettingsSearchEntry,
  domains: readonly CloudSettingsDomain[],
  trial: boolean,
): boolean {
  if (!(entry.tab in CLOUD_SETTINGS_GROUPS)) return false;
  if (entry.id === 'settings.promptRecommendation.label') return false;
  if (entry.tab === 'storage')
    return (
      domains.includes('databaseWarning') &&
      [
        'storage',
        'settings.about.storage.dbSizeWarningThresholdLabel',
        'settings.about.storage.dbSizeWarningDisableLabel',
      ].includes(entry.id)
    );
  if (entry.tab === 'about')
    return (
      domains.includes('diagnostics') && entry.id === 'settings.about.logUpload.crashAutoLabel'
    );
  if (entry.tab === 'computer-use')
    return (
      domains.some((d) => d === 'browserTools' || d === 'computerTools') &&
      [
        'computerUse',
        'settings.computerUse.browser.title',
        'settings.computerUse.directControl.title',
      ].includes(entry.id)
    );
  if (entry.tab === 'builtin-tools') return domains.includes('builtinTools');
  if (entry.id === 'general' || entry.id === 'personalization')
    return CLOUD_SETTINGS_GROUPS[entry.tab as CloudSettingsTab].some((d) => domains.includes(d));
  const domain = targetDomain[entry.fallbackTargetId ?? entry.targetId];
  return !!domain && domains.includes(domain) && (domain !== 'gitSafety' || trial);
}
