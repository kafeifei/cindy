import fs from 'node:fs';
import path from 'node:path';
import { oauthExact, parsePluginOauthTrustedIdentity } from '@cindy/device-link';

export const OAUTH_AUTHORITY_FILE = 'plugin-oauth-authority.json';
const fail = () => new Error('OAUTH_BRIDGE_UNAVAILABLE');
/** Distribution-owned resource, covered by application signing. Never accept an origin from a card/relay/IPC. */
export function readOauthAuthority(resourcesPath: string, realm: string, authOrigin: string): string {
  const file = path.join(resourcesPath, OAUTH_AUTHORITY_FILE);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw fail();
  const v = oauthExact(JSON.parse(fs.readFileSync(file, 'utf8')), ['version', 'realm', 'authOrigin', 'cisOrigin']);
  if (v.version !== 1 || v.realm !== realm || v.authOrigin !== authOrigin || typeof v.cisOrigin !== 'string') throw fail();
  const url = new URL(v.cisOrigin);
  if (url.protocol !== 'https:' || url.origin !== v.cisOrigin || url.username || url.password) throw fail();
  return url.origin;
}
export async function fetchOauthIdentity(input: {
  origin: string; deviceId: string; membershipId: string; accessToken: string;
  fetch(url: string, init: RequestInit): Promise<Response>; assertCurrent(): void; now?: () => number;
}) {
  input.assertCurrent();
  const origin = new URL(input.origin);
  if (origin.protocol !== 'https:' || origin.origin !== input.origin || origin.username || origin.password) throw fail();
  const response = await input.fetch(`${input.origin}/instances/oauth-identity/${encodeURIComponent(input.deviceId)}`, {
    method: 'GET', headers: {Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json'},
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  input.assertCurrent();
  if (!response.ok || response.redirected) { await response.body?.cancel(); throw fail(); }
  const reader = response.body?.getReader();
  if (!reader) throw fail();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const item = await reader.read();
      input.assertCurrent();
      if (item.done) break;
      size += item.value.length;
      if (size > 4096) throw fail();
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const value = parsePluginOauthTrustedIdentity(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const now = input.now?.() ?? Date.now();
  if (value.deviceId !== input.deviceId || value.membershipId !== input.membershipId
    || value.observedAtMs > now + 1000 || now - value.observedAtMs > 60_000
    || value.expiresAtMs <= now || value.expiresAtMs > value.observedAtMs + 60_000) throw fail();
  input.assertCurrent();
  return value;
}
