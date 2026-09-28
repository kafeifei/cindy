import { request } from 'node:http';
import { cloudManagementExecution } from './managementCalls.js';

/** Redirect only the presentation of a cloud-initiated login. Native flows keep
 * their browser, callback listener, state/PKCE checks and credential writer.
 */
export async function openManagementAuthorization(
  url: string,
  nativeOpen: (url: string) => Promise<void>,
): Promise<void> {
  const execution = cloudManagementExecution();
  if (!execution) return nativeOpen(url);
  execution.assertCurrent();
  const authorize = new URL(url);
  if (authorize.protocol !== 'https:' || authorize.username || authorize.password)
    throw new Error('MANAGEMENT_AUTH_URL_INVALID');
  const redirect =
    authorize.searchParams.get('redirect_uri') ?? authorize.searchParams.get('callback_url');
  if (!redirect) {
    execution.prompt({ kind: 'browser', url, expiresAt: Date.now() + 5 * 60_000 });
    return;
  }
  const callback = new URL(redirect);
  if (
    callback.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(callback.hostname) ||
    !callback.port ||
    callback.username ||
    callback.password ||
    callback.hash
  )
    throw new Error('MANAGEMENT_AUTH_CALLBACK_INVALID');
  const state = authorize.searchParams.get('state') ?? callback.searchParams.get('state');
  let used = false;
  execution.prompt({ kind: 'callback', url, expiresAt: Date.now() + 5 * 60_000 }, async (value) => {
    execution.assertCurrent();
    const incoming = new URL(value.trim());
    if (
      used ||
      incoming.origin !== callback.origin ||
      incoming.pathname !== callback.pathname ||
      incoming.username ||
      incoming.password ||
      incoming.hash ||
      (state && incoming.searchParams.get('state') !== state) ||
      (!incoming.searchParams.get('code') && !incoming.searchParams.get('error'))
    )
      throw new Error('MANAGEMENT_AUTH_CALLBACK_INVALID');
    used = true;
    // The destination comes from this specific native login, never from web input.
    const target = new URL(callback.href);
    target.search = incoming.search;
    await new Promise<void>((resolve, reject) => {
      const req = request(
        target,
        { method: 'GET', signal: execution.signal, timeout: 5000 },
        (res) => {
          res.resume();
          res.on('end', () =>
            res.statusCode && res.statusCode >= 200 && res.statusCode < 400
              ? resolve()
              : reject(new Error('MANAGEMENT_AUTH_CALLBACK_REJECTED')),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('MANAGEMENT_AUTH_CALLBACK_TIMEOUT')));
      req.on('error', () => reject(new Error('MANAGEMENT_AUTH_CALLBACK_FAILED')));
      req.end();
    });
  });
}

export function presentManagementDeviceCode(value: {
  verificationUrl: string;
  userCode: string;
  expiresAt: number;
}): void {
  const execution = cloudManagementExecution();
  if (!execution) return;
  execution.assertCurrent();
  execution.prompt({
    kind: 'device',
    url: value.verificationUrl,
    userCode: value.userCode,
    expiresAt: value.expiresAt,
  });
}

/** Cancellation closes only the resources captured by this login invocation. */
export function attachManagementAuthorization(cancel: () => void): void {
  cloudManagementExecution()?.onCancel(cancel);
}
export function assertManagementAuthorizationCurrent(): void {
  cloudManagementExecution()?.assertCurrent();
}
