import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  ExternalLink,
  RefreshCw,
  Check,
  ChevronRight,
  ArrowLeft,
  Monitor,
  Moon,
  Play,
  CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import type { CloudSettingsRendererApi } from '../../../shared/cloudSettingsClient';
import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';
import { stableInstanceState, instanceStatus } from './instanceState';

export type CloudInstancesApi = Pick<
  CloudSettingsRendererApi,
  'instanceList' | 'instanceClaim' | 'instanceInitialize' | 'instancePower'
>;
type PowerPending = { deviceId: string; action: 'wake' | 'sleep'; uncertain: boolean };
const card =
  'rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5';
const description = 'text-13 leading-[1.6] text-[var(--settings-section-desc)]';

/** Membership discovery is read-only. Only the explicit claim button can ensure
 * a first instance; offline, loading and failed reads never become an empty list. */
export function CloudInstancesPage({
  api,
  onBack,
  onOpen,
  onOpenDesktop,
  canOpenDesktop,
  trial = false,
  embedded = false,
}: {
  api: CloudInstancesApi;
  onBack?(): void;
  onOpen(deviceId: string, section?: 'maintenance'): void;
  onOpenDesktop?(instance: CloudInstanceView): void;
  canOpenDesktop?(instance: CloudInstanceView): boolean;
  trial?: boolean;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const tr = (key: string, values?: Record<string, string | number>) =>
    t(`cloudSettings.onboarding.${key}`, values);
  const [instances, setInstances] = useState<CloudInstanceView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const [powerPending, setPowerPending] = useState<PowerPending>();
  const powerRef = useRef<PowerPending | undefined>(undefined);
  const markPower = (value: PowerPending | undefined) => {
    powerRef.current = value;
    setPowerPending(value);
  };
  const live = useRef(false),
    inFlight = useRef(false),
    openWhenReady = useRef<string | undefined>(undefined);
  const load = useCallback(
    async (explicit = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const next = await api.instanceList({});
        if (live.current) {
          setInstances(next);
          setError(undefined);
          const pending = powerRef.current;
          const observed = next.find((item) => item.deviceId === pending?.deviceId);
          if (
            pending &&
            ((pending.uncertain && explicit) ||
              (!pending.uncertain &&
                observed &&
                observed.desiredState === (pending.action === 'wake' ? 'running' : 'stopped') &&
                stableInstanceState(observed)))
          ) {
            powerRef.current = undefined;
            setPowerPending(undefined);
          }
        }
      } catch {
        if (live.current) setError('readFailed');
      } finally {
        inFlight.current = false;
      }
    },
    [api],
  );
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  useEffect(() => {
    const pending =
      !!powerPending || instances?.some((v) => v.loginRequired || !stableInstanceState(v));
    const timer = setInterval(
      () => {
        if (document.visibilityState !== 'hidden') void load();
      },
      pending ? 5_000 : 30_000,
    );
    const visible = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [instances, load, powerPending]);
  useEffect(() => {
    const completed = instances?.find(
      (v) => v.deviceId === openWhenReady.current && !v.loginRequired && v.ready,
    );
    if (completed) {
      openWhenReady.current = undefined;
      onOpen(completed.deviceId);
    }
  }, [instances, onOpen]);

  const initialize = async (deviceId: string) => {
    await api.instanceInitialize({ deviceId });
    if (live.current) {
      setWaiting(deviceId);
      openWhenReady.current = deviceId;
    }
  };
  const act = async (claim: boolean, deviceId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    let creating = claim;
    try {
      if (claim) {
        const next = await api.instanceClaim({});
        if (!live.current) return;
        setInstances(next);
        setUncertain(false);
        creating = false;
        if (next.length === 1 && next[0]!.loginRequired) await initialize(next[0]!.deviceId);
        else if (next.length === 1) openWhenReady.current = next[0]!.deviceId;
      } else if (deviceId) await initialize(deviceId);
    } catch {
      if (live.current) {
        setError(creating ? 'claimUnconfirmed' : 'loginFailed');
        if (creating) setUncertain(true);
      }
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  };
  const power = async (instance: CloudInstanceView, name: string) => {
    if (
      inFlight.current ||
      powerRef.current ||
      error ||
      instance.loginRequired ||
      !stableInstanceState(instance)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    const action = instance.desiredState === 'stopped' ? 'wake' : 'sleep';
    try {
      if (
        action === 'sleep' &&
        !(await confirm({
          presentation: 'standard',
          title: t('cloudSettings.instance.sleepTitle'),
          description: t('cloudSettings.instance.sleepBody', { name }),
          confirmText: t('cloudSettings.instance.sleep'),
        }))
      )
        return;
      if (!live.current) return;
      markPower({ deviceId: instance.deviceId, action, uncertain: false });
      await api.instancePower({ deviceId: instance.deviceId, action });
    } catch {
      if (live.current) markPower({ deviceId: instance.deviceId, action, uncertain: true });
    } finally {
      inFlight.current = false;
      if (live.current) {
        setBusy(false);
        await load();
      }
    }
  };
  return (
    <div
      className={embedded ? 'min-w-0' : 'flex h-full min-h-0 bg-[var(--settings-bg)]'}
      data-testid="cloud-instances-page"
    >
      <div className={embedded ? 'min-w-0' : 'min-w-0 flex-1 overflow-y-auto px-6 pb-8'}>
        <div className="mx-auto max-w-[920px]">
          {!embedded && onBack && (
            <div className="pt-5">
              <Button variant="secondary" tone="quiet" compact onClick={onBack}>
                <ArrowLeft size={14} aria-hidden />
                {t('settings.back')}
              </Button>
            </div>
          )}
          <header className="mb-6 flex flex-wrap items-center gap-3 border-b border-[var(--settings-theme-card-border)] py-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--settings-input-bg)] text-[var(--settings-section-title)]">
              <Cloud size={22} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-20 font-medium text-[var(--settings-section-title)]">
                {t('cloudSettings.instance.title')}
              </h2>
              <p className={description}>{tr(trial ? 'preview' : 'subtitle')}</p>
            </div>
            <Button
              variant="secondary"
              tone="quiet"
              compact
              disabled={busy}
              onClick={() => void load(true)}
              aria-label={t('cloudSettings.reload')}
            >
              <RefreshCw size={15} />
            </Button>
          </header>
          {error && (
            <p role="alert" className={`${description} mb-4`}>
              {tr(error)}
            </p>
          )}
          {instances === null && !error && (
            <div className="flex items-center gap-2 text-13" role="status">
              <Spinner size={16} />
              {tr('loading')}
            </div>
          )}
          {instances?.length === 0 && (
            <section className={`${card} flex flex-col items-start gap-4`}>
              <h3 className="text-16 font-medium text-[var(--settings-section-title)]">
                {tr('emptyTitle')}
              </h3>
              <p className={`${description} max-w-[560px]`}>{tr('emptyDescription')}</p>
              <Button disabled={busy || uncertain || !!error} onClick={() => void act(true)}>
                {busy ? <Spinner size={16} /> : <Cloud size={16} />}
                {tr(busy ? 'claiming' : 'claim')}
              </Button>
              {uncertain && (
                <Button
                  variant="secondary"
                  tone="quiet"
                  disabled={busy}
                  onClick={async () => {
                    await load();
                    if (live.current) setUncertain(false);
                  }}
                >
                  {tr('checkClaim')}
                </Button>
              )}
              <p className="text-12 leading-[1.5] text-[var(--settings-section-desc)]">
                {tr('defaults')}
              </p>
            </section>
          )}
          <div className="flex flex-col gap-4">
            {instances?.map((instance) => {
              const name = instance.name ?? tr('defaultName', { number: instance.nameSequence });
              const state = instanceStatus(instance);
              const pending =
                powerPending?.deviceId === instance.deviceId ? powerPending : undefined;
              return (
                <section key={instance.instanceId} className={card} aria-label={name}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <h3 className="break-all text-16 font-medium text-[var(--settings-section-title)]">
                        {name}
                      </h3>
                      <p role="status" className={`${description} mt-1 flex items-start gap-2`}>
                        {['starting', 'stopping', 'upgrading'].includes(state) ? (
                          <Spinner size={14} />
                        ) : state === 'running' ? (
                          <Check size={14} className="mt-1 shrink-0" />
                        ) : null}
                        <span>
                          {instance.loginRequired
                            ? tr('needsLogin')
                            : t(`cloudSettings.instance.state.${state}`)}
                        </span>
                      </p>
                    </div>
                    {instance.loginRequired ? (
                      <Button
                        disabled={busy || !!error}
                        onClick={() => void act(false, instance.deviceId)}
                      >
                        <ExternalLink size={15} />
                        {tr(waiting === instance.deviceId ? 'reopenLogin' : 'initialize')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        tone="quiet"
                        onClick={() => onOpen(instance.deviceId)}
                      >
                        {tr('openSettings')}
                        <ChevronRight size={15} />
                      </Button>
                    )}
                  </div>
                  {!instance.loginRequired && (
                    <>
                      <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-12 text-[var(--settings-section-desc)]">
                            {t('cloudSettings.instance.currentVersion')}
                          </dt>
                          <dd className="mt-1 break-all text-13 text-[var(--settings-section-title)]">
                            {instance.version ?? t('cloudSettings.instance.unknown')}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-12 text-[var(--settings-section-desc)]">
                            {t('cloudSettings.instance.availableVersion')}
                          </dt>
                          <dd className="mt-1 break-all text-13 text-[var(--settings-section-title)]">
                            {instance.updateAvailable
                              ? instance.latestVersion &&
                                instance.latestVersion !== instance.version
                                ? instance.latestVersion
                                : t('cloudSettings.instance.revisionAvailable')
                              : t(
                                  `cloudSettings.instance.${instance.manualUpgrade || instance.latestVersion ? 'noUpdate' : 'unknown'}`,
                                )}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--settings-theme-card-border)] pt-4">
                        {onOpenDesktop && (
                          <Button
                            variant="secondary"
                            compact
                            disabled={
                              busy ||
                              !!pending ||
                              !instance.ready ||
                              instance.desiredState !== 'running' ||
                              instance.upgradeState === 'verifying' ||
                              !!instance.upgradeOperation?.active ||
                              !canOpenDesktop?.(instance)
                            }
                            onClick={() => onOpenDesktop(instance)}
                          >
                            <Monitor size={14} />
                            {t('remoteDesktop.title')}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          tone="quiet"
                          compact
                          onClick={() => onOpen(instance.deviceId, 'maintenance')}
                        >
                          <CalendarClock size={14} />
                          {t('cloudSettings.instance.updates')}
                        </Button>
                        <Button
                          variant="secondary"
                          tone="quiet"
                          compact
                          disabled={
                            busy || !!powerPending || !!error || !stableInstanceState(instance)
                          }
                          onClick={() => void power(instance, name)}
                        >
                          {instance.desiredState === 'stopped' ? (
                            <Play size={14} />
                          ) : (
                            <Moon size={14} />
                          )}
                          {t(
                            `cloudSettings.instance.${instance.desiredState === 'stopped' ? 'wake' : 'sleep'}`,
                          )}
                        </Button>
                      </div>
                      {pending && (
                        <p
                          role={pending.uncertain ? 'alert' : 'status'}
                          className={`${description} mt-3`}
                        >
                          {t(
                            `cloudSettings.instance.${pending.uncertain ? 'unconfirmed' : pending.action === 'wake' ? 'wakeSent' : 'sleepSent'}`,
                          )}
                        </p>
                      )}
                    </>
                  )}
                  {instance.loginRequired && (
                    <p className={`${description} mt-4`}>
                      {tr(waiting === instance.deviceId ? 'waitingLogin' : 'loginDescription', {
                        name,
                      })}
                    </p>
                  )}
                  {(instance.loginRequired || state === 'starting') && (
                    <ol
                      className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--settings-theme-card-border)] pt-4 text-12 text-[var(--settings-section-desc)]"
                      aria-label={tr('progress')}
                    >
                      {['allocated', 'identity', 'start'].map((step, index) => (
                        <li
                          key={step}
                          className="flex items-center gap-1.5"
                          aria-current={
                            index === (instance.loginRequired ? 1 : 2) ? 'step' : undefined
                          }
                        >
                          {index < (instance.loginRequired ? 1 : 2) ? (
                            <Check size={13} />
                          ) : (
                            <span>{index + 1}.</span>
                          )}
                          {tr(step)}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
