import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProviderListEntry } from '@/components/settings/ProviderListEntry';
import { ProviderAccountHeader, ConnectedPill } from '@/components/settings/ProviderAccountHeader';
import { OAuthBrowserLink, OAuthDeviceCodeCard } from '@/components/settings/OAuthDeviceCodeCard';
import { SettingsTextInput } from '@/components/settings/SettingsTextInput';
import { ProviderLogoMark, hasProviderLogo } from '@/components/icons/ProviderLogoMark';
import type { ManagementItem } from '../../../shared/settingsManagement';

import {
  useCloudAuthorization,
  supportedActions,
  type CloudAuthorizationProps,
} from './useCloudAuthorization';
export function CloudProviderAuthorization(props: CloudAuthorizationProps) {
  const { name, online, trial = false } = props;
  const {
    t,
    items,
    selected,
    setSelected,
    loading,
    failure,
    setFailure,
    operation,
    operationItem,
    callback,
    setCallback,
    requesting,
    load,
    run,
    operate,
    prompt,
    open,
    busy,
  } = useCloudAuthorization(props, 'providers');
  const item = items.find((value) => value.id === selected);
  const ownsOperation = item?.id === operationItem;
  const buttonDisabled = !online || requesting || loading;
  const logo = (entry: ManagementItem, size = 18) => {
    const id = entry.id.replace(/^(provider:|add:)/, '');
    return hasProviderLogo(id) ? (
      <ProviderLogoMark providerId={id} size={size} />
    ) : (
      <span className="text-15 font-medium leading-none">{entry.label.slice(0, 1)}</span>
    );
  };
  return (
    <section
      className="flex min-h-0 flex-col gap-[14px]"
      aria-label={t('settings.providers.title')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
            {t('settings.providers.title')}
          </h2>
          <p className="text-13 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('cloudSettings.authScope', { name })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          disabled={buttonDisabled || busy}
          onClick={() => {
            setFailure(undefined);
            void load();
          }}
        >
          <RefreshCw size={14} />
          {t('cloudSettings.reload')}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-13 text-[var(--text-secondary)]">
          {t(`cloudSettings.${failure}`)}
        </p>
      )}
      {loading && !items.length && <p role="status">{t('cloudSettings.loading')}</p>}
      {!!items.length && (
        <div className="flex min-h-[340px] overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
          <div className="flex w-[224px] shrink-0 flex-col gap-0.5 border-r border-[var(--settings-theme-card-border)] p-2">
            {items.map((entry) => (
              <div
                key={entry.id}
                className={`relative flex w-full items-center rounded-lg text-left transition-colors ${entry.id === selected ? 'bg-[var(--settings-menu-bg-selected)]' : 'hover:bg-[var(--settings-menu-bg-hover)]'}`}
              >
                <ProviderListEntry
                  selected={entry.id === selected}
                  title={
                    entry.id.startsWith('add:')
                      ? t('cloudSettings.authAdd', { provider: entry.label })
                      : entry.label
                  }
                  icon={entry.id.startsWith('add:') ? <Plus size={14} /> : logo(entry, 14)}
                  disabled={busy && entry.id !== operationItem}
                  onSelect={() => {
                    setSelected(entry.id);
                    setFailure(undefined);
                  }}
                  statusColor={
                    entry.status === 'connected'
                      ? 'var(--remote-status-ready)'
                      : 'var(--border-default)'
                  }
                />
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {item && (
              <>
                <ProviderAccountHeader
                  icon={logo(item)}
                  title={item.label}
                  subtitle={name}
                  actions={
                    <>
                      {item.status === 'connected' && <ConnectedPill />}
                      {ownsOperation && busy ? (
                        <Button
                          variant="secondary"
                          size="md"
                          disabled={buttonDisabled}
                          onClick={() => void operate('cancel')}
                        >
                          {t('settings.providers.button.cancel')}
                        </Button>
                      ) : (
                        supportedActions(item).map((action) => (
                          <Button
                            key={action.id}
                            variant="secondary"
                            size="md"
                            disabled={
                              buttonDisabled ||
                              busy ||
                              (ownsOperation && operation?.phase === 'unknown')
                            }
                            onClick={() => void run(item, action)}
                          >
                            {t(
                              action.intent === 'disconnect'
                                ? 'settings.providers.button.disconnect'
                                : 'settings.providers.button.authorize',
                            )}
                          </Button>
                        ))
                      )}
                    </>
                  }
                />
                <div className="flex flex-col gap-3 px-5 pb-4">
                  {ownsOperation && operation && (
                    <p role="status" className="text-13 text-[var(--text-secondary)]">
                      {t(`cloudSettings.authPhase.${operation.phase}`)}
                    </p>
                  )}
                  {ownsOperation && prompt && (
                    <>
                      {prompt.kind === 'device' && prompt.userCode ? (
                        <OAuthDeviceCodeCard
                          deviceCode={{
                            verificationUrl: prompt.url,
                            userCode: prompt.userCode,
                            expiresAt: prompt.expiresAt,
                          }}
                          onOpen={open}
                        />
                      ) : (
                        <OAuthBrowserLink url={prompt.url} onOpen={open} />
                      )}
                      {prompt.kind === 'callback' && (
                        <form
                          className="flex flex-col gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (callback.trim()) void operate('respond');
                          }}
                        >
                          <label
                            className="text-13 text-[var(--text-secondary)]"
                            htmlFor="cloud-auth-callback"
                          >
                            {t('cloudSettings.authCallback')}
                          </label>
                          <SettingsTextInput
                            id="cloud-auth-callback"
                            type="password"
                            autoComplete="off"
                            value={callback}
                            onChange={setCallback}
                            disabled={buttonDisabled}
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="md"
                            disabled={buttonDisabled || !callback.trim()}
                          >
                            {t('cloudSettings.authContinue')}
                          </Button>
                        </form>
                      )}
                    </>
                  )}
                  {ownsOperation && operation?.phase === 'unknown' && (
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={buttonDisabled}
                        onClick={() => void operate('status')}
                      >
                        {t('cloudSettings.authCheck')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={buttonDisabled}
                        onClick={() => void operate('cancel')}
                      >
                        {t('settings.providers.button.cancel')}
                      </Button>
                    </div>
                  )}
                  {ownsOperation && trial && prompt && (
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        void operate('respond');
                      }}
                    >
                      {t('cloudSettings.authTrialComplete')}
                    </Button>
                  )}
                  {trial && (
                    <p className="text-12 text-[var(--text-tertiary)]">
                      {t('cloudSettings.authTrial')}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {!loading && !failure && !items.length && (
        <p className="text-13 text-[var(--text-secondary)]">{t('cloudSettings.noFields')}</p>
      )}
    </section>
  );
}
