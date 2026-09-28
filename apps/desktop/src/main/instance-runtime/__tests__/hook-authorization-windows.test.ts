import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlackHookView } from '../../../shared/hookControlIpc.js';
import { HookAuthorizationWindows } from '../hook-authorization-windows.js';

function view(state = 'pending', extra: Record<string, unknown> = {}): SlackHookView {
  return {
    enabled: true,
    binding: { state, reason: null },
    pendingBind: null,
    telegram: { enabled: true, binding: { state: 'pending' } },
    x: { enabled: true, binding: { state: 'pending' } },
    ...extra,
  } as unknown as SlackHookView;
}
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());

describe('cloud hook authorization lifecycle', () => {
  it.each(['confirmed', 'denied', 'expired', 'failed', 'none'])(
    'reclaims Slack only at %s',
    async (state) => {
      const close = vi.fn(async () => {}),
        browser = { open: vi.fn(async () => close) },
        warn = vi.fn();
      const windows = new HookAuthorizationWindows(browser, warn);
      windows.update(view());
      await windows.open('slack', 'https://slack.example/');
      windows.update(view());
      await settle();
      expect(close).not.toHaveBeenCalled();
      windows.update(view(state));
      await settle();
      expect(close).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
      windows.dispose();
    },
  );
  it('keeps the window while Slack app installation is required', async () => {
    const close = vi.fn(async () => {}),
      windows = new HookAuthorizationWindows({ open: async () => close }, vi.fn());
    windows.update(view());
    await windows.open('slack', 'https://slack.example/');
    windows.update(view('failed', { pendingBind: { state: 'failed', reason: 'not-installed' } }));
    await settle();
    expect(close).not.toHaveBeenCalled();
    windows.update(view('confirmed'));
    await settle();
    expect(close).toHaveBeenCalledOnce();
    windows.dispose();
  });
  it('handles completion before the browser finishes launching', async () => {
    let resolve!: (v: () => Promise<void>) => void;
    const close = vi.fn(async () => {});
    const windows = new HookAuthorizationWindows(
      {
        open: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
      vi.fn(),
    );
    windows.update(view());
    const opened = windows.open('slack', 'https://slack.example/');
    windows.update(view('confirmed'));
    resolve(close);
    await opened;
    await settle();
    expect(close).toHaveBeenCalledOnce();
    windows.dispose();
  });
  it('separates providers and generations and closes all on owner teardown', async () => {
    const closes = [vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})];
    let next = 0;
    const windows = new HookAuthorizationWindows({ open: async () => closes[next++]! }, vi.fn());
    windows.update(view());
    await windows.open('slack', 'https://slack.example/1');
    await windows.open('x', 'https://x.example/');
    await windows.open('slack', 'https://slack.example/2');
    await settle();
    expect(closes[0]).toHaveBeenCalledOnce();
    expect(closes[1]).not.toHaveBeenCalled();
    expect(closes[2]).not.toHaveBeenCalled();
    windows.update(view('confirmed'));
    await settle();
    expect(closes[2]).toHaveBeenCalledOnce();
    expect(closes[1]).not.toHaveBeenCalled();
    windows.dispose();
    await settle();
    expect(closes[1]).toHaveBeenCalledOnce();
  });
  it('reclaims windows when no terminal update arrives', async () => {
    vi.useFakeTimers();
    const close = vi.fn(async () => {}),
      windows = new HookAuthorizationWindows({ open: async () => close }, vi.fn(), 1000);
    windows.update(view());
    await windows.open('telegram', 'https://telegram.example/');
    await vi.advanceTimersByTimeAsync(1000);
    expect(close).toHaveBeenCalledOnce();
    windows.dispose();
  });
  it('settles launch failure without an unhandled rejection or stale cleanup', async () => {
    const windows = new HookAuthorizationWindows(
      {
        open: async () => {
          throw Error('private URL');
        },
      },
      vi.fn(),
    );
    windows.update(view());
    await expect(windows.open('slack', 'https://slack.example/')).rejects.toThrow(
      'AUTHORIZATION_BROWSER_START_FAILED',
    );
    windows.dispose();
    await settle();
  });
  it('keeps Telegram and X windows while awaiting the user confirmation', async () => {
    const close = vi.fn(async () => {}),
      windows = new HookAuthorizationWindows({ open: async () => close }, vi.fn());
    windows.update(view());
    await windows.open('telegram', 'https://telegram.example/');
    windows.update(
      view('confirmed', {
        telegram: { enabled: true, binding: { state: 'awaiting_confirmation' } },
      }),
    );
    await settle();
    expect(close).not.toHaveBeenCalled();
    windows.update(
      view('confirmed', { telegram: { enabled: true, binding: { state: 'confirmed' } } }),
    );
    await settle();
    expect(close).toHaveBeenCalledOnce();
    await windows.dispose();
  });
});
