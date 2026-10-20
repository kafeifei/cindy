import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { AgentResourceSectionView } from '@/components/settings/AgentResourceSection';
import { CollaborationSectionView } from '@/components/settings/CollaborationSection';
import { CompactionSectionView } from '@/components/settings/CompactionSection';
import { MemorySectionView } from '@/components/settings/MemorySection';
import { GitSafetySectionView } from '@/components/settings/GitSafetySection';
import { TerminalShellSectionView } from '@/components/settings/TerminalShellSection';
import { SilentEncryptedRetryCellView } from '@/components/settings/SilentEncryptedRetryCell';
import { ChatEmbeddingCellView } from '@/components/settings/ChatEmbeddingCell';
import { TipsSectionView } from '@/components/settings/TipsSection';
import { LspBetaCellView } from '@/components/settings/LspBetaCell';
import { BuiltinToolsSectionView } from '@/components/settings/BuiltinToolsSection';
import {
  BrowserAutomationHeader,
  ComputerAutomationHeader,
} from '@/components/settings/ComputerUseSection';
import { DatabaseWarningSettingsView } from '@/components/settings/StorageManagementCard';
import { CrashAutoUploadToggleView } from '@/components/settings/AboutSection';
import { ContactsSectionView } from '@/components/settings/contacts/ContactsSection';
import { UserPromptEditor } from '@/components/settings/UserPromptSection';
import type { AvailableShell, ShellId } from '../../../shared/terminal-bridge';
import type {
  CloudSettingsDomain,
  CloudSettingsState,
  CloudSettingsTab,
} from '../../../shared/cloudSettings';

type Props = {
  tab: CloudSettingsTab;
  states: Partial<Record<CloudSettingsDomain, CloudSettingsState>>;
  disabled: boolean;
  cpuCount?: number;
  trial: boolean;
  save(
    state: CloudSettingsState,
    set: Record<string, unknown>,
    clear?: string[],
  ): Promise<CloudSettingsState>;
  changed(domain: string, dirty: boolean): void;
};
const num = (s: CloudSettingsState, key: string) => Number(s.value?.[key]);
const bool = (s: CloudSettingsState, key: string) => s.value?.[key] === true;
const section = (id: string, content: ReactNode) => (
  <section
    id={id}
    key={id}
    className={
      id.includes('general') || id === 'settings-collaboration' || id === 'settings-agent-resource'
        ? 'py-[18px]'
        : 'pb-[18px]'
    }
  >
    {content}
  </section>
);
const box =
  'flex flex-col overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]';

function Resource({
  state,
  save,
  changed,
  cpuCount,
  disabled,
}: Pick<Props, 'save' | 'changed' | 'cpuCount' | 'disabled'> & { state: CloudSettingsState }) {
  const { t } = useTranslation();
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  useEffect(() => {
    changed('agentResource', maxDraft !== null);
  }, [maxDraft, changed]);
  const settings = {
    maxConcurrentCommands: num(state, 'maxConcurrentCommands'),
    processPriority: String(state.value?.processPriority) as 'normal' | 'low' | 'lowest',
    capToolchainThreads: bool(state, 'capToolchainThreads'),
    isCustomized: state.isCustomized,
    customizedKeys: state.customizedKeys,
    defaults: state.defaults,
  } as ComponentProps<typeof AgentResourceSectionView>['settings'];
  const presets = {
    full: { maxConcurrentCommands: 0, processPriority: 'normal', capToolchainThreads: false },
    balanced: {
      maxConcurrentCommands: Math.min(64, Math.max(2, Math.ceil((cpuCount ?? 2) / 2))),
      processPriority: 'low',
      capToolchainThreads: true,
    },
    background: { maxConcurrentCommands: 2, processPriority: 'lowest', capToolchainThreads: true },
  } as const;
  const activePreset =
    (Object.keys(presets) as (keyof typeof presets)[]).find((key) =>
      Object.entries(presets[key]).every(([field, value]) => state.value?.[field] === value),
    ) ?? null;
  const commit = async (set: Record<string, unknown>, clear?: string[]) => {
    try {
      await save(state, set, clear);
    } catch {
      toast.error(t('hostSettings.saveFailed'));
    }
  };
  return (
    <AgentResourceSectionView
      settings={settings}
      activePreset={activePreset}
      applyingPreset={disabled}
      maxDraft={maxDraft}
      setMaxDraft={setMaxDraft}
      persist={(key, value) => void commit({ [key]: value })}
      applyPreset={async (id) => {
        if (id === 'balanced' && !cpuCount) {
          toast.error(t('cloudSettings.readFailed'));
          return;
        }
        setMaxDraft(null);
        await commit(presets[id]);
      }}
      reset={() => void commit({}, Object.keys(state.defaults ?? {}))}
    />
  );
}
function Compaction({
  states,
  save,
  changed,
  disabled,
}: Pick<Props, 'states' | 'save' | 'changed' | 'disabled'>) {
  const [preview, setPreview] = useState<
    Partial<Record<'claudeCompaction' | 'piCompaction', number>>
  >({});
  const timers = useRef<
    Partial<Record<'claudeCompaction' | 'piCompaction', ReturnType<typeof setTimeout>>>
  >({});
  const { t } = useTranslation();
  const current = useRef({ save });
  current.current = { save };
  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout);
    },
    [],
  );
  const control = (domain: 'claudeCompaction' | 'piCompaction', field: string) => {
    const state = states[domain]!;
    return {
      pct: preview[domain] ?? num(state, field),
      defaultPct: Number(state.defaults?.[field]),
      isCustomized: !!state.isCustomized,
      setPct(next: number) {
        if (disabled) return;
        setPreview((p) => ({ ...p, [domain]: next }));
        changed(domain, true);
        clearTimeout(timers.current[domain]);
        timers.current[domain] = setTimeout(() => {
          void current.current
            .save(state, { [field]: next })
            .then(() => {
              setPreview((p) => {
                const n = { ...p };
                delete n[domain];
                return n;
              });
              changed(domain, false);
            })
            .catch(() => toast.error(t('hostSettings.saveFailed')));
        }, 300);
      },
      async resetPct() {
        clearTimeout(timers.current[domain]);
        const saved = await save(state, {}, [field]);
        setPreview((p) => {
          const n = { ...p };
          delete n[domain];
          return n;
        });
        changed(domain, false);
        return num(saved, field);
      },
    };
  };
  return (
    <CompactionSectionView
      disabled={disabled}
      claude={control('claudeCompaction', 'claudeCodeAutoCompactPct')}
      pi={control('piCompaction', 'piAutoCompactPct')}
    />
  );
}
function Storage({
  state,
  save,
  disabled,
  changed,
}: Pick<Props, 'save' | 'disabled' | 'changed'> & { state: CloudSettingsState }) {
  const [draft, setDraft] = useState(String(state.value?.thresholdGiB));
  const [invalid, setInvalid] = useState(false);
  const dirty = draft !== String(state.value?.thresholdGiB);
  const previous = useRef(state.value?.thresholdGiB);
  useEffect(() => {
    if (draft === String(previous.current)) setDraft(String(state.value?.thresholdGiB));
    previous.current = state.value?.thresholdGiB;
  }, [state]);
  useEffect(() => {
    changed('databaseWarning', dirty);
  }, [dirty, changed]);
  const { t } = useTranslation();
  const persist = async (patch?: { disabled?: boolean; thresholdGiB?: number }) => {
    try {
      const result = await save(
        state,
        patch ?? {},
        patch ? undefined : ['disabled', 'thresholdGiB'],
      );
      setDraft(String(result.value?.thresholdGiB));
    } catch {
      toast.error(t('hostSettings.saveFailed'));
    }
  };
  return (
    <DatabaseWarningSettingsView
      warningThresholdDraft={draft}
      warningThresholdInvalid={invalid}
      warningSaving={disabled}
      warningDisabled={bool(state, 'disabled')}
      warningCustomized={!!state.isCustomized}
      onThresholdChange={(value) => {
        setDraft(value);
        setInvalid(false);
      }}
      saveWarningThreshold={async () => {
        if (!dirty) return;
        const value = Number(draft);
        if (!draft || !Number.isInteger(value) || value < 1 || value > 1024) {
          setInvalid(true);
          return;
        }
        await persist({ thresholdGiB: value });
      }}
      persistWarningSettings={persist}
    />
  );
}

export function NativeCloudSections(props: Props) {
  const { tab, states, save, disabled, changed, trial } = props;
  const { t } = useTranslation();
  // The three-mode Git control requires the native mode wire field. The legacy
  // boolean cloud field cannot distinguish existing repositories from all projects.
  // The trial can demonstrate the native control; production does not guess a mode.
  const [trialGitMode, setTrialGitMode] = useState<'off' | 'existing-git' | 'all-projects'>(
    'all-projects',
  );
  const ready = (d: CloudSettingsDomain) => (states[d]?.status === 'ready' ? states[d] : undefined);
  const update = async (d: CloudSettingsDomain, set: Record<string, unknown>, clear?: string[]) => {
    const s = ready(d);
    if (!s) throw Error('NOT_READY');
    return save(s, set, clear);
  };
  const attempt = async (
    d: CloudSettingsDomain,
    set: Record<string, unknown>,
    clear?: string[],
  ) => {
    try {
      await update(d, set, clear);
    } catch {
      toast.error(t('hostSettings.saveFailed'));
    }
  };
  const reset = (d: CloudSettingsDomain) => attempt(d, {}, Object.keys(states[d]?.defaults ?? {}));
  const s = (d: CloudSettingsDomain) => states[d]!;
  const c = (d: CloudSettingsDomain) => !!s(d).isCustomized;
  if (tab === 'general')
    return (
      <>
        {ready('collaboration') &&
          section(
            'settings-collaboration',
            <CollaborationSectionView
              settings={{
                workerSoftLimit: num(s('collaboration'), 'workerSoftLimit'),
                workerHardLimit: num(s('collaboration'), 'workerHardLimit'),
                workerIdleReleaseMinutes: num(s('collaboration'), 'workerIdleReleaseMinutes'),
                isCustomized: c('collaboration'),
              }}
              persist={(key, value) => void attempt('collaboration', { [key]: value })}
              reset={() => void reset('collaboration')}
            />,
          )}
        {ready('agentResource') &&
          section('settings-agent-resource', <Resource {...props} state={s('agentResource')} />)}
        {trial &&
          ready('gitSafety') &&
          section(
            'settings-search-target-general-git-safety',
            <GitSafetySectionView
              mode={trialGitMode}
              saving={disabled}
              isCustomized={trialGitMode !== 'all-projects'}
              handleModeChange={setTrialGitMode}
              handleReset={() => setTrialGitMode('all-projects')}
            />,
          )}
        {ready('lsp') &&
          section(
            'settings-search-target-general-experimental',
            <div className="flex flex-col gap-[14px]">
              <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
                {t('settings.experimental.title')}
              </h2>
              <LspBetaCellView
                enabled={bool(s('lsp'), 'enabled')}
                pending={disabled}
                handleToggle={(next) => attempt('lsp', { enabled: next })}
              />
            </div>,
          )}
      </>
    );
  if (tab === 'personalization')
    return (
      <>
        {ready('personalization') &&
          section(
            'settings-search-target-personalization-user-prompt',
            <UserPromptEditor
              value={String(s('personalization').value?.userPrompt ?? '')}
              ready={!disabled}
              unavailable={false}
              customized={c('personalization')}
              revision={s('personalization').revision}
              ownerKey="cloud-target"
              onDirtyChange={(dirty) => changed('personalization', dirty)}
              setValue={async (value, revision) => {
                if (revision !== s('personalization').revision) throw Error('CONFLICT');
                await update('personalization', { userPrompt: value });
              }}
              resetValue={async (revision) => {
                if (revision !== s('personalization').revision) throw Error('CONFLICT');
                await update('personalization', {}, ['userPrompt']);
              }}
            />,
          )}
        {ready('memory') &&
          section(
            'settings-search-target-personalization-memory',
            <MemorySectionView
              settingsCustomized={c('memory')}
              makerEnabled={bool(s('memory'), 'maker')}
              makerTogglePending={disabled}
              makerResetPending={false}
              slots={{
                'claude-code': { enabled: bool(s('memory'), 'claudeCode'), pending: disabled },
                codex: { enabled: bool(s('memory'), 'codex'), pending: disabled },
                pi: { enabled: bool(s('memory'), 'pi'), pending: disabled },
              }}
              handleResetSettings={() => reset('memory')}
              handleMakerToggle={(next) =>
                attempt(
                  'memory',
                  next ? { maker: true, claudeCode: false, codex: false } : { maker: false },
                )
              }
              handleMakerReset={undefined}
              handleReset={undefined}
              handleToggle={(kind, next) =>
                attempt('memory', { [kind === 'claude-code' ? 'claudeCode' : kind]: next })
              }
            />,
          )}
        {ready('contacts') &&
          ready('contactsSync') &&
          section(
            'settings-contacts',
            <ContactsSectionView
              enabled={bool(s('contacts'), 'enabled')}
              togglePending={disabled}
              aiSessionPending={false}
              statsLine=""
              pendingCount={0}
              syncStatus={{
                available: true,
                enabled: bool(s('contactsSync'), 'deviceSyncEnabled'),
              }}
              syncPending={disabled}
              syncSummary=""
              handleToggle={(next) => attempt('contacts', { enabled: next })}
              handleSyncToggle={(next) => attempt('contactsSync', { deviceSyncEnabled: next })}
              handleSyncNow={undefined}
              startAiSession={undefined}
              onManage={undefined}
              manager={null}
            />,
          )}
        {ready('claudeCompaction') &&
          ready('piCompaction') &&
          section('settings-search-target-personalization-compaction', <Compaction {...props} />)}
        {ready('terminal') &&
          section(
            'settings-search-target-personalization-terminal-shell',
            <TerminalShellSectionView
              pref={String(s('terminal').value?.defaultShellPref) as ShellId}
              shells={(s('terminal').choices?.defaultShellPref ?? [])
                .filter((x) => x.value !== 'auto')
                .map(
                  (x) =>
                    ({
                      id: x.value,
                      command: x.value,
                      displayName: x.label,
                      isAutoDetectTarget: false,
                    }) as AvailableShell,
                )}
              resetting={disabled}
              isCustomized={c('terminal')}
              onChange={(next) => void attempt('terminal', { defaultShellPref: next })}
              onReset={() => reset('terminal')}
              autoLabel={t('settings.terminalShell.auto')}
              unavailablePref={null}
            />,
          )}
        {(ready('silentEncryptedRetry') || ready('chatEmbedding')) &&
          section(
            'settings-search-target-personalization-tips',
            <TipsSectionView>
              {ready('silentEncryptedRetry') && (
                <SilentEncryptedRetryCellView
                  enabled={bool(s('silentEncryptedRetry'), 'enabled')}
                  isCustomized={c('silentEncryptedRetry')}
                  pending={disabled}
                  handleToggle={(next) => attempt('silentEncryptedRetry', { enabled: next })}
                  handleReset={() => reset('silentEncryptedRetry')}
                />
              )}{' '}
              {ready('chatEmbedding') && (
                <ChatEmbeddingCellView
                  enabled={bool(s('chatEmbedding'), 'enabled')}
                  isCustomized={c('chatEmbedding')}
                  pending={disabled}
                  handleToggle={(next) => attempt('chatEmbedding', { enabled: next })}
                  handleReset={() => reset('chatEmbedding')}
                />
              )}
            </TipsSectionView>,
          )}
      </>
    );
  if (tab === 'builtin-tools' && ready('builtinTools'))
    return (
      <BuiltinToolsSectionView
        plugins={Object.entries(s('builtinTools').value ?? {}).map(([id, value]) => ({
          id,
          name: id,
          description: '',
          effectiveEnabled: value === true,
          userOverride: s('builtinTools').customizedKeys?.includes(id)
            ? { enabled: value === true }
            : null,
        }))}
        pendingIds={new Set(disabled ? Object.keys(s('builtinTools').value ?? {}) : [])}
        handleToggle={(id, next) => void attempt('builtinTools', { [id]: next })}
        handleClearOverride={(id) => void attempt('builtinTools', {}, [id])}
      />
    );
  if (tab === 'computer-use')
    return (
      <div className="flex flex-col gap-[14px]">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
            {t('settings.computerUse.title')}
          </h2>
          <p className="text-13 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('settings.computerUse.description')}
          </p>
        </div>
        {ready('browserTools') && (
          <div id="automation-browser" className={box}>
            <BrowserAutomationHeader
              checked={bool(s('browserTools'), 'browser')}
              disabled={disabled}
              onChange={(next) => void attempt('browserTools', { browser: next })}
            />
          </div>
        )}
        {ready('computerTools') && (
          <div id="automation-computer" className={box}>
            <ComputerAutomationHeader
              checked={bool(s('computerTools'), 'computer')}
              disabled={disabled}
              onChange={(next) => void attempt('computerTools', { computer: next })}
            />
          </div>
        )}
      </div>
    );
  if (tab === 'storage' && ready('databaseWarning'))
    return <Storage {...props} state={s('databaseWarning')} />;
  if (tab === 'about' && ready('diagnostics'))
    return (
      <div className={box}>
        <CrashAutoUploadToggleView
          customized={c('diagnostics')}
          enabled={bool(s('diagnostics'), 'crashAutoUploadEnabled')}
          disabled={disabled}
          resetting={disabled}
          handleToggle={(next) => attempt('diagnostics', { crashAutoUploadEnabled: next })}
          handleReset={() => reset('diagnostics')}
        />
      </div>
    );
  return null;
}
