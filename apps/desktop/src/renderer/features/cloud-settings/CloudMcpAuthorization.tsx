import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { SettingsTextInput } from '@/components/settings/SettingsTextInput';
import { McpTokenField } from '@/components/settings/McpTokenField';
import { McpRow } from '@/components/settings/McpServersSection';
import type { ManagementItem, ManagementResult } from '../../../shared/settingsManagement';
import type { CloudAuthorizationProps } from './useCloudAuthorization';

type Action = ManagementItem['actions'][number];
type Operation = Extract<ManagementResult, { kind: 'operation' }>;
const getAction = (item: ManagementItem, label: string) =>
  item.actions.find((a) => a.label === label);

/** Native MCP presentation. Stored credential values never leave the Host. */
export function CloudMcpAuthorization({
  client,
  active,
  online,
  name,
  trial,
  refresh,
}: CloudAuthorizationProps) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [items, setItems] = useState<ManagementItem[]>([]);
  const [selected, setSelected] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<Operation>();
  const operationRef = useRef<Operation | undefined>(undefined);
  const publish = (next: Operation) => {
    operationRef.current = next;
    setOperation(next);
  };
  const [pending, setPending] = useState(false);
  const locked = useRef(false),
    seq = useRef(0),
    alive = useRef(true);
  const scope = useRef({ client, online });
  scope.current = { client, online };
  const current = () => alive.current && scope.current.client === client && scope.current.online;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
    };
  }, [client]);
  const load = async () => {
    if (!current() || !client.manage) return;
    const version = ++seq.current;
    setLoading(true);
    try {
      const all: ManagementItem[] = [];
      let offset = 0;
      for (let n = 0; n < 128; n++) {
        const page = await client.manage({ operation: 'list', section: 'mcp', offset });
        if (!current() || version !== seq.current) return;
        if (page.kind !== 'page' || page.section !== 'mcp' || (page.offset ?? 0) !== offset)
          throw Error('INVALID_PAGE');
        all.push(...page.items.filter((item) => !!getAction(item, 'management.setToken')));
        if (page.nextOffset === undefined) {
          if (new Set(all.map((i) => i.id)).size !== all.length) throw Error('INVALID_PAGE');
          setItems(all);
          setFailure(undefined);
          return;
        }
        if (page.nextOffset <= offset) throw Error('INVALID_PAGE');
        offset = page.nextOffset;
      }
      throw Error('INVALID_PAGE');
    } catch {
      if (current() && version === seq.current) setFailure('readFailed');
    } finally {
      if (current() && version === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (active && online && !locked.current) void load();
  }, [client, active, online, refresh]);
  useEffect(() => {
    if (!active || !online) setSelected(undefined);
  }, [active, online]);
  const accept = (result: ManagementResult, id: string) => {
    if (result.kind !== 'operation' || result.operationId !== id) throw Error('SCOPE_CHANGED');
    if (current() && operationRef.current?.operationId === id) publish(result);
    return result;
  };
  const run = async (item: ManagementItem, action: Action, values: Record<string, string>) => {
    if (!current() || locked.current || !client.manage) return;
    locked.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      if (
        action.confirmation &&
        !(await confirm({
          presentation: 'standard',
          title: t('cloudSettings.mcpRemove'),
          description: t('cloudSettings.authScope', { name }),
          confirmText: t('common.confirm'),
          cancelText: t('settings.mcp.cancel'),
        }))
      )
        return;
      if (!current()) return;
      const id = crypto.randomUUID();
      publish({ kind: 'operation', operationId: id, phase: 'running' });
      try {
        accept(
          await client.manage({ operation: 'run', actionId: action.id, operationId: id, values }),
          id,
        );
      } catch {
        if (current()) {
          publish({ kind: 'operation', operationId: id, phase: 'unknown' });
          setFailure('authUnknown');
        }
      }
    } finally {
      // Only newly entered values exist here. No credentials are persisted in the controller.
      values = {};
      locked.current = false;
      if (current()) setPending(false);
    }
  };
  const running = operation && ['running', 'waiting'].includes(operation.phase);
  const check = async () => {
    if (!current() || !operation || !client.manage) return;
    try {
      accept(
        await client.manage({ operation: 'status', operationId: operation.operationId }),
        operation.operationId,
      );
    } catch {
      if (current()) setFailure('authUnknown');
    }
  };
  useEffect(() => {
    if (!online || !operation) return;
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(operation.phase)) {
      void load();
      return;
    }
    if (!running) return;
    const timer = setTimeout(() => void check(), 800);
    return () => clearTimeout(timer);
  }, [client, online, operation]);
  const busy = pending || !!running || operation?.phase === 'unknown';
  return (
    <section className="mt-6 flex flex-col gap-[14px]" aria-label={t('settings.mcp.title')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
            {t('settings.mcp.title')}
          </h2>
          <p className="text-13 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('settings.mcp.subtitle')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          disabled={!online || loading || busy}
          onClick={() => void load()}
        >
          {t('cloudSettings.reload')}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-13 text-[var(--text-secondary)]">
          {t(`cloudSettings.${failure}`)}
        </p>
      )}
      {operation && (
        <div className="flex items-center gap-2 text-13 text-[var(--text-secondary)]" role="status">
          {t(`cloudSettings.authPhase.${operation.phase}`)}
          {operation.phase === 'unknown' && (
            <Button variant="secondary" size="md" disabled={!online} onClick={() => void check()}>
              {t('cloudSettings.authCheck')}
            </Button>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
        {items.map((item, i) => {
          const edit = getAction(item, 'management.actions.edit');
          const field = (key: string) => edit?.fields.find((f) => f.name === key)?.value;
          return (
            <div
              key={item.id}
              className={i ? 'border-t border-[var(--settings-theme-card-border)]' : ''}
            >
              <McpRow
                config={{
                  id: item.id,
                  name: item.label,
                  url: field('url') || t('cloudSettings.mcpPrivateEndpoint'),
                  transport: field('transport') === 'sse' ? 'sse' : 'http',
                  headers: {},
                }}
                actions={
                  <Button
                    variant="secondary"
                    size="md"
                    aria-expanded={selected === item.id}
                    disabled={!online}
                    onClick={() => setSelected(selected === item.id ? undefined : item.id)}
                  >
                    {t('cloudSettings.mcpCredentials')}
                    {selected === item.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </Button>
                }
              />
              {selected === item.id && online && (
                <McpCredentials key={item.id} item={item} busy={busy || loading} run={run} />
              )}
            </div>
          );
        })}
        {!items.length && (
          <p className="px-5 py-4 text-13 text-[var(--text-secondary)]">
            {t(loading ? 'cloudSettings.loading' : 'cloudSettings.noFields')}
          </p>
        )}
      </div>
      <p className="text-12 text-[var(--text-tertiary)]">{t('cloudSettings.mcpScope', { name })}</p>
      {trial && (
        <p className="text-12 text-[var(--text-tertiary)]">{t('cloudSettings.authTrial')}</p>
      )}
    </section>
  );
}

function McpCredentials({
  item,
  busy,
  run,
}: {
  item: ManagementItem;
  busy: boolean;
  run(item: ManagementItem, action: Action, values: Record<string, string>): Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [token, setToken] = useState(''),
    [headerName, setHeaderName] = useState(''),
    [headerValue, setHeaderValue] = useState('');
  const saveToken = getAction(item, 'management.setToken'),
    removeToken = getAction(item, 'management.removeToken');
  const saveHeader = getAction(item, 'management.setHeader'),
    removeHeader = getAction(item, 'management.removeHeader');
  const submit = (action: Action, values: Record<string, string>) => {
    setToken('');
    setHeaderValue('');
    void run(item, action, values);
  };
  return (
    <fieldset
      disabled={busy}
      className="mx-5 mb-5 flex min-w-0 flex-col gap-4 rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--surface)] p-4"
    >
      <McpTokenField
        id={`${id}-token`}
        value={token}
        onChange={setToken}
        hasToken={!!removeToken}
        placeholder={t('settings.mcp.fields.tokenPlaceholder')}
        hint={t('cloudSettings.mcpSecretHint')}
      />
      <div className="flex flex-wrap gap-2">
        {saveToken && (
          <Button
            variant="primary"
            size="md"
            disabled={busy || !token.trim()}
            onClick={() => submit(saveToken, { bearerToken: token })}
          >
            {t('settings.mcp.save')}
          </Button>
        )}
        {removeToken && (
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => submit(removeToken, {})}
          >
            {t('cloudSettings.mcpRemoveToken')}
          </Button>
        )}
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-13 font-medium text-[var(--settings-section-title)]">
          {t('settings.mcp.fields.headers')}
        </legend>
        {removeHeader?.fields
          .find((f) => f.name === 'headerName')
          ?.options?.map((header) => (
            <div
              key={header.value}
              className="flex items-center justify-between gap-2 text-13 text-[var(--text-secondary)]"
            >
              <span className="min-w-0 break-all">{header.label}</span>
              <Button
                variant="secondary"
                size="md"
                aria-label={`${t('settings.mcp.fields.removeRow')} ${header.label}`}
                disabled={busy}
                onClick={() => submit(removeHeader, { headerName: header.value })}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        <div className="flex min-w-0 flex-wrap gap-2">
          <FormField
            id={`${id}-header-name`}
            label={t('settings.mcp.fields.headerNamePlaceholder')}
            className="min-w-0 flex-1"
          >
            {(control) => (
              <SettingsTextInput
                {...control}
                surface="ivory"
                value={headerName}
                onChange={setHeaderName}
                placeholder={t('settings.mcp.fields.headerNamePlaceholder')}
              />
            )}
          </FormField>
          <FormField
            id={`${id}-header-value`}
            label={t('settings.mcp.fields.headerValuePlaceholder')}
            className="min-w-0 flex-1"
          >
            {(control) => (
              <SettingsTextInput
                {...control}
                surface="ivory"
                value={headerValue}
                onChange={setHeaderValue}
                placeholder={t('settings.mcp.fields.headerValuePlaceholder')}
                secret
              />
            )}
          </FormField>
        </div>
        {saveHeader && (
          <Button
            variant="secondary"
            size="md"
            className="self-start"
            disabled={busy || !headerName.trim() || !headerValue.trim()}
            onClick={() => submit(saveHeader, { headerName, headerValue })}
          >
            {t('settings.mcp.save')}
          </Button>
        )}
      </fieldset>
    </fieldset>
  );
}
