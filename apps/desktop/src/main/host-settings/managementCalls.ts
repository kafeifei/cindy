import { AsyncLocalStorage } from 'node:async_hooks';
import type { IpcHandler, IpcHandlerRegistry } from '../maker-ipc/ipcHandlerRegistry.js';
import type { ManagementExecution } from './management.js';

// A closed, compiled service adapter. None of these names is accepted from the web.
const channels = new Set([
  'telegramBot:get-status',
  'telegramBot:set-config',
  'telegramBot:set-online',
  'telegramBot:disconnect',
  'discordBot:get-status',
  'discordBot:set-config',
  'discordBot:disconnect',
  'wecomBot:get-status',
  'wecomBot:set-config',
  'wecomBot:reconnect',
  'wecomBot:disconnect',
  'feishuBot:get-state',
  'feishuBot:save',
  'feishuBot:clear',
  'feishuBot:reconnect',
  'dingtalkBot:get-state',
  'dingtalkBot:save',
  'dingtalkBot:clear',
  'dingtalkBot:reconnect',
  'maker:mcp:custom:list',
  'maker:mcp:custom:create',
  'maker:mcp:custom:update',
  'maker:mcp:custom:delete',
  'maker:mcp:custom:refresh',
  'maker:contacts:list',
  'maker:contacts:get',
  'maker:contacts:create',
  'maker:contacts:update',
  'maker:contacts:delete',
  'maker:contacts:sync:status:get',
  'maker:contacts:sync:now',
  'maker:auth:logout',
  'maker:claude-oauth:login',
  'maker:claude-oauth:logout',
  'maker:xai-oauth:logout',
  'builtin-api-key-has',
  'builtin-api-key-store',
  'builtin-api-key-remove',
  'maker:provider:list',
  'maker:provider:presets',
  'maker:provider:custom:create',
  'maker:provider:custom:update',
  'maker:provider:custom:delete',
  'maker:provider:custom:disconnect',
  'maker:provider:oauth:login',
  'maker:provider:oauth:logout',
  'cloud:provider:key-replace',
]);
const registered = new Map<string, IpcHandler>();
const events = new WeakMap<object, ManagementExecution>();
const context = new AsyncLocalStorage<ManagementExecution>();

/** Capture the same business handler, preserving its existing mutation queue. */
export function cloudManagementProviderRegistry(native: IpcHandlerRegistry): IpcHandlerRegistry {
  return {
    handle(channel, handler) {
      native.handle(channel, handler);
      if (channels.has(channel)) registered.set(channel, handler);
    },
  };
}
/** IM package handlers are domain functions, before the Electron sender adapter. */
export function registerCloudImCall(channel: string, handler: (payload: unknown) => unknown): void {
  if (channels.has(channel)) registered.set(channel, (_event, payload) => handler(payload));
}
export function hasCloudManagementCall(channel: string): boolean {
  return registered.has(channel);
}

/** A browser cannot manufacture this identity; it never crosses IPC or a wire. */
export function isCloudManagementInvocation(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const execution = events.get(event);
  if (!execution || context.getStore() !== execution) return false;
  execution.assertCurrent();
  return true;
}
export function cloudManagementExecution(): ManagementExecution | undefined {
  return context.getStore();
}

export async function callCloudManagement(
  channel: string,
  args: unknown[],
  execution: ManagementExecution,
): Promise<unknown> {
  execution.assertCurrent();
  const handler = registered.get(channel);
  if (!channels.has(channel) || !handler) throw new Error('MANAGEMENT_UNAVAILABLE');
  const origin = Object.freeze({});
  events.set(origin, execution);
  try {
    return await context.run(execution, async () => {
      execution.assertCurrent();
      return handler(origin, ...args);
    });
  } finally {
    events.delete(origin);
  }
}

/** Internal service registration; never registers an Electron IPC channel. */
export function registerPrivateCloudManagementCall(channel: string, handler: IpcHandler): void {
  if (!channels.has(channel)) throw new Error('MANAGEMENT_CHANNEL_INVALID');
  registered.set(channel, handler);
}

export function runCloudManagementExecution<T>(
  execution: ManagementExecution,
  run: () => Promise<T>,
): Promise<T> {
  execution.assertCurrent();
  return context.run(execution, run);
}

/** Capture an event-free service; only the compiled names above are reachable. */
export function registerCloudDomainCall(
  channel: string,
  handler: (...args: unknown[]) => unknown,
): void {
  if (channels.has(channel)) registered.set(channel, (_event, ...args) => handler(...args));
}
