import type { CloudClientErrorCode } from '../../shared/cloudSettingsClient';

export class CloudClientError extends Error {
  constructor(readonly code: CloudClientErrorCode) {
    super(code);
  }
}
export interface CloudClientIdentity {
  key: string;
  generation: number;
  baseUrl: string;
  accessToken: string;
}
export interface CloudClientHttp {
  request(
    identity: CloudClientIdentity,
    path: string,
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    body: unknown,
    signal: AbortSignal,
    assertCurrent: () => void,
  ): Promise<unknown>;
}

export function createCloudClientHttp(fetcher: typeof fetch): CloudClientHttp {
  return {
    async request(identity, path, method, body, signal, assertCurrent) {
      assertCurrent();
      let base: URL;
      try {
        base = new URL(identity.baseUrl);
      } catch {
        throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
      }
      if (
        base.protocol !== 'https:' ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path.includes('..')
      )
        throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
      const url = `${base.origin}${base.pathname.replace(/\/$/u, '')}${path}`;
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers: {
            Authorization: `Bearer ${identity.accessToken}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
        });
        assertCurrent();
        if (!response.ok) {
          await response.body?.cancel();
          throw new CloudClientError(
            response.status === 404 || response.status === 501
              ? 'CLOUD_SETTINGS_UNSUPPORTED'
              : response.status === 409 &&
                  (method === 'PATCH' || /^\/instances\/[^/]+\/maintenance\/upgrade$/u.test(path))
                ? 'CLOUD_SETTINGS_CONFLICT'
                : response.status === 401 || response.status === 403 || response.status === 409
                  ? 'CLOUD_SETTINGS_SCOPE_CHANGED'
                  : response.status === 429
                    ? 'CLOUD_SETTINGS_BUSY'
                    : 'CLOUD_SETTINGS_UNAVAILABLE',
          );
        }
        if (response.status === 204) return undefined;
        const reader = response.body?.getReader();
        if (!reader) throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > (path === '/instance-login/api/manage/instances' ? 512 * 1024 : 64 * 1024)) {
              await reader.cancel();
              throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        assertCurrent();
        try {
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new CloudClientError('CLOUD_SETTINGS_INVALID_RESPONSE');
        }
      } catch (error) {
        assertCurrent();
        if (error instanceof CloudClientError) throw error;
        // Never relay network errors, response bodies or credentials to the UI.
        throw new CloudClientError('CLOUD_SETTINGS_UNAVAILABLE');
      }
    },
  };
}
