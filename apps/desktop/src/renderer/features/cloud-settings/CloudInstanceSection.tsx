import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Play, RefreshCw, Plus, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import {
  cloudMaintenanceEditSchema,
  type CloudInstanceView,
  type CloudMaintenanceView,
  type CloudMaintenanceCalendar,
} from '../../../shared/cloudInstanceControl';
import type { CloudSettingsClient } from './client';
import { CloudTimezoneSelect } from './CloudTimezoneSelect';
import { stableInstanceState as stableState, instanceStatus } from './instanceState';

const card =
  'flex flex-col gap-4 rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5';
const label = 'text-13 font-medium text-[var(--settings-section-sublabel)]';
const description = 'text-12 leading-[1.5] text-[var(--settings-section-desc)]';
function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className={label}>{title}</p>
        {detail && <p className={`${description} mt-1`}>{detail}</p>}
      </div>
      <div className="flex max-w-full shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
type Draft = {
  autoUpdate: boolean;
  mode: 'inherit' | 'custom';
  calendar: CloudMaintenanceCalendar;
  base: CloudMaintenanceView;
};
const fromPolicy = (base: CloudMaintenanceView): Draft => ({
  base,
  autoUpdate: base.autoUpdate,
  mode: base.raw.policyMode,
  calendar: structuredClone(base.raw.calendar ?? base.effective.calendar),
});

/** Lifecycle and policy use the CIS control plane, including while the Host sleeps. */
export function CloudInstanceSection({
  client,
  name,
  active,
  changed,
  focusMaintenance = false,
}: {
  client: CloudSettingsClient;
  name: string;
  active: boolean;
  changed(domain: string, dirty: boolean): void;
  focusMaintenance?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [view, setView] = useState<CloudInstanceView>();
  const maintenanceTarget = useRef<HTMLElement>(null);
  const locatedMaintenance = useRef(false);
  useEffect(() => {
    if (focusMaintenance && active && view && !locatedMaintenance.current) {
      maintenanceTarget.current?.scrollIntoView?.({ block: 'start' });
      locatedMaintenance.current = true;
    }
  }, [focusMaintenance, active, !!view]);
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const alive = useRef(true),
    inFlight = useRef(false),
    dirty = useRef(false),
    uncertain = useRef(false);
  const blocked = useRef(false);
  const tr = (key: string) => t(`cloudSettings.instance.${key}`);
  const mark = useCallback(
    (value: boolean) => {
      dirty.current = value;
      changed('instance', value);
    },
    [changed],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(
    async (explicit = false) => {
      if (inFlight.current || !client.instance) return;
      if (!explicit && uncertain.current) return;
      inFlight.current = true;
      if (explicit) setBusy(true);
      try {
        const next = await client.instance();
        if (!alive.current) return;
        setView(next);
        blocked.current = false;
        if (!dirty.current) setDraft(next.maintenance ? fromPolicy(next.maintenance) : undefined);
        if (explicit) {
          uncertain.current = false;
          setError(undefined);
        }
      } catch {
        if (alive.current) {
          blocked.current = true;
          setError('readFailed');
        }
      } finally {
        inFlight.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [client],
  );
  useEffect(() => {
    if (!active) return;
    void refresh(true);
    const poll = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    const timer = setInterval(poll, view && !stableState(view) ? 5000 : 30000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [active, client, refresh, view ? stableState(view) : true]);
  const update = (patch: Partial<Draft>) => {
    setDraft((before) => before && { ...before, ...patch });
    mark(true);
    setMessage(undefined);
  };
  const reload = async () => {
    if (inFlight.current) return;
    if (
      dirty.current &&
      !(await confirm({
        presentation: 'standard',
        title: t('cloudSettings.discardTitle'),
        description: t('cloudSettings.discardBody'),
        confirmText: t('cloudSettings.discard'),
      }))
    )
      return;
    if (!alive.current) return;
    mark(false);
    setMessage(undefined);
    await refresh(true);
  };
  const power = async () => {
    if (inFlight.current || blocked.current || uncertain.current || !view || !client.power) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(undefined);
    const action = view.desiredState === 'stopped' ? 'wake' : 'sleep';
    try {
      if (
        action === 'sleep' &&
        !(await confirm({
          presentation: 'standard',
          title: tr('sleepTitle'),
          description: t('cloudSettings.instance.sleepBody', { name: view.name || name }),
          confirmText: tr('sleep'),
        }))
      )
        return;
      if (!alive.current) return;
      await client.power(action);
      if (alive.current) setMessage(action === 'wake' ? 'wakeSent' : 'sleepSent');
    } catch {
      if (alive.current) {
        uncertain.current = true;
        setError('unconfirmed');
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setBusy(false);
        await refresh();
      }
    }
  };
  const save = async () => {
    if (inFlight.current || blocked.current || uncertain.current || !draft || !client.maintenance)
      return;
    const parsed = cloudMaintenanceEditSchema.safeParse({
      revision: draft.base.revision,
      defaultsRevision: draft.base.defaultsRevision,
      autoUpdate: draft.autoUpdate,
      policyMode: draft.mode,
      ...(draft.mode === 'custom' ? { calendar: draft.calendar } : {}),
    });
    if (!parsed.success) {
      setError('invalidCalendar');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const saved = await client.maintenance(parsed.data);
      if (!alive.current) return;
      mark(false);
      setDraft(fromPolicy(saved));
      setView((before) => before && { ...before, maintenance: saved });
      setMessage('saved');
    } catch (cause) {
      if (alive.current) {
        uncertain.current = true;
        setError(
          cause instanceof Error && cause.message === 'CLOUD_SETTINGS_CONFLICT'
            ? 'conflict'
            : 'unconfirmed',
        );
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const date = (ms: number, timezone?: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(ms);
  const weekdays = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    text: new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + index)),
    ),
  }));
  const policy = view?.maintenance;
  const disabled = busy || (!!error && ['readFailed', 'unconfirmed', 'conflict'].includes(error));
  const status = view ? instanceStatus(view) : 'starting';
  return (
    <div className="flex flex-col gap-6" data-testid="cloud-instance-overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-16 font-medium text-[var(--settings-section-title)]">{tr('title')}</h2>
        <Button
          variant="secondary"
          tone="quiet"
          compact
          disabled={busy}
          onClick={() => void reload()}
        >
          <RefreshCw size={14} />
          {tr('refresh')}
        </Button>
      </div>
      {error && (
        <p role="alert" className={description}>
          {tr(error)}
        </p>
      )}
      {message && (
        <p role="status" className={description}>
          {tr(message)}
        </p>
      )}
      {!view ? (
        <p className={description} role="status">
          {t(error ? 'cloudSettings.targetUnavailable' : 'cloudSettings.loading')}
        </p>
      ) : (
        <>
          <div className={card}>
            <Row title={view.name || name} detail={tr(`state.${status}`)}>
              <Button
                variant="secondary"
                disabled={disabled || !stableState(view)}
                onClick={() => void power()}
              >
                {view.desiredState === 'stopped' ? <Play size={14} /> : <Moon size={14} />}
                {tr(view.desiredState === 'stopped' ? 'wake' : 'sleep')}
              </Button>
            </Row>
            <Row title={tr('currentVersion')} detail={tr('versionSource')}>
              <span className="break-all text-13 text-[var(--settings-section-title)]">
                {view.version ?? (view.imageId ? `#${view.imageId.slice(0, 12)}` : tr('unknown'))}
              </span>
            </Row>
            <Row title={tr('availableVersion')}>
              <span className="break-all text-13 text-[var(--settings-section-desc)]">
                {view.updateAvailable
                  ? view.latestVersion && view.latestVersion !== view.version
                    ? view.latestVersion
                    : tr('revisionAvailable')
                  : tr(view.latestVersion ? 'noUpdate' : 'unknown')}
              </span>
            </Row>
          </div>
          <section
            ref={maintenanceTarget}
            id="cloud-instance-maintenance"
            className="flex flex-col gap-[14px]"
          >
            <h2 className="text-16 font-medium text-[var(--settings-section-title)]">
              {tr('updates')}
            </h2>
            {!policy || !draft ? (
              <p className={description}>{tr('unavailable')}</p>
            ) : (
              <div className={card}>
                <Row title={tr('autoUpdate')} detail={tr('autoDescription')}>
                  <Switch
                    aria-label={tr('autoUpdate')}
                    checked={draft.autoUpdate}
                    disabled={disabled || policy.raw.scheduledTaskPolicy !== 'protect'}
                    onCheckedChange={(autoUpdate) => update({ autoUpdate })}
                  />
                </Row>
                <Row title={tr('schedule')}>
                  <Select
                    label={tr('schedule')}
                    className="w-48"
                    value={draft.mode}
                    disabled={disabled}
                    options={[
                      { value: 'inherit', label: tr('inherit') },
                      { value: 'custom', label: tr('custom') },
                    ]}
                    onValueChange={(mode) => update({ mode: mode as 'inherit' | 'custom' })}
                  />
                </Row>
                {draft.mode === 'inherit' ? (
                  <div className={description}>
                    <p>
                      {policy.effective.source === 'inherit'
                        ? policy.effective.calendar.timezone
                        : tr('inheritOnSave')}
                    </p>
                    {policy.effective.source === 'inherit' &&
                      policy.effective.calendar.windows.map((rule) => (
                        <p key={rule.id}>
                          {weekdays
                            .filter((d) => rule.weekdays.includes(d.day))
                            .map((d) => d.text)
                            .join(' · ')}{' '}
                          {rule.startLocal}–{rule.endLocal}
                        </p>
                      ))}
                  </div>
                ) : (
                  <details open className="flex flex-col gap-3">
                    <summary className={`${label} cursor-pointer`}>{tr('editSchedule')}</summary>
                    <div className="mt-3 flex flex-col gap-4">
                      <div className={`${description} flex max-w-full flex-col gap-2 sm:w-[360px]`}>
                        {tr('timezone')}
                        <CloudTimezoneSelect
                          value={draft.calendar.timezone}
                          disabled={disabled}
                          onChange={(timezone) =>
                            update({ calendar: { ...draft.calendar, timezone } })
                          }
                        />
                      </div>
                      {draft.calendar.windows.map((rule, index) => {
                        const updateRule = (patch: Partial<typeof rule>) =>
                          update({
                            calendar: {
                              ...draft.calendar,
                              windows: draft.calendar.windows.map((item, n) =>
                                n === index ? { ...item, ...patch } : item,
                              ),
                            },
                          });
                        return (
                          <fieldset
                            key={rule.id}
                            disabled={disabled}
                            className="flex min-w-0 flex-col gap-3 border-0 p-0"
                          >
                            <legend className={`${description} mb-2`}>
                              {t('cloudSettings.instance.window', { number: index + 1 })}
                            </legend>
                            <div className="flex flex-wrap gap-2">
                              {weekdays.map((day) => (
                                <Button
                                  key={day.day}
                                  variant={
                                    rule.weekdays.includes(day.day) ? 'primary' : 'secondary'
                                  }
                                  compact
                                  aria-pressed={rule.weekdays.includes(day.day)}
                                  disabled={disabled}
                                  onClick={() =>
                                    updateRule({
                                      weekdays: rule.weekdays.includes(day.day)
                                        ? rule.weekdays.filter((d) => d !== day.day)
                                        : [...rule.weekdays, day.day].sort(),
                                    })
                                  }
                                >
                                  {rule.weekdays.includes(day.day) && (
                                    <Check size={12} aria-hidden />
                                  )}
                                  {day.text}
                                </Button>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-end gap-3">
                              <label className={`${description} flex flex-col gap-1`}>
                                {tr('start')}
                                <Input
                                  type="time"
                                  value={rule.startLocal}
                                  onChange={(startLocal) => updateRule({ startLocal })}
                                />
                              </label>
                              <label className={`${description} flex flex-col gap-1`}>
                                {tr('end')}
                                <Input
                                  type="time"
                                  value={rule.endLocal}
                                  onChange={(endLocal) => updateRule({ endLocal })}
                                />
                              </label>
                              {draft.calendar.windows.length > 1 && (
                                <Button
                                  variant="secondary"
                                  tone="quiet"
                                  compact
                                  aria-label={t('cloudSettings.instance.removeWindow', {
                                    number: index + 1,
                                  })}
                                  onClick={() =>
                                    update({
                                      calendar: {
                                        ...draft.calendar,
                                        windows: draft.calendar.windows.filter(
                                          (_, n) => n !== index,
                                        ),
                                      },
                                    })
                                  }
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </div>
                          </fieldset>
                        );
                      })}
                      {draft.calendar.windows.length < 7 && (
                        <div>
                          <Button
                            variant="secondary"
                            tone="quiet"
                            compact
                            disabled={disabled}
                            onClick={() =>
                              update({
                                calendar: {
                                  ...draft.calendar,
                                  windows: [
                                    ...draft.calendar.windows,
                                    {
                                      id: crypto.randomUUID(),
                                      weekdays: [],
                                      startLocal: '03:00',
                                      endLocal: '05:00',
                                    },
                                  ],
                                },
                              })
                            }
                          >
                            <Plus size={14} />
                            {tr('addWindow')}
                          </Button>
                        </div>
                      )}
                      <p className={description}>{tr('calendarHelp')}</p>
                    </div>
                  </details>
                )}
                {policy.executionMode === 'preview-only' && (
                  <p className={description}>{tr('notEnrolled')}</p>
                )}
                {policy.raw.pausedUntilMs && policy.raw.pausedUntilMs > policy.serverTimeMs ? (
                  <p className={description}>
                    {t('cloudSettings.instance.paused', {
                      time: date(policy.raw.pausedUntilMs, policy.effective.calendar.timezone),
                    })}
                  </p>
                ) : null}
                {policy.autoUpdate &&
                  policy.executionMode === 'scheduled' &&
                  policy.nextEligibleAtMs && (
                    <p className={description}>
                      {t('cloudSettings.instance.nextWindow', {
                        time: date(policy.nextEligibleAtMs, policy.effective.calendar.timezone),
                        timezone: policy.effective.calendar.timezone,
                      })}
                    </p>
                  )}
                {policy.raw.scheduledTaskPolicy !== 'protect' && (
                  <p className={description}>{tr('unsupportedPolicy')}</p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    tone="quiet"
                    compact
                    disabled={!dirty.current || busy}
                    onClick={() => {
                      setDraft(fromPolicy(policy));
                      mark(false);
                      if (!uncertain.current) setError(undefined);
                    }}
                  >
                    {tr('discard')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      !dirty.current || disabled || policy.raw.scheduledTaskPolicy !== 'protect'
                    }
                    onClick={() => void save()}
                  >
                    {tr('save')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
