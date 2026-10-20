import type {
  ManagementCommand,
  ManagementItem,
  ManagementResult,
} from '../../../shared/settingsManagement';
/** In-memory preview: retain presence and header names only, never the entered credential. */
export function createTrialMcpAuthorization() {
  const servers = [
    {
      id: 'mcp:docs',
      name: 'Documentation',
      url: 'https://example.com/mcp',
      token: true,
      transport: 'http',
      headers: ['X-API-Key'],
    },
    {
      id: 'mcp:tools',
      name: 'Team Tools',
      url: 'https://example.com/sse',
      token: false,
      transport: 'sse',
      headers: [] as string[],
    },
  ];
  const tickets = new Map<string, { server: (typeof servers)[number]; label: string }>();
  const operations = new Map<string, ManagementResult>();
  const action = (
    server: (typeof servers)[number],
    label: string,
    fields: ManagementItem['actions'][number]['fields'],
    intent: ManagementItem['actions'][number]['intent'] = 'edit',
  ) => {
    const id = crypto.randomUUID();
    tickets.set(id, { server, label });
    return {
      id,
      label,
      fields,
      intent,
      expiresAt: Date.now() + 300000,
      ...(label === 'management.removeToken'
        ? { confirmation: 'management.confirm.disconnect' }
        : {}),
    };
  };
  return {
    owns(command: ManagementCommand) {
      return command.operation === 'list'
        ? command.section === 'mcp'
        : command.operation === 'run'
          ? tickets.has(command.actionId)
          : operations.has(command.operationId);
    },
    async execute(command: ManagementCommand): Promise<ManagementResult> {
      if (command.operation === 'list')
        return {
          kind: 'page',
          section: 'mcp',
          offset: 0,
          items: servers.map((server) => ({
            id: server.id,
            label: server.name,
            status: 'available',
            actions: [
              action(
                server,
                'management.actions.edit',
                ['name', 'url', 'transport'].map((key) => ({
                  name: key,
                  label: key,
                  kind: 'text',
                  required: true,
                  maxLength: 512,
                  value: server[key as 'name' | 'url' | 'transport'],
                })),
              ),
              action(
                server,
                'management.setToken',
                [
                  {
                    name: 'bearerToken',
                    label: 'Token',
                    kind: 'password',
                    required: true,
                    maxLength: 8192,
                  },
                ],
                'connect',
              ),
              action(server, 'management.setHeader', [
                {
                  name: 'headerName',
                  label: 'Header',
                  kind: 'text',
                  required: true,
                  maxLength: 512,
                },
                {
                  name: 'headerValue',
                  label: 'Value',
                  kind: 'password',
                  required: true,
                  maxLength: 8192,
                },
              ]),
              ...(server.token ? [action(server, 'management.removeToken', [], 'disconnect')] : []),
              ...(server.headers.length
                ? [
                    action(server, 'management.removeHeader', [
                      {
                        name: 'headerName',
                        label: 'Header',
                        kind: 'select',
                        required: true,
                        maxLength: 512,
                        options: server.headers.map((value) => ({ value, label: value })),
                      },
                    ]),
                  ]
                : []),
            ],
          })),
        };
      if (operations.has(command.operationId)) return operations.get(command.operationId)!;
      if (command.operation !== 'run')
        return { kind: 'operation', operationId: command.operationId, phase: 'unknown' };
      const ticket = tickets.get(command.actionId);
      if (!ticket) throw Error('EXPIRED');
      const { server, label } = ticket;
      if (label === 'management.setToken') server.token = true;
      if (label === 'management.removeToken') server.token = false;
      if (label === 'management.setHeader' && !server.headers.includes(command.values.headerName!))
        server.headers.push(command.values.headerName!);
      if (label === 'management.removeHeader')
        server.headers = server.headers.filter((key) => key !== command.values.headerName);
      const result: ManagementResult = {
        kind: 'operation',
        operationId: command.operationId,
        phase: 'succeeded',
      };
      operations.set(command.operationId, result);
      return result;
    },
  };
}
