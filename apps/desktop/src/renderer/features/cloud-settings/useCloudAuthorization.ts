import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import type { ManagementItem, ManagementResult } from '../../../shared/settingsManagement';
import type { CloudSettingsClient } from './client';
type Operation = Extract<ManagementResult, { kind: 'operation' }>;
type Action = ManagementItem['actions'][number];
const activeOperation = (op?: Operation) => !!op && ['running', 'waiting'].includes(op.phase);
export const supportedActions = (item: ManagementItem) =>
  item.actions.filter(
    (a) => ['authorize', 'disconnect'].includes(a.intent) && a.fields.length === 0,
  );

export interface CloudAuthorizationProps {
  client: CloudSettingsClient;
  online: boolean;
  active: boolean;
  name: string;
  trial?: boolean;
  refresh?: number;
}
export function useCloudAuthorization(
  { client, online, active, name, trial = false, refresh = 0 }: CloudAuthorizationProps,
  section: 'providers' | 'bots',
) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [items, setItems] = useState<ManagementItem[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [operation, setOperation] = useState<Operation>();
  const [operationItem, setOperationItem] = useState<string>();
  const [callback, setCallback] = useState('');
  const [requesting, setRequesting] = useState(false);
  const scope = useRef({ client, online });
  scope.current = { client, online };
  const alive = useRef(true);
  const pending = useRef(false);
  const sequence = useRef(0);
  const operationVersion = useRef(0);
  const opened = useRef(new Set<string>());
  const operationRef = useRef(operation);
  operationRef.current = operation;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [client]);
  const current = () => alive.current && scope.current.client === client && scope.current.online;
  const accept = (result: ManagementResult, id: string) => {
    if (result.kind !== 'operation' || result.operationId !== id) throw new Error('SCOPE_CHANGED');
    if (current()) {
      operationRef.current = result;
      setOperation(result);
    }
    return result;
  };
  const load = async () => {
    if (!current() || !client.manage) return;
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const values: ManagementItem[] = [];
      let offset = 0;
      // Bounded pagination; never render a partial provider list as complete.
      for (let page = 0; page < 128; page++) {
        const result = await client.manage({ operation: 'list', section, offset });
        if (!current() || sequence.current !== seq) return;
        if (result.kind !== 'page' || result.section !== section || (result.offset ?? 0) !== offset)
          throw new Error('INVALID_PAGE');
        values.push(...result.items);
        if (result.nextOffset === undefined) {
          const visible = values.filter((item) => supportedActions(item).length);
          if (new Set(visible.map((item) => item.id)).size !== visible.length)
            throw new Error('INVALID_PAGE');
          setItems(visible);
          setSelected((old) => (visible.some((item) => item.id === old) ? old : visible[0]?.id));
          return;
        }
        if (result.nextOffset <= offset) throw new Error('INVALID_PAGE');
        offset = result.nextOffset;
      }
      throw new Error('TOO_MANY_PAGES');
    } catch {
      if (current() && sequence.current === seq) setFailure('readFailed');
    } finally {
      if (current() && sequence.current === seq) setLoading(false);
    }
  };
  useEffect(() => {
    if (active && online && !activeOperation(operationRef.current)) void load();
  }, [client, online, active, refresh]);
  useEffect(() => {
    if (!online) {
      sequence.current++;
      setCallback('');
    }
  }, [online]);
  useEffect(() => {
    setCallback('');
  }, [selected, operation?.operationId, operation?.phase]);
  const run = async (item: ManagementItem, action: Action) => {
    if (!current() || pending.current || activeOperation(operationRef.current) || !client.manage)
      return;
    if (action.expiresAt <= Date.now()) {
      setFailure('authExpired');
      void load();
      return;
    }
    // Lock before a confirmation dialog to prevent double clicks opening parallel requests.
    pending.current = true;
    setRequesting(true);
    try {
      if (
        action.intent === 'disconnect' &&
        !(await confirm({
          title: t('settings.providers.button.disconnect'),
          description: t('cloudSettings.authDisconnect', { name, provider: item.label }),
          confirmText: t('settings.providers.button.disconnect'),
        }))
      )
        return;
      if (!current()) return;
      const operationId = crypto.randomUUID();
      operationVersion.current++;
      setOperationItem(item.id);
      operationRef.current = { kind: 'operation', operationId, phase: 'running' };
      setOperation(operationRef.current);
      setFailure(undefined);
      try {
        accept(
          await client.manage({ operation: 'run', actionId: action.id, operationId, values: {} }),
          operationId,
        );
      } catch {
        if (current()) {
          // Keep the operation ID: checking its status is safe, rerunning login is not.
          setOperation({ kind: 'operation', operationId, phase: 'unknown' });
          setFailure('authUnknown');
        }
      }
    } finally {
      pending.current = false;
      if (alive.current) setRequesting(false);
    }
  };
  const operate = async (kind: 'status' | 'cancel' | 'respond') => {
    if (!current() || pending.current || !operation || !client.manage) return;
    pending.current = true;
    setRequesting(true);
    setFailure(undefined);
    operationVersion.current++;
    const id = operation.operationId;
    const value = callback.trim();
    if (kind !== 'status') setCallback('');
    try {
      const result = await client.manage(
        kind === 'respond'
          ? { operation: kind, operationId: id, value }
          : { operation: kind, operationId: id },
      );
      accept(result, id);
      if (kind === 'cancel' && current()) {
        setFailure('authCancelled');
        setOperation(undefined);
      }
      if (current() && !activeOperation(result as Operation)) await load();
    } catch {
      if (current()) setFailure(kind === 'respond' ? 'authResponseFailed' : 'authUnknown');
    } finally {
      pending.current = false;
      if (alive.current) setRequesting(false);
    }
  };
  useEffect(() => {
    if (!online || !activeOperation(operation) || !client.manage) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = operationVersion.current;
      try {
        const result = await client.manage!({
          operation: 'status',
          operationId: operation!.operationId,
        });
        if (cancelled || !current()) return;
        if (version !== operationVersion.current) {
          timer = setTimeout(() => void poll(), 1500);
          return;
        }
        const next = accept(result, operation!.operationId);
        if (!activeOperation(next)) {
          await load();
          return;
        }
      } catch {
        if (!cancelled && current() && version === operationVersion.current) {
          setOperation({
            kind: 'operation',
            operationId: operation!.operationId,
            phase: 'unknown',
          });
          setFailure('authUnknown');
        }
        return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, online, operation?.operationId, operation?.phase]);
  const prompt =
    online &&
    activeOperation(operation) &&
    operation?.prompt &&
    operation.prompt.expiresAt > Date.now()
      ? operation.prompt
      : undefined;
  const open = async (url: string) => {
    if (!current() || !prompt || url !== prompt.url || prompt.expiresAt <= Date.now())
      throw new Error('EXPIRED');
    if (trial) return; // Trial never opens or logs in to an actual third-party account.
    const result = await window.electronAPI.openExternal(url);
    if (!result.success) throw new Error('OPEN_FAILED');
  };
  useEffect(() => {
    if (!active || !prompt || !operation || trial || !current()) return;
    const key = `${operation.operationId}:${prompt.url}`;
    if (opened.current.has(key)) return;
    opened.current.add(key);
    void open(prompt.url).catch(() => {
      if (current()) setFailure('authOpenFailed');
    });
  }, [active, prompt?.url, operation?.operationId, online]);
  return {
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
    busy: activeOperation(operation),
  };
}
