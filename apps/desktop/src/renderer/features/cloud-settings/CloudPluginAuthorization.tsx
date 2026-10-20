import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, Terminal, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProviderAccountHeader } from '@/components/settings/ProviderAccountHeader';
import { PluginSetupPrompt } from '@/components/new-chat/PluginSetupPrompt';
import { parsePendingPluginSetup } from '@/lib/pluginSetupSnapshot';
import {
  type PendingPluginSetup,
  type PluginSetupCommandInFlight,
  type PluginSetupInlineFormValues,
} from '@/lib/makerChatStore';
import { executeCloudPluginAction } from './pluginAuthorizationAction';
import type { CloudPluginResult } from '../../../shared/cloudPluginAuthorization';
import type { CloudAuthorizationProps } from './useCloudAuthorization';

type Operation = Extract<CloudPluginResult, { kind: 'setup' }>;
type Plugin = Extract<CloudPluginResult, { kind: 'plugins' }>['items'][number];
export function CloudPluginAuthorization({
  client,
  active,
  online,
  name,
  trial,
  refresh,
}: CloudAuthorizationProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Plugin[]>([]);
  const [deviceId, setDeviceId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [operation, setOperation] = useState<Operation>();
  const [card, setCard] = useState<PendingPluginSetup | null>(null);
  const [command, setCommand] = useState<PluginSetupCommandInFlight | null>(null);
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<'expanded' | 'minimized'>('expanded');
  const scope = useRef({ client, online });
  scope.current = { client, online };
  const alive = useRef(true),
    locked = useRef(false),
    serial = useRef(0),
    readSerial = useRef(0);
  const current = () => alive.current && scope.current.client === client && scope.current.online;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      serial.current++;
      readSerial.current++;
    };
  }, [client]);
  const load = async () => {
    if (!current() || !client.plugins) return;
    const seq = ++readSerial.current;
    setLoading(true);
    try {
      const cap = await client.connect();
      if (!current() || seq !== readSerial.current) return;
      setDeviceId(cap.deviceId);
      const all: Plugin[] = [];
      let offset = 0;
      for (let page = 0; page < 128; page++) {
        const result = await client.plugins({ operation: 'list', offset });
        if (!current() || seq !== readSerial.current) return;
        if (result.kind !== 'plugins' || result.offset !== offset) throw new Error('INVALID_PAGE');
        all.push(...result.items);
        if (result.nextOffset === undefined) {
          if (new Set(all.map((item) => item.id)).size !== all.length)
            throw new Error('INVALID_PAGE');
          setItems(all);
          return;
        }
        if (result.nextOffset <= offset) throw new Error('INVALID_PAGE');
        offset = result.nextOffset;
      }
      throw new Error('INVALID_PAGE');
    } catch {
      if (current()) setFailure('readFailed');
    } finally {
      if (current() && seq === readSerial.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (active && online) void load();
  }, [client, active, online, refresh]);
  useEffect(() => {
    if (!online) {
      serial.current++;
      readSerial.current++;
      setCard(null);
      setCommand(null);
    }
  }, [online]);
  const accept = (result: CloudPluginResult, id: string, pluginId: string) => {
    if (result.kind !== 'setup' || result.operationId !== id) throw new Error('SCOPE_CHANGED');
    const next =
      result.snapshot && typeof result.snapshot === 'object'
        ? parsePendingPluginSetup(result.snapshot)
        : null;
    if (result.snapshot && (!next || next.ghost.id !== pluginId)) throw new Error('SCOPE_CHANGED');
    if (current()) {
      setOperation(result);
      setCard(next);
    }
  };
  const start = async (plugin: Plugin) => {
    if (!current() || locked.current || !client.plugins) return;
    locked.current = true;
    const seq = ++serial.current;
    const id = crypto.randomUUID();
    setSelected(plugin.id);
    setCard(null);
    setCommand(null);
    setFailure(undefined);
    setNotice(undefined);
    setViewer('expanded');
    setOperation({ kind: 'setup', operationId: id, phase: 'starting' });
    try {
      const result = await client.plugins({
        operation: 'start',
        operationId: id,
        pluginId: plugin.id,
      });
      if (current() && seq === serial.current) accept(result, id, plugin.id);
    } catch {
      if (current() && seq === serial.current) {
        setOperation({ kind: 'setup', operationId: id, phase: 'unknown' });
        setFailure('authUnknown');
      }
    } finally {
      locked.current = false;
    }
  };
  const check = async (cancel = false) => {
    if (!current() || !operation || !selected || !client.plugins) return;
    const seq = ++serial.current;
    if (cancel) {
      setCard(null);
      setCommand(null);
    }
    try {
      const result = await client.plugins({
        operation: cancel ? 'cancel' : 'status',
        operationId: operation.operationId,
      });
      if (current() && seq === serial.current) {
        accept(result, operation.operationId, selected);
        setFailure(undefined);
        setNotice(undefined);
      }
    } catch {
      if (current() && seq === serial.current) setFailure('authUnknown');
    }
  };
  useEffect(() => {
    if (
      !online ||
      !operation ||
      !['starting', 'waiting'].includes(operation.phase) ||
      !selected ||
      !client.plugins
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const seq = serial.current;
      try {
        const result = await client.plugins!({
          operation: 'status',
          operationId: operation.operationId,
        });
        if (stopped || !current()) return;
        if (seq === serial.current) {
          accept(result, operation.operationId, selected);
          if (result.kind === 'setup' && !['starting', 'waiting'].includes(result.phase)) {
            setCommand(null);
            void load();
            return;
          }
        }
      } catch {
        if (!stopped && current() && seq === serial.current) {
          setCard(null);
          setCommand(null);
          setOperation({ ...operation, snapshot: undefined, phase: 'unknown' });
          setFailure('authUnknown');
        }
        return;
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 700);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, online, operation?.operationId, operation?.phase, selected]);
  const onCommand = async (
    requestId: string,
    action: 'run_action' | 'submit_form' | 'cancel',
    actionId?: string,
    values?: PluginSetupInlineFormValues,
  ) => {
    if (!current() || !card || card.terminal || card.requestId !== requestId || !deviceId) return;
    if (action === 'cancel') {
      await check(true);
      return;
    }
    if (command || locked.current) return;
    const step = card.steps.find((step) => step.action?.id === actionId);
    if (!step?.action || !['pending', 'failed'].includes(step.phase)) return;
    const seq = serial.current;
    locked.current = true;
    setFailure(undefined);
    setNotice(undefined);
    setCommand({ requestId, action, actionId });
    try {
      if (trial) {
        // Local demonstration only: never invoke real credentials or a browser.
        setCard({
          ...card,
          revision: card.revision + 1,
          terminal: true,
          steps: card.steps.map((s) => ({ ...s, phase: 'satisfied' })),
        });
        setOperation(operation ? { ...operation, phase: 'succeeded' } : undefined);
        return;
      }
      await executeCloudPluginAction(deviceId, card, action, step.action.id, values);
    } catch {
      if (current() && seq === serial.current) setFailure('authResponseFailed');
    } finally {
      values = undefined;
      locked.current = false;
      if (current() && seq === serial.current) setCommand(null);
    }
  };
  const openSettings = async (plugin: Plugin) => {
    if (!current() || locked.current || !client.plugins) return;
    locked.current = true;
    setFailure(undefined);
    setNotice(undefined);
    try {
      const cap = await client.connect();
      if (!current()) return;
      if (!trial) {
        await window.electronAPI.openRemoteDesktop({ deviceId: cap.deviceId, name });
        if (!current()) return;
      }
      const result = await client.plugins({ operation: 'open-settings', pluginId: plugin.id });
      if (current() && (result.kind !== 'settings' || result.pluginId !== plugin.id))
        throw new Error('SCOPE_CHANGED');
      if (trial && current()) setNotice('pluginSettingsTrial');
    } catch {
      if (current()) setFailure('pluginSettingsFailed');
    } finally {
      locked.current = false;
    }
  };
  const busy = !!operation && ['starting', 'waiting', 'unknown'].includes(operation.phase);
  return (
    <section aria-label={t('settings.tabs.ghosts')} className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-13 text-[var(--settings-section-desc)]">
          {t('cloudSettings.authScope', { name })}
        </p>
        <Button
          variant="secondary"
          size="md"
          disabled={!online || loading}
          onClick={() => void load()}
        >
          {t('cloudSettings.reload')}
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-13 text-[var(--text-secondary)]">
          {t(`cloudSettings.${notice}`)}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-13 text-[var(--text-secondary)]">
          {t(`cloudSettings.${failure}`)}
        </p>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]"
        >
          <ProviderAccountHeader
            icon={item.authorization === 'github-cli' ? <Terminal size={18} /> : <Plug size={18} />}
            title={item.name}
            subtitle={
              item.authorization === 'github-cli'
                ? t('cloudSettings.cliScope')
                : item.authorization === 'settings'
                  ? t('cloudSettings.customSettingsScope')
                  : t(
                      item.ready
                        ? 'cloudSettings.authConfigured'
                        : 'cloudSettings.authNotConfigured',
                    )
            }
            actions={
              <div className="flex flex-wrap gap-2">
                {item.authorization !== 'settings' && (
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={!online || loading || busy}
                    onClick={() => void start(item)}
                  >
                    {t('settings.providers.button.authorize')}
                  </Button>
                )}
                {item.settingsAvailable && (
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={!online || loading || busy}
                    onClick={() => void openSettings(item)}
                  >
                    <ExternalLink size={14} />
                    {t('cloudSettings.pluginSettings')}
                  </Button>
                )}
              </div>
            }
          />
          {selected === item.id && operation && (
            <div className="flex flex-col gap-3 px-5 pb-4">
              <p role="status" className="text-13 text-[var(--text-secondary)]">
                {t(`cloudSettings.authPhase.${operation.phase}`)}
              </p>
              {online && card && (
                <PluginSetupPrompt
                  key={`${deviceId}:${card.requestId}`}
                  remoteDeviceId={trial ? undefined : deviceId}
                  remote
                  pending={card}
                  viewerState={viewer}
                  onViewerStateChange={setViewer}
                  commandInFlight={command}
                  onCommand={(...args) => {
                    void onCommand(...args);
                  }}
                />
              )}
              {busy && !card && (
                <div className="flex gap-2">
                  {operation.phase === 'unknown' && (
                    <Button
                      variant="secondary"
                      size="md"
                      disabled={!online}
                      onClick={() => void check()}
                    >
                      {t('cloudSettings.authCheck')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={!online}
                    onClick={() => void check(true)}
                  >
                    {t('settings.providers.button.cancel')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {loading && !items.length && <p role="status">{t('cloudSettings.loading')}</p>}
      {!loading && !failure && !items.length && <p>{t('cloudSettings.noFields')}</p>}
      <p className="text-12 text-[var(--text-tertiary)]">{t('cloudSettings.authPluginsScope')}</p>
      {trial && (
        <p className="text-12 text-[var(--text-tertiary)]">{t('cloudSettings.authTrial')}</p>
      )}
    </section>
  );
}
