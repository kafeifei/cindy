import { randomUUID } from 'node:crypto';
import { CONTROLLER_CAPABILITY_HOST_SETTINGS_CONFIRMATION_V1 } from '@cindy/device-link';
import type { InteractionRequest } from '@cindy/maker-core';
import { MAKER_PUSH } from '../maker-ipc/channels.js';
import { HOST_CONFIRM_TIMEOUT_MS } from '../maker-ipc/hostConfirmTiming.js';
import { HostSettingsError } from './operations.js';

export const SETTINGS_CONFIRM_TOOL = 'cindy_host_settings';
export const SETTINGS_CONFIRM_CAPABILITY = CONTROLLER_CAPABILITY_HOST_SETTINGS_CONFIRMATION_V1;
type Request = Extract<InteractionRequest, { kind: 'permission' }>;
interface Entry {
  sessionId: string;
  request: Request;
  assertCurrent: () => void;
  resolve: (confirmed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Separate from Agent interactions and Bot reply resolvers. Only trusted UI receipts settle it. */
export class SettingsConfirmationBridge {
  private readonly pending = new Map<string, Entry>();
  constructor(private readonly broadcast: (channel: string, payload: unknown) => void, private readonly timeoutMs = HOST_CONFIRM_TIMEOUT_MS) {}

  request(sessionId: string, input: Record<string, unknown>, copy: { title: string; description: string }, assertCurrent: () => void): Promise<boolean> {
    assertCurrent();
    if (this.pending.size >= 64) throw new HostSettingsError('BUSY');
    const requestId = randomUUID();
    const request: Request = { kind: 'permission', requestId, toolName: SETTINGS_CONFIRM_TOOL, input: structuredClone(input), ...copy, metadata: { hostOwnedConfirmation: 'host_settings_v1' } };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.finish(requestId, false, 'timeout'), this.timeoutMs);
      this.pending.set(requestId, { sessionId, request, assertCurrent, resolve, timer });
      try { this.broadcast(MAKER_PUSH.INTERACTION_REQUEST, { sessionId, request }); }
      catch { this.finish(requestId, false, 'delivery_failed'); }
    });
  }
  pendingSnapshots(sessionId?: string): Array<{ sessionId: string; request: Request }> {
    const result: Array<{ sessionId: string; request: Request }> = [];
    for (const [id, entry] of this.pending) {
      try { entry.assertCurrent(); } catch { this.finish(id, false, 'scope_changed'); continue; }
      if (!sessionId || entry.sessionId === sessionId) result.push({ sessionId: entry.sessionId, request: structuredClone(entry.request) });
    }
    return result;
  }
  hasPending(requestId: string): boolean { return this.pending.has(requestId); }
  resolveFromIpc(requestId: string, decision: unknown, origin: { isDeviceLink: boolean; supportsSettingsConfirmation: boolean; assertTrustedSender: () => void }): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    if (origin.isDeviceLink) {
      if (!origin.supportsSettingsConfirmation) {
        // An older peer cannot settle another controller's pending confirmation.
        throw new HostSettingsError('CONFIRMATION_UNSUPPORTED');
      }
    } else origin.assertTrustedSender();
    let current = true;
    try { entry.assertCurrent(); } catch { current = false; }
    const raw = decision && typeof decision === 'object' && !Array.isArray(decision) ? decision as Record<string, unknown> : {};
    // Ignore updatedInput and every model-provided token. Only the captured change may be committed.
    this.finish(requestId, current && raw.kind === 'permission' && raw.behavior === 'allow', current ? 'resolved' : 'scope_changed');
    return true;
  }
  cleanupForSession(sessionId: string): void {
    for (const [id, entry] of this.pending) if (entry.sessionId === sessionId) this.finish(id, false, 'session_closed');
  }
  private finish(id: string, confirmed: boolean, reason: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(confirmed);
    try { this.broadcast(MAKER_PUSH.INTERACTION_DISMISSED, { sessionId: entry.sessionId, requestId: id, reason, resolvedAs: confirmed ? 'allow' : 'deny' }); } catch { /* The result remains settled. */ }
  }
}
