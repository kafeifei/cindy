import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  openManagementAuthorization,
  presentManagementDeviceCode,
} from '../managementAuthorization.js';
import { runCloudManagementExecution } from '../managementCalls.js';
import type { ManagementExecution } from '../management.js';

function execution() {
  let respond: ((value: string) => Promise<void>) | undefined;
  const prompt = vi.fn();
  const abort = new AbortController();
  const value: ManagementExecution = {
    signal: abort.signal,
    assertCurrent() {
      abort.signal.throwIfAborted();
    },
    onCancel() {},
    prompt(value, callback) {
      prompt(value);
      respond = callback;
    },
  };
  return {
    value,
    prompt,
    abort,
    get respond() {
      return respond!;
    },
  };
}
describe('cloud authorization presentation and callback pinning', () => {
  it('keeps native browser behavior outside a cloud invocation', async () => {
    const native = vi.fn(async () => {});
    await openManagementAuthorization('https://auth.example.invalid/login', native);
    expect(native).toHaveBeenCalledOnce();
  });
  it('publishes device codes only inside the originating cloud execution', async () => {
    const e = execution(),
      value = {
        verificationUrl: 'https://auth.example.invalid/device',
        userCode: 'EXAMPLE-CODE',
        expiresAt: Date.now() + 60_000,
      };
    presentManagementDeviceCode(value);
    expect(e.prompt).not.toHaveBeenCalled();
    await runCloudManagementExecution(e.value, async () => {
      presentManagementDeviceCode(value);
    });
    expect(e.prompt).toHaveBeenCalledWith({
      kind: 'device',
      url: value.verificationUrl,
      userCode: value.userCode,
      expiresAt: value.expiresAt,
    });
  });
  it('forwards only one callback to the exact native loopback listener and state', async () => {
    const received: string[] = [];
    const server = createServer((req, res) => {
      received.push(req.url!);
      res.end('OK');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const callback = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`,
      e = execution(),
      native = vi.fn(async () => {});
    try {
      await runCloudManagementExecution(e.value, () =>
        openManagementAuthorization(
          `https://auth.example.invalid/login?redirect_uri=${encodeURIComponent(callback)}&state=pinned`,
          native,
        ),
      );
      expect(native).not.toHaveBeenCalled();
      expect(e.prompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'callback' }));
      for (const url of [
        `${callback}?code=test&state=wrong`,
        `${callback}/other?code=test&state=pinned`,
        'http://127.0.0.1:1/callback?code=test&state=pinned',
        'https://other.example.invalid/callback?code=test&state=pinned',
        `${callback}?code=test&state=pinned#fragment`,
      ])
        await expect(e.respond(url)).rejects.toThrow();
      expect(received).toEqual([]);
      await e.respond(`${callback}?code=temporary-code&state=pinned`);
      expect(received).toEqual(['/callback?code=temporary-code&state=pinned']);
      await expect(e.respond(`${callback}?code=again&state=pinned`)).rejects.toThrow();
      expect(JSON.stringify(e.prompt.mock.calls)).not.toContain('temporary-code');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it.each([
    'javascript:alert(1)',
    'http://auth.example.invalid/login',
    'https://user:secret@auth.example.invalid/login',
    `https://auth.example.invalid/login?redirect_uri=${encodeURIComponent('http://169.254.169.254:80/metadata')}`,
  ])('rejects arbitrary navigation/forwarding %s', async (url) => {
    const e = execution();
    await expect(
      runCloudManagementExecution(e.value, () => openManagementAuthorization(url, async () => {})),
    ).rejects.toThrow();
    expect(e.prompt).not.toHaveBeenCalled();
  });
});
