import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsConfirmationBridge } from '../confirmation.js';

describe('Host settings human confirmation', () => {
  afterEach(() => vi.useRealTimers());
  it('requires a real sender, ignores updatedInput, and consumes one request once', async () => {
    const broadcast = vi.fn(); const current = vi.fn();
    const bridge = new SettingsConfirmationBridge(broadcast);
    const wait = bridge.request('session', { set: { uiSize: 16 } }, { title: 'Settings', description: 'Host only' }, current);
    const id = bridge.pendingSnapshots()[0]!.request.requestId;
    expect(() => bridge.resolveFromIpc(id, { kind: 'permission', behavior: 'allow' }, { isDeviceLink: false, supportsSettingsConfirmation: false, assertTrustedSender: () => { throw new Error('untrusted'); } })).toThrow('untrusted');
    expect(bridge.hasPending(id)).toBe(true);
    const trusted = vi.fn();
    expect(bridge.resolveFromIpc(id, { kind: 'permission', behavior: 'allow', updatedInput: { uiSize: 24 } }, { isDeviceLink: false, supportsSettingsConfirmation: false, assertTrustedSender: trusted })).toBe(true);
    expect(trusted).toHaveBeenCalledOnce();
    await expect(wait).resolves.toBe(true);
    expect(bridge.resolveFromIpc(id, {}, { isDeviceLink: false, supportsSettingsConfirmation: false, assertTrustedSender: trusted })).toBe(false);
  });
  it('fails closed for old controllers and for stale owner/runtime generations', async () => {
    const bridge = new SettingsConfirmationBridge(vi.fn());
    const old = bridge.request('s', {}, { title: '', description: '' }, () => {});
    const id = bridge.pendingSnapshots()[0]!.request.requestId;
    expect(() => bridge.resolveFromIpc(id, { kind: 'permission', behavior: 'allow' }, { isDeviceLink: true, supportsSettingsConfirmation: false, assertTrustedSender: vi.fn() })).toThrow('CONFIRMATION_UNSUPPORTED');
    expect(bridge.hasPending(id)).toBe(true);
    const trustedSender = vi.fn();
    bridge.resolveFromIpc(id, { kind: 'permission', behavior: 'allow' }, {
      isDeviceLink: true, supportsSettingsConfirmation: true, assertTrustedSender: trustedSender,
    });
    await expect(old).resolves.toBe(true);
    expect(trustedSender).not.toHaveBeenCalled();
    let current = true;
    const stale = bridge.request('s', {}, { title: '', description: '' }, () => { if (!current) throw new Error('changed'); });
    const next = bridge.pendingSnapshots()[0]!.request.requestId;
    current = false;
    bridge.resolveFromIpc(next, { kind: 'permission', behavior: 'allow' }, { isDeviceLink: true, supportsSettingsConfirmation: true, assertTrustedSender: vi.fn() });
    await expect(stale).resolves.toBe(false);
  });
  it('keeps distinct requests separate and cancels timeout/closed sessions', async () => {
    vi.useFakeTimers();
    const bridge = new SettingsConfirmationBridge(vi.fn(), 50);
    const a = bridge.request('a', {}, { title: '', description: '' }, () => {});
    const b = bridge.request('a', {}, { title: '', description: '' }, () => {});
    expect(bridge.pendingSnapshots()).toHaveLength(2);
    bridge.cleanupForSession('a');
    await expect(a).resolves.toBe(false); await expect(b).resolves.toBe(false);
    const timeout = bridge.request('b', {}, { title: '', description: '' }, () => {});
    vi.advanceTimersByTime(51);
    await expect(timeout).resolves.toBe(false);
    expect(bridge.pendingSnapshots()).toEqual([]);
  });

  it('recovers the same remote card after reconnect and consumes its decision only once', async () => {
    const broadcast = vi.fn();
    const bridge = new SettingsConfirmationBridge(broadcast);
    const change = { domain: 'databaseWarning', set: { thresholdGiB: 5 }, clear: [] };
    const pending = bridge.request('remote-task', change, { title: 'Settings', description: 'Execution Host' }, () => {});
    const first = bridge.pendingSnapshots('remote-task')[0]!;
    // A disconnected control device rebuilds its existing pending-interaction panel.
    const recovered = bridge.pendingSnapshots('remote-task')[0]!;
    expect(recovered).toEqual(first);
    expect(bridge.pendingSnapshots('another-task')).toEqual([]);
    change.set.thresholdGiB = 999;
    expect(recovered.request.input).toMatchObject({ set: { thresholdGiB: 5 } });
    const origin = { isDeviceLink: true, supportsSettingsConfirmation: true, assertTrustedSender: vi.fn() };
    const decision = { kind: 'permission', behavior: 'allow', updatedInput: { set: { thresholdGiB: 999 } } };
    expect(bridge.resolveFromIpc(recovered.request.requestId, decision, origin)).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(bridge.resolveFromIpc(recovered.request.requestId, decision, origin)).toBe(false);
    expect(bridge.pendingSnapshots('remote-task')).toEqual([]);
    expect(broadcast).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      sessionId: 'remote-task', requestId: first.request.requestId, resolvedAs: 'allow',
    }));
  });
});
