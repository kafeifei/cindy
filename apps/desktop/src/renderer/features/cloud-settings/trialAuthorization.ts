import type {
  ManagementCommand,
  ManagementItem,
  ManagementResult,
} from '../../../shared/settingsManagement';

/** DEV-only in-memory authorization. No external URLs or provider IPC are invoked. */
export function createTrialAuthorization() {
  const definitions = [
    { section: 'providers', id: 'openai', label: 'OpenAI', kind: 'device' as const },
    { section: 'providers', id: 'anthropic', label: 'Claude', kind: 'callback' as const },
    { section: 'providers', id: 'xai', label: 'xAI', kind: 'browser' as const },
    ...['slack', 'telegram', 'x'].map((id) => ({
      section: 'bots',
      id: `official:${id}`,
      label: id === 'x' ? 'X' : id === 'slack' ? 'Slack' : 'Telegram',
      kind: 'browser' as const,
    })),
    { section: 'bots', id: 'wechat', label: 'WeChat', kind: 'browser' as const },
  ];
  const connected = new Set<string>();
  const tickets = new Map<string, { id: string; disconnect: boolean }>();
  const operations = new Map<
    string,
    { id: string; view: Extract<ManagementResult, { kind: 'operation' }> }
  >();
  return async (command: ManagementCommand): Promise<ManagementResult> => {
    if (command.operation === 'list') {
      const items: ManagementItem[] = definitions
        .filter((d) => d.section === command.section)
        .map(({ id, label, section }) => {
          const actionId = crypto.randomUUID();
          tickets.set(actionId, { id, disconnect: connected.has(id) });
          return {
            id: `${section === 'bots' ? 'bot' : 'provider'}:${id}`,
            ...(section === 'bots'
              ? {
                  group: id.startsWith('official:')
                    ? 'management.officialBots'
                    : 'management.personalBots',
                }
              : {}),
            label,
            status: connected.has(id) ? 'connected' : 'disconnected',
            actions: [
              {
                id: actionId,
                intent: connected.has(id) ? 'disconnect' : 'authorize',
                label: 'Trial',
                fields: [],
                expiresAt: Date.now() + 300_000,
              },
            ],
          };
        });
      return { kind: 'page', section: command.section, offset: 0, items };
    }
    if (command.operation === 'run') {
      const old = operations.get(command.operationId);
      if (old) return structuredClone(old.view);
      const ticket = tickets.get(command.actionId);
      if (!ticket) throw new Error('EXPIRED');
      tickets.delete(command.actionId);
      const definition = definitions.find((d) => d.id === ticket.id)!;
      if (ticket.disconnect) connected.delete(ticket.id);
      const view: Extract<ManagementResult, { kind: 'operation' }> = {
        kind: 'operation',
        operationId: command.operationId,
        phase: ticket.disconnect ? 'succeeded' : 'waiting',
        ...(!ticket.disconnect
          ? {
              prompt: {
                kind: definition.kind,
                url: 'https://example.com/cloud-settings-trial',
                expiresAt: Date.now() + 300_000,
                ...(definition.kind === 'device' ? { userCode: 'DEMO-2026' } : {}),
              },
            }
          : {}),
      };
      operations.set(command.operationId, { id: ticket.id, view });
      return structuredClone(view);
    }
    const operation = operations.get(command.operationId);
    if (!operation)
      return { kind: 'operation', operationId: command.operationId, phase: 'unknown' };
    if (operation.view.prompt && operation.view.prompt.expiresAt <= Date.now())
      operation.view = { kind: 'operation', operationId: command.operationId, phase: 'expired' };
    if (command.operation === 'cancel')
      operation.view = { kind: 'operation', operationId: command.operationId, phase: 'unknown' };
    if (command.operation === 'respond') {
      if (operation.view.phase !== 'waiting') throw new Error('NOT_WAITING');
      connected.add(operation.id);
      operation.view = { kind: 'operation', operationId: command.operationId, phase: 'succeeded' };
    }
    return structuredClone(operation.view);
  };
}
