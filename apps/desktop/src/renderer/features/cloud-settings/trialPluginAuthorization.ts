import type {
  CloudPluginCommand,
  CloudPluginResult,
} from '../../../shared/cloudPluginAuthorization';
import i18n from '@/i18n';
/** Samples only; no real plugins, saved keys, browsers or accounts are touched. */
export function createTrialPluginAuthorization() {
  const items: Extract<CloudPluginResult, { kind: 'plugins' }>['items'] = [
    { id: 'trial-oauth', name: 'OAuth', ready: false },
    { id: 'trial-secret', name: 'API Key / Token', ready: false },
    { id: 'trial-connection', name: 'Host + Token', ready: false },
    { id: 'cindy-github', name: 'GitHub CLI', ready: false, authorization: 'github-cli' },
    {
      id: 'trial-custom',
      name: 'Custom Plugin',
      ready: true,
      authorization: 'settings',
      settingsAvailable: true,
    },
  ];
  const operations = new Map<string, Extract<CloudPluginResult, { kind: 'setup' }>>();
  return async (command: CloudPluginCommand): Promise<CloudPluginResult> => {
    if (command.operation === 'list')
      return { kind: 'plugins', offset: command.offset ?? 0, items };
    if (command.operation === 'open-settings')
      return { kind: 'settings', pluginId: command.pluginId };
    if (command.operation === 'start' && !operations.has(command.operationId)) {
      const item = items.find((item) => item.id === command.pluginId);
      if (!item) throw new Error('UNSUPPORTED');
      const action =
        item.id === 'trial-secret'
          ? {
              id: 'inline_form:secret:api-key',
              kind: 'inline_form',
              form: {
                fields: [
                  { id: 'value', type: 'secret', label: 'Token', required: true, maxLength: 4096 },
                ],
              },
            }
          : item.id === 'trial-connection'
            ? { id: 'manage_connection:connection:service', kind: 'manage_connection' }
            : { id: 'oauth_connect:secret:oauth', kind: 'oauth_connect' };
      operations.set(command.operationId, {
        kind: 'setup',
        operationId: command.operationId,
        phase: 'waiting',
        snapshot: {
          requestId: crypto.randomUUID(),
          revision: 1,
          remoteOauth: true,
          remoteSecret: true,
          remoteConnection: true,
          ghost: { id: item.id, name: item.name },
          steps: [
            {
              id: 'account',
              groupId: 'account',
              groupMode: 'any_of',
              title: item.name,
              description: i18n.t('cloudSettings.authTrial'),
              phase: 'pending',
              action,
            },
          ],
        },
      });
    }
    if (command.operation === 'cancel')
      operations.set(command.operationId, {
        kind: 'setup',
        operationId: command.operationId,
        phase: 'cancelled',
      });
    return structuredClone(
      operations.get(command.operationId) ?? {
        kind: 'setup',
        operationId: command.operationId,
        phase: 'unknown',
      },
    );
  };
}
