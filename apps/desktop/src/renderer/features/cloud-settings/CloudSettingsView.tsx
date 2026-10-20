import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';
import { SettingsSidebarNav } from '@/components/settings/SettingsSidebarNav';
import { resolveSettingsSearchEntry } from '@/components/settings/settingsSearchCatalog';
import { SettingsSearchNavigationContext } from '@/components/settings/SettingsSearchNavigation';
import { useSettingsSectionTarget } from '@/components/settings/useSettingsSectionTarget';
import { useAuth } from '@/contexts/AuthContext';
import {
  getDataOwnerGeneration,
  isDataOwnerGenerationCurrent,
} from '@/contexts/dataOwnerGeneration';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import {
  CLOUD_SETTINGS_GROUPS,
  type CloudSettingsDomain,
  type CloudSettingsState,
  type CloudSettingsTab,
} from '../../../shared/cloudSettings';
import { createCloudSettingsClient, type CloudSettingsClient } from './client';
import { CloudInstanceSection } from './CloudInstanceSection';
import { CloudBotAuthorization } from './CloudBotAuthorization';
import { CloudMcpAuthorization } from './CloudMcpAuthorization';
import { CloudPluginAuthorization } from './CloudPluginAuthorization';
import { CloudProviderAuthorization } from './CloudProviderAuthorization';
import { NativeCloudSections } from './NativeCloudSections';
import { cloudSearchEntryAllowed } from './search';
import type { SettingsSearchEntry } from '@/components/settings/settingsSearchTypes';
const groups = Object.keys(CLOUD_SETTINGS_GROUPS) as CloudSettingsTab[];
const card =
  'rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5';
export function CloudSettingsPanel({
  name,
  client,
  online,
  onBack,
  trial = false,
  focusMaintenance = false,
}: {
  name: string;
  client: CloudSettingsClient;
  online: boolean;
  onBack(): void;
  trial?: boolean;
  focusMaintenance?: boolean;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [tab, setTab] = useState<CloudSettingsTab | 'instance'>(
    client.instance ? 'instance' : 'general',
  );
  const activeDomains = tab === 'instance' ? [] : CLOUD_SETTINGS_GROUPS[tab];
  const outlet = useOutletContext<{ sidebarWidth?: number } | null>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchNavigation, setSearchNavigation] = useState<{
    entry: SettingsSearchEntry | null;
    activation: number;
  }>({ entry: null, activation: 0 });
  const [mcpAuthorization, setMcpAuthorization] = useState(false);
  const [botAuthorization, setBotAuthorization] = useState(false);
  const [pluginAuthorization, setPluginAuthorization] = useState(false);
  const [providerAuthorization, setProviderAuthorization] = useState(false);
  const [cpuCount, setCpuCount] = useState<number | undefined>();
  const [states, setStates] = useState<Partial<Record<CloudSettingsDomain, CloudSettingsState>>>(
    {},
  );
  const [domains, setDomains] = useState<CloudSettingsDomain[]>([]);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [tab]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [result, setResult] = useState<string>();
  const [epoch, setEpoch] = useState(0);
  const dirty = useRef(new Set<string>());
  const pending = useRef(false);
  const [writing, setWriting] = useState(false);
  const alive = useRef(true);
  const fresh = useRef(false);
  const changed = useMemo(
    () => (domain: string, value: boolean) => {
      if (value) dirty.current.add(domain);
      else dirty.current.delete(domain);
    },
    [],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      client.cancelAuthorizations?.();
    };
  }, [client]);
  useEffect(() => {
    let current = true;
    fresh.current = false;
    if (!online || writing || failure === 'saveUnconfirmed') return;
    setLoading(true);
    setFailure(undefined);
    void client
      .connect()
      .then(async (cap) => {
        const wanted = activeDomains.filter((domain) => cap.domains.includes(domain));
        const values = wanted.length ? await client.read(wanted) : [];
        if (!current) return;
        fresh.current = true;
        setDomains(cap.domains);
        setCpuCount(cap.cpuCount);
        setProviderAuthorization(cap.providerAuthorization === 1);
        setMcpAuthorization(cap.mcpAuthorization === 1);
        setBotAuthorization(cap.botAuthorization === 1);
        setPluginAuthorization(cap.pluginAuthorization === 1);
        setStates((before) => ({
          ...before,
          ...Object.fromEntries(values.map((state) => [state.domain, state])),
        }));
      })
      .catch((error) => {
        if (current)
          setFailure(
            error instanceof Error && error.message === 'CLOUD_SETTINGS_UNSUPPORTED'
              ? 'unsupported'
              : 'readFailed',
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      fresh.current = false;
    };
  }, [client, online, tab, epoch, writing]);
  useEffect(() => {
    const visibility = () => {
      fresh.current = false;
      if (document.visibilityState !== 'hidden') setEpoch((value) => value + 1);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  const leave = async () => {
    if (pending.current) return;
    if (
      dirty.current.size &&
      !(await confirm({
        presentation: 'standard',
        title: t('cloudSettings.discardTitle'),
        description: t('cloudSettings.discardBody'),
        confirmText: t('cloudSettings.discard'),
      }))
    )
      return;
    client.close();
    onBack();
  };
  const reload = async () => {
    if (pending.current || loading || !online) return;
    fresh.current = false;
    setLoading(true);
    try {
      await client.reconnect();
      if (alive.current) {
        setFailure(undefined);
        setEpoch((value) => value + 1);
      }
    } catch {
      if (alive.current) setFailure('readFailed');
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  const save = async (
    state: CloudSettingsState,
    set: Record<string, unknown>,
    clear?: string[],
  ) => {
    if (
      !alive.current ||
      !fresh.current ||
      !online ||
      pending.current ||
      document.visibilityState === 'hidden'
    )
      throw new Error('NOT_READY');
    pending.current = true;
    setWriting(true);
    setResult(undefined);
    try {
      const saved = await client.save(state, set, clear);
      if (!alive.current) throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
      setStates((before) => ({ ...before, [state.domain]: saved.state }));
      dirty.current.delete(state.domain);
      setResult(
        saved.application === 'failed'
          ? 'hostSettings.savedApplyFailed'
          : trial
            ? 'cloudSettings.trialSaved'
            : 'cloudSettings.saved',
      );
      return saved.state;
    } catch (error) {
      fresh.current = false;
      setFailure('saveUnconfirmed');
      throw error;
    } finally {
      pending.current = false;
      setWriting(false);
    }
  };
  const tabs = groups.filter((group) =>
    group === 'providers'
      ? providerAuthorization
      : group === 'im-bot'
        ? botAuthorization
        : group === 'ghosts'
          ? pluginAuthorization
          : !domains.length || CLOUD_SETTINGS_GROUPS[group].some((d) => domains.includes(d)),
  );
  const allowSearchEntry = (entry: SettingsSearchEntry) =>
    entry.tab === 'providers'
      ? providerAuthorization && entry.id === 'providers'
      : entry.tab === 'im-bot'
        ? botAuthorization && entry.id === 'im-bot'
        : entry.tab === 'ghosts'
          ? pluginAuthorization && entry.id === 'ghosts'
          : cloudSearchEntryAllowed(entry, domains, trial);
  useSettingsSectionTarget(
    searchNavigation.entry?.targetId ?? null,
    scrollRef,
    `${tab}:${searchNavigation.activation}:${loading}`,
    searchNavigation.entry?.fallbackTargetId,
  );
  return (
    <SettingsSearchNavigationContext.Provider value={searchNavigation}>
      <div
        className="h-full w-full overflow-hidden bg-[var(--settings-bg)]"
        role="main"
        aria-label={t('cloudSettings.title')}
        data-testid="cloud-settings"
      >
        <div className="flex h-full min-h-0 w-full justify-start pb-5">
          <SettingsSidebar
            width={outlet?.sidebarWidth}
            onBack={() => void leave()}
            disabled={writing}
          >
            <SettingsSidebarNav
              tabIds={tabs}
              activeTab={tab === 'instance' ? null : tab}
              leadingTab={
                client.instance
                  ? {
                      id: 'instance',
                      label: t('cloudSettings.instance.title'),
                      icon: Cloud,
                      selected: tab === 'instance',
                      onSelect: () => {
                        if (!pending.current) {
                          setTab('instance');
                          setSearchNavigation({ entry: null, activation: 0 });
                        }
                      },
                    }
                  : undefined
              }
              allowSearchEntry={allowSearchEntry}
              onSelectTab={(next) => {
                if (!pending.current) {
                  setTab(next as CloudSettingsTab);
                  setSearchNavigation({ entry: null, activation: 0 });
                  setResult(undefined);
                }
              }}
              onSelectSearchResult={({ tab: next, sectionId }) => {
                if (!pending.current) {
                  setTab(next as CloudSettingsTab);
                  setSearchNavigation((previous) => ({
                    entry: resolveSettingsSearchEntry(next, sectionId),
                    activation: previous.activation + 1,
                  }));
                }
              }}
            />
            {tab !== 'instance' && (
              <div className="mt-auto flex flex-col gap-2 px-3 pb-3 pt-6 text-12 leading-[1.5] text-[var(--settings-section-desc)]">
                <Button
                  variant="secondary"
                  tone="quiet"
                  compact
                  disabled={loading || !online || writing}
                  onClick={() => void reload()}
                >
                  {t('cloudSettings.reload')}
                </Button>
              </div>
            )}
          </SettingsSidebar>
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col pl-4 pr-6">
            <header
              data-cloud-settings-context
              className="mx-auto mb-4 flex w-full max-w-[920px] shrink-0 items-center gap-3 border-b border-[var(--settings-theme-card-border)] px-1 py-5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--settings-input-bg)] text-[var(--settings-section-title)]">
                <Cloud size={22} aria-hidden />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-20 font-medium leading-[1.2] text-[var(--settings-section-title)]">
                  {t('cloudSettings.title')}
                </h2>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-13 leading-[1.5]">
                  <span
                    className="break-words font-medium text-[var(--settings-section-title)]"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-[var(--settings-section-desc)]">
                    {t(
                      trial
                        ? 'cloudSettings.trial'
                        : online
                          ? 'cloudSettings.onlyTarget'
                          : 'cloudSettings.offline',
                    )}
                  </span>
                </div>
              </div>
            </header>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
            >
              <div className="mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32 animate-fade-in">
                {failure && tab !== 'instance' && (
                  <div role="alert" className={card}>
                    {t(`cloudSettings.${failure}`)}
                  </div>
                )}
                <span
                  className={
                    result === 'hostSettings.savedApplyFailed'
                      ? 'text-13 text-[var(--text-secondary)]'
                      : 'sr-only'
                  }
                  role="status"
                >
                  {result ? t(result) : ''}
                </span>
                {activeDomains.length > 0 && loading && !activeDomains.some((d) => states[d]) && (
                  <p
                    role="status"
                    className="py-[18px] text-13 text-[var(--settings-section-desc)]"
                  >
                    {t('cloudSettings.loading')}
                  </p>
                )}
                {activeDomains.length > 0 &&
                  !loading &&
                  !failure &&
                  !activeDomains.some((d) => states[d]?.status === 'ready') && (
                    <p className="py-[18px] text-13 text-[var(--settings-section-desc)]">
                      {t('cloudSettings.noFields')}
                    </p>
                  )}
                {client.instance && (
                  <div
                    hidden={tab !== 'instance'}
                    role="tabpanel"
                    id="settings-panel-instance"
                    aria-labelledby="settings-tab-instance"
                  >
                    <CloudInstanceSection
                      client={client}
                      name={name}
                      active={tab === 'instance'}
                      changed={changed}
                      focusMaintenance={focusMaintenance}
                    />
                  </div>
                )}
                {groups.map((group) => (
                  <div
                    key={group}
                    hidden={tab !== group}
                    role="tabpanel"
                    id={`settings-panel-${group}`}
                    aria-labelledby={`settings-tab-${group}`}
                  >
                    {group === 'im-bot' ? (
                      botAuthorization && (
                        <CloudBotAuthorization
                          client={client}
                          name={name}
                          online={online}
                          active={tab === group}
                          trial={trial}
                          refresh={epoch}
                        />
                      )
                    ) : group === 'ghosts' ? (
                      pluginAuthorization && (
                        <CloudPluginAuthorization
                          client={client}
                          name={name}
                          online={online}
                          active={tab === group}
                          trial={trial}
                          refresh={epoch}
                        />
                      )
                    ) : group === 'providers' ? (
                      providerAuthorization && (
                        <CloudProviderAuthorization
                          client={client}
                          name={name}
                          online={online}
                          active={tab === group}
                          trial={trial}
                          refresh={epoch}
                        />
                      )
                    ) : (
                      <fieldset
                        disabled={!online || loading || writing || !!failure || tab !== group}
                        className="m-0 min-w-0 border-0 p-0"
                      >
                        <NativeCloudSections
                          tab={group}
                          states={states}
                          disabled={!online || loading || writing || !!failure}
                          cpuCount={cpuCount}
                          trial={trial}
                          save={save}
                          changed={changed}
                        />
                      </fieldset>
                    )}
                    {group === 'builtin-tools' && mcpAuthorization && (
                      <CloudMcpAuthorization
                        client={client}
                        name={name}
                        online={online}
                        active={tab === group}
                        trial={trial}
                        refresh={epoch}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsSearchNavigationContext.Provider>
  );
}

export function CloudSettingsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { dataOwnerId } = useAuth();
  const devices = useDeviceLinkDeviceList();
  const candidates =
    devices?.filter(
      (device) => !device.isSelf && /^cloud-device-[a-f0-9]{24}$/.test(device.deviceId),
    ) ?? [];
  const selected = params.get('deviceId');
  const device = candidates.find((item) => item.deviceId === selected);
  const owner = getDataOwnerGeneration();
  const scope = JSON.stringify([dataOwnerId, owner.generation, selected]);
  const current = useRef({ scope, online: false });
  current.current = {
    scope,
    // CIS verifies ownership; settings no longer depend on device-link control permission.
    online: !!device?.online,
  };
  const client = useMemo(
    () =>
      selected
        ? createCloudSettingsClient(selected, window.electronAPI.cloudSettings, () => {
            if (!isDataOwnerGenerationCurrent(owner) || current.current.scope !== scope)
              throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
          })
        : undefined,
    [scope],
  );
  const returnTo: unknown = location.state?.returnTo;
  const back = () =>
    navigate(
      typeof returnTo === 'string' &&
        returnTo.startsWith('/') &&
        !returnTo.startsWith('//') &&
        (!returnTo.startsWith('/cloud-settings') || (returnTo === '/cloud-settings' && !!selected))
        ? returnTo
        : '/cc-agent',
    );
  if (selected && /^cloud-device-[a-f0-9]{24}$/.test(selected) && client)
    return (
      <CloudSettingsPanel
        key={scope}
        name={device?.name ?? t('cloudSettings.instance.title')}
        client={client}
        online={current.current.online}
        onBack={back}
        focusMaintenance={params.get('section') === 'maintenance'}
      />
    );
  return <Navigate to="/settings?tab=cloud-instances" replace />;
}
