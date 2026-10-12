import type { HookControlManager } from '../hook-control/manager.js';
import type { ManagementCaller, ManagementEntry, ManagementExecution } from './management.js';
import { managementStatus, managementWait } from './managementConnections.js';

interface WechatManagement {
  state(): { phase: string; bound: boolean };
  authorize(signal: AbortSignal): Promise<unknown>;
  unbind(): Promise<unknown>;
}
let wechat: WechatManagement | undefined;
let hookManager: (() => HookControlManager) | undefined;
export function configureCloudWechatManagement(api: WechatManagement): void {
  wechat = api;
}
export function configureCloudHookManagement(get: () => HookControlManager): void {
  hookManager = get;
}

export function listWechatManagement(caller: ManagementCaller): ManagementEntry[] {
  caller.assertCurrent();
  if (!wechat || wechat.state().phase === 'disabled_by_policy') return [];
  const api = wechat,
    before = api.state();
  const resource = 'bot:wechat';
  const check = (execution: ManagementExecution) => {
    execution.assertCurrent();
    if (api.state().bound !== before.bound) throw new Error('MANAGEMENT_CHANGED');
  };
  return [
    {
      id: resource,
      label: 'WeChat',
      group: 'management.personalBots',
      status: managementStatus(before.phase),
      actions: [
        {
          resource,
          label: 'management.actions.authorize',
          intent: 'authorize',
          async run(_values, execution) {
            check(execution);
            await api.authorize(execution.signal);
            await managementWait(async () => {
              const state = api.state();
              if (
                ['error', 'disabled_by_policy', 'needs_reauth', 'disconnected'].includes(
                  state.phase,
                )
              )
                throw new Error('MANAGEMENT_CONNECTION_FAILED');
              return state.phase === 'connected' && state.bound;
            }, execution);
          },
        },
        ...(before.bound
          ? [
              {
                resource,
                label: 'management.actions.disconnect',
                intent: 'disconnect' as const,
                confirmation: 'management.confirm.disconnect',
                async run(_values: Record<string, string>, execution: ManagementExecution) {
                  check(execution);
                  await api.unbind();
                  if (api.state().bound) throw new Error('MANAGEMENT_DISCONNECT_FAILED');
                },
              },
            ]
          : []),
      ],
    },
  ];
}

/** Official connections use the existing device-bound Hook manager, not a new bot client. */
export function listOfficialBotManagement(caller: ManagementCaller): ManagementEntry[] {
  caller.assertCurrent();
  if (!hookManager) return [];
  const manager = hookManager(),
    snapshot = manager.snapshot();
  const entries: ManagementEntry[] = [];
  if (snapshot.url) {
    const resource = 'bot:official:slack';
    const originalTeams = new Set(snapshot.bindings.map((binding) => binding.teamId));
    const connected =
      snapshot.bindings.some((binding) => !binding.displaced) ||
      snapshot.binding?.state === 'confirmed';
    entries.push({
      id: resource,
      label: 'Slack',
      group: 'management.officialBots',
      status: connected ? 'connected' : 'disconnected',
      actions: [
        {
          resource,
          intent: 'authorize',
          label: connected ? 'management.actions.create' : 'management.actions.authorize',
          async run(_values, execution) {
            execution.assertCurrent();
            if (
              manager.snapshot().pendingBind?.state === 'pending' ||
              manager.snapshot().binding?.state === 'pending'
            )
              throw new Error('MANAGEMENT_BUSY');
            let authorizationUrl: string | null = null;
            const expiresAt = Date.now() + 5 * 60_000;
            if (!manager.snapshot().enabled) {
              manager.armAutoBind();
              manager.setProviderEnabled('slack', true);
            } else if (manager.snapshot().serverMultiTeam) {
              if (!manager.addBinding()) throw new Error('MANAGEMENT_UNAVAILABLE');
            } else if (!manager.bindStart()) throw new Error('MANAGEMENT_UNAVAILABLE');
            execution.onCancel(() => {
              const active = manager.snapshot().pendingBind ?? manager.snapshot().binding;
              if (
                authorizationUrl &&
                active?.state === 'pending' &&
                active.authorizeUrl === authorizationUrl
              )
                if (manager.snapshot().serverMultiTeam) manager.cancelPendingBind();
                else manager.bindRevoke();
            });
            await managementWait(async () => {
              const view = manager.snapshot(),
                pending = view.pendingBind ?? view.binding;
              if (pending && ['denied', 'expired', 'failed'].includes(pending.state))
                throw new Error('MANAGEMENT_AUTH_FAILED');
              if (pending?.state === 'pending' && pending.authorizeUrl) {
                if (authorizationUrl && authorizationUrl !== pending.authorizeUrl)
                  throw new Error('MANAGEMENT_CHANGED');
                authorizationUrl = pending.authorizeUrl;
                execution.prompt({ kind: 'browser', url: pending.authorizeUrl, expiresAt });
              }
              return view.serverMultiTeam
                ? view.bindings.some(
                    (binding) => !binding.displaced && !originalTeams.has(binding.teamId),
                  )
                : view.binding?.state === 'confirmed';
            }, execution);
          },
        },
      ],
    });
    if (!snapshot.serverMultiTeam && connected) {
      entries[entries.length - 1]!.actions.push({
        resource,
        intent: 'disconnect',
        label: 'management.actions.disconnect',
        confirmation: 'management.confirm.disconnect',
        async run(_values, execution) {
          execution.assertCurrent();
          if (JSON.stringify(manager.snapshot().binding) !== JSON.stringify(snapshot.binding))
            throw new Error('MANAGEMENT_CHANGED');
          if (!manager.bindRevoke()) throw new Error('MANAGEMENT_DISCONNECT_FAILED');
          await managementWait(
            async () => manager.snapshot().binding?.state !== 'confirmed',
            execution,
          );
        },
      });
    }
    for (const binding of snapshot.bindings) {
      entries.push({
        id: `${resource}:${binding.teamId}`,
        label: binding.teamName ?? 'Slack',
        group: 'management.officialBots',
        status: binding.displaced ? 'offline' : 'connected',
        actions: [
          ...(binding.displaced && snapshot.serverMultiTeam
            ? [
                {
                  resource,
                  intent: 'authorize' as const,
                  label: 'management.actions.reconnect',
                  async run(_values: Record<string, string>, execution: ManagementExecution) {
                    execution.assertCurrent();
                    const fresh = manager.snapshot();
                    if (
                      JSON.stringify(
                        fresh.bindings.find((value) => value.teamId === binding.teamId),
                      ) !== JSON.stringify(binding)
                    )
                      throw new Error('MANAGEMENT_CHANGED');
                    if (fresh.pendingBind?.state === 'pending') throw new Error('MANAGEMENT_BUSY');
                    if (!manager.rebindTeam(binding.teamId))
                      throw new Error('MANAGEMENT_UNAVAILABLE');
                    let authorizationUrl: string | null = null;
                    const expiresAt = Date.now() + 5 * 60_000;
                    execution.onCancel(() => {
                      const pending = manager.snapshot().pendingBind;
                      if (
                        authorizationUrl &&
                        pending?.teamId === binding.teamId &&
                        pending.state === 'pending' &&
                        pending.authorizeUrl === authorizationUrl
                      )
                        manager.cancelPendingBind();
                    });
                    await managementWait(async () => {
                      const view = manager.snapshot(),
                        pending = view.pendingBind;
                      if (pending) {
                        if (pending.teamId !== binding.teamId || pending.intent !== 'rebind')
                          throw new Error('MANAGEMENT_CHANGED');
                        if (pending.state !== 'pending') throw new Error('MANAGEMENT_AUTH_FAILED');
                        if (pending.authorizeUrl) {
                          if (authorizationUrl && authorizationUrl !== pending.authorizeUrl)
                            throw new Error('MANAGEMENT_CHANGED');
                          authorizationUrl = pending.authorizeUrl;
                          execution.prompt({ kind: 'browser', url: authorizationUrl, expiresAt });
                        }
                      }
                      // A displaced row must actually become active. A cleared pending
                      // operation alone can also mean native cancellation or timeout.
                      if (
                        !pending &&
                        view.bindings.some(
                          (value) => value.teamId === binding.teamId && !value.displaced,
                        )
                      )
                        return true;
                      if (!pending) throw new Error('MANAGEMENT_AUTH_FAILED');
                      return false;
                    }, execution);
                  },
                },
              ]
            : []),
          {
            resource,
            intent: 'disconnect',
            label: 'management.actions.disconnect',
            confirmation: 'management.confirm.disconnect',
            async run(_values, execution) {
              execution.assertCurrent();
              if (!manager.snapshot().bindings.some((value) => value.teamId === binding.teamId))
                throw new Error('MANAGEMENT_CHANGED');
              if (!(await manager.revokeTeam(binding.teamId)))
                throw new Error('MANAGEMENT_DISCONNECT_FAILED');
              await managementWait(
                async () =>
                  !manager
                    .snapshot()
                    .bindings.some((value) => value.teamId === binding.teamId && !value.displaced),
                execution,
              );
            },
          },
        ],
      });
    }
  }
  for (const provider of ['telegram', 'x'] as const) {
    const view = snapshot[provider];
    if (!view.url) continue;
    const resource = `bot:official:${provider}`,
      connected = view.binding?.state === 'confirmed';
    entries.push({
      id: resource,
      label: provider === 'telegram' ? 'Telegram' : 'X',
      group: 'management.officialBots',
      status: connected ? 'connected' : 'disconnected',
      actions: connected
        ? [
            {
              resource,
              intent: 'disconnect',
              label: 'management.actions.disconnect',
              confirmation: 'management.confirm.disconnect',
              async run(_values, execution) {
                execution.assertCurrent();
                if (manager.snapshot()[provider].binding?.bindingId !== view.binding?.bindingId)
                  throw new Error('MANAGEMENT_CHANGED');
                if (!manager.providerBindRevoke(provider))
                  throw new Error('MANAGEMENT_DISCONNECT_FAILED');
                await managementWait(
                  async () => manager.snapshot()[provider].binding?.state !== 'confirmed',
                  execution,
                );
              },
            },
          ]
        : [
            {
              resource,
              intent: 'authorize',
              label: 'management.actions.authorize',
              async run(_values, execution) {
                execution.assertCurrent();
                const before = manager.snapshot()[provider].binding;
                if (before?.state === 'pending') throw new Error('MANAGEMENT_BUSY');
                let attemptId: string | null = null;
                const expiresAt = Date.now() + 5 * 60_000;
                manager.setProviderEnabled(provider, true);
                await managementWait(async () => {
                  const current = manager.snapshot()[provider];
                  if (current.status === 'connected' && !current.available)
                    throw new Error('MANAGEMENT_UNAVAILABLE');
                  return current.available;
                }, execution);
                if (!manager.providerBindStart(provider)) throw new Error('MANAGEMENT_AUTH_FAILED');
                execution.onCancel(() => {
                  if (attemptId && manager.snapshot()[provider].binding?.attemptId === attemptId)
                    manager.providerBindCancel(provider);
                });
                await managementWait(async () => {
                  const binding = manager.snapshot()[provider].binding;
                  if (binding?.attemptId) {
                    if (attemptId && attemptId !== binding.attemptId)
                      throw new Error('MANAGEMENT_CHANGED');
                    attemptId = binding.attemptId;
                  }
                  if (
                    binding &&
                    ['denied', 'expired', 'failed', 'revoked', 'superseded'].includes(binding.state)
                  )
                    throw new Error('MANAGEMENT_AUTH_FAILED');
                  if (binding?.connectUrl)
                    execution.prompt({
                      kind: 'browser',
                      url: binding.connectUrl,
                      expiresAt: binding.expiresAt ?? expiresAt,
                    });
                  return binding?.state === 'confirmed';
                }, execution);
              },
            },
          ],
    });
  }
  return entries;
}
