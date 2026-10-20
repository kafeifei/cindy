import { z } from 'zod';
import type { CloudClientCaller } from './service';
import { CloudClientError, type CloudClientHttp, type CloudClientIdentity } from './transport';
import { parseCloud, parseOwnedInstances, projectCloudInstance } from './ownedInstances';

const instancesPath = '/instance-login/api/manage/instances';
const attemptSchema = z.object({ continueUrl: z.string().max(2048) });

/** The existing CIS login page owns SSO and any additional verification. Its
 * short-lived capability goes from Main to the pinned CIS browser page only,
 * never to Renderer, logs or storage. Instance credentials stay on CIS/runtime. */
export function createCloudInstanceOnboarding(deps: {
  identity(): CloudClientIdentity | null;
  http: CloudClientHttp;
  openExternal?: (url: string) => Promise<void>;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const active = new Map<AbortController, number>();
  const mutations = new Set<string>();
  const attempts = new Map<string, { callerId: number; url: string; expires: number }>();
  async function perform<T>(
    caller: CloudClientCaller,
    mutation: boolean,
    run: (
      call: (path: string, method?: 'GET' | 'POST', body?: unknown) => Promise<unknown>,
      identity: CloudClientIdentity,
      check: () => void,
    ) => Promise<T>,
  ) {
    caller.assertCurrent();
    const identity = deps.identity();
    if (!identity) throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
    if (active.size >= 32 || (mutation && mutations.has(identity.key)))
      throw new CloudClientError('CLOUD_SETTINGS_BUSY');
    const controller = new AbortController();
    active.set(controller, caller.id);
    if (mutation) mutations.add(identity.key);
    const check = () => {
      caller.assertCurrent();
      if (controller.signal.aborted || deps.identity()?.key !== identity.key)
        throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
    };
    const call = async (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
      check();
      const result = await deps.http.request(
        deps.identity()!,
        path,
        method,
        body,
        controller.signal,
        check,
      );
      check();
      return result;
    };
    try {
      return await run(call, identity, check);
    } finally {
      active.delete(controller);
      if (mutation) mutations.delete(identity.key);
    }
  }
  return {
    list(caller: CloudClientCaller) {
      return perform(caller, false, async (call) =>
        parseOwnedInstances(await call(instancesPath)).map(projectCloudInstance),
      );
    },
    claim(caller: CloudClientCaller) {
      return perform(caller, true, async (call, _identity, check) => {
        const before = parseOwnedInstances(await call(instancesPath));
        // Do not wake or allocate on entry, errors, or an existing membership.
        if (before.length) return before.map(projectCloudInstance);
        try {
          // CIS atomically ensures one default instance and chooses image/quota/defaults.
          await call(`${instancesPath}/wake`, 'POST', {});
        } catch {
          check();
          // LOGIN_REQUIRED persists a record before returning an error. A lost
          // response can do the same: read back instead of retrying the POST.
        }
        try {
          const after = parseOwnedInstances(await call(instancesPath));
          if (after.length) return after.map(projectCloudInstance);
        } catch {
          check();
        }
        throw new CloudClientError('CLOUD_SETTINGS_SAVE_UNCONFIRMED');
      });
    },
    initialize(caller: CloudClientCaller, deviceId: string) {
      return perform(caller, true, async (call, identity, check) => {
        if (!deps.openExternal) throw new CloudClientError('CLOUD_SETTINGS_UNSUPPORTED');
        const target = parseOwnedInstances(await call(instancesPath)).find(
          (v) => v.deviceId === deviceId,
        );
        if (!target) throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
        if (!target.status.loginRequired) return;
        const org = target.status.ownership?.orgSlug;
        if (!org) throw new CloudClientError('CLOUD_SETTINGS_UNSUPPORTED');
        const key = JSON.stringify([identity.key, caller.id, target.instanceId, target.deviceId]);
        for (const [id, value] of attempts) if (value.expires <= now()) attempts.delete(id);
        let cached = attempts.get(key);
        if (!cached) {
          if (attempts.size >= 32) throw new CloudClientError('CLOUD_SETTINGS_BUSY');
          const createdAt = now();
          const result = parseCloud(
            attemptSchema,
            await call('/instance-login/api/attempts', 'POST', {
              instanceId: target.instanceId,
              org,
            }),
          );
          // Accept only the existing relative CIS continuation, no redirect or
          // caller-provided URL. Reconstruct a canonical fragment after validation.
          const base = new URL(identity.baseUrl);
          if (
            base.protocol !== 'https:' ||
            base.username ||
            base.password ||
            base.search ||
            base.hash ||
            !result.continueUrl.startsWith('/instance-login/#')
          )
            throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
          const url = new URL(result.continueUrl, base.origin);
          const fragment = new URLSearchParams(url.hash.slice(1));
          const id = fragment.get('attemptId'),
            secret = fragment.get('attemptSecret');
          if (
            url.origin !== base.origin ||
            url.pathname !== '/instance-login/' ||
            url.search ||
            Array.from(fragment.keys()).length !== 2 ||
            !z.string().uuid().safeParse(id).success ||
            !secret ||
            !/^[A-Za-z0-9_-]{32,256}$/u.test(secret)
          )
            throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
          const safe = new URL('/instance-login/', base.origin);
          safe.hash = new URLSearchParams({ attemptId: id!, attemptSecret: secret }).toString();
          cached = { callerId: caller.id, url: safe.href, expires: createdAt + 10 * 60_000 };
          attempts.set(key, cached);
        }
        check();
        try {
          await deps.openExternal(cached.url);
        } catch {
          check();
          throw new CloudClientError('CLOUD_SETTINGS_UNAVAILABLE');
        }
        check();
      });
    },
    invalidate(callerId?: number) {
      for (const [controller, id] of active)
        if (callerId === undefined || id === callerId) controller.abort();
      for (const [key, attempt] of attempts)
        if (callerId === undefined || attempt.callerId === callerId) attempts.delete(key);
    },
  };
}
