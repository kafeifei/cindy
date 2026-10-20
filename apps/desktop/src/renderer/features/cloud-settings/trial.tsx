import { createTrialMcpAuthorization } from './trialMcpAuthorization';
/** Development-only interactive trial. Never connected to a real owner or disk. */
import { createTrialPluginAuthorization } from './trialPluginAuthorization';
import { createTrialAuthorization } from './trialAuthorization';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudSettingsPanel } from './CloudSettingsView';
import type { CloudSettingsClient } from './client';
import { settingsWebUpdateSchema } from '../../../shared/settingsWeb';
import {
  CLOUD_SETTINGS_DOMAINS,
  cloudSettingsStateSchema,
  type CloudSettingsDomain,
  type CloudSettingsState,
} from '../../../shared/cloudSettings';

export function createTrialCloudSettingsClient(): CloudSettingsClient &
  Required<Pick<CloudSettingsClient, 'manage' | 'plugins'>> {
  const binding = {
    deviceId: 'cloud-settings-trial',
    runtimeId: crypto.randomUUID(),
    ownerGeneration: 1,
  };
  const defaults: Record<CloudSettingsDomain, Record<string, string | number | boolean>> = {
    agentResource: {
      maxConcurrentCommands: 4,
      processPriority: 'normal',
      capToolchainThreads: true,
    },
    collaboration: { workerSoftLimit: 4, workerHardLimit: 8, workerIdleReleaseMinutes: 10 },
    gitSafety: { autoSnapshotEnabled: true },
    personalization: { userPrompt: '' },
    memory: { maker: true, claudeCode: false, codex: false, pi: true },
    claudeCompaction: { claudeCodeAutoCompactPct: 90 },
    piCompaction: { piAutoCompactPct: 90 },
    contacts: { enabled: false },
    contactsSync: { deviceSyncEnabled: false },
    chatEmbedding: { enabled: true },
    silentEncryptedRetry: { enabled: true },
    terminal: { defaultShellPref: 'auto' },
    builtinTools: {
      feishu_bot: true,
      wechat: true,
      slack: true,
      ssh: true,
      docs: true,
      collab: true,
    },
    lsp: { enabled: true },
    browserTools: { browser: true },
    computerTools: { computer: true },
    databaseWarning: { thresholdGiB: 10, disabled: false },
    diagnostics: { crashAutoUploadEnabled: true },
  };
  const states = new Map<CloudSettingsDomain, CloudSettingsState>(
    CLOUD_SETTINGS_DOMAINS.map((domain) => [
      domain,
      {
        domain,
        status: 'ready',
        revision: '1',
        operationId: crypto.randomUUID(),
        value: { ...defaults[domain] },
        defaults: defaults[domain],
        isCustomized: false,
        customizedKeys: [],
        ...(domain === 'terminal'
          ? {
              choices: {
                defaultShellPref: [
                  { value: 'auto', label: 'Auto' },
                  { value: 'bash', label: 'Bash' },
                  { value: 'sh', label: 'sh' },
                ],
              },
            }
          : {}),
      },
    ]),
  );
  const manage = createTrialAuthorization();
  const mcp = createTrialMcpAuthorization();
  const plugins = createTrialPluginAuthorization();
  let closed = false;
  const check = () => {
    if (closed) throw new Error('CLOSED');
  };
  return {
    async plugins(command) {
      check();
      return plugins(command);
    },
    async manage(command) {
      check();
      return mcp.owns(command) ? mcp.execute(command) : manage(command);
    },
    async connect() {
      check();
      return {
        version: 1,
        providerAuthorization: 1,
        botAuthorization: 1,
        pluginAuthorization: 1,
        mcpAuthorization: 1,
        cpuCount: 8,
        ...binding,
        domains: [...CLOUD_SETTINGS_DOMAINS],
      };
    },
    async reconnect() {
      check();
      return {
        version: 1,
        providerAuthorization: 1,
        botAuthorization: 1,
        pluginAuthorization: 1,
        mcpAuthorization: 1,
        cpuCount: 8,
        ...binding,
        domains: [...CLOUD_SETTINGS_DOMAINS],
      };
    },
    async read(domains) {
      check();
      return structuredClone(domains.map((domain) => states.get(domain)!));
    },
    async save(state, set, clear = []) {
      check();
      settingsWebUpdateSchema.parse({
        domain: state.domain,
        operationId: state.operationId,
        expectedRevision: state.revision,
        set,
        clear,
      });
      const current = states.get(state.domain)!;
      if (state.revision !== current.revision || state.operationId !== current.operationId)
        throw new Error('CONFLICT');
      const customizedKeys = [
        ...new Set([
          ...(current.customizedKeys ?? []).filter((key) => !clear.includes(key)),
          ...Object.keys(set),
        ]),
      ];
      const next = cloudSettingsStateSchema.parse({
        ...current,
        value: {
          ...current.value,
          ...Object.fromEntries(clear.map((key) => [key, current.defaults![key]])),
          ...set,
        },
        revision: String(Number(current.revision) + 1),
        operationId: crypto.randomUUID(),
        isCustomized: !!customizedKeys.length,
        customizedKeys,
      });
      states.set(state.domain, next);
      return { state: structuredClone(next), application: 'applied' };
    },
    close() {
      closed = true;
      states.clear();
    },
  };
}
export function CloudSettingsTrial() {
  const { t } = useTranslation();
  const client = useMemo(createTrialCloudSettingsClient, []);
  if (!import.meta.env.DEV) return null;
  return (
    <div className="h-full">
      <CloudSettingsPanel
        name={t('cloudSettings.trialInstance')}
        client={client}
        online
        trial
        onBack={() => {
          window.location.hash = '/cc-agent';
        }}
      />
    </div>
  );
}
