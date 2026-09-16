import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OauthHostIdentity } from '../authentication.js';
import { fetchOauthIdentity, OAUTH_AUTHORITY_FILE, readOauthAuthority } from '../authority.js';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, {recursive: true, force: true}); });
function fixture() {
  const now = Date.now();
  const identity = {...new OauthHostIdentity().descriptor, instanceId: 'cloud-instance-test',
    deviceId: 'cloud-device-test', membershipId: 'test-member', observedAtMs: now, expiresAtMs: now + 60_000};
  const fetch = vi.fn(async () => new Response(JSON.stringify(identity)));
  return {identity, input: {origin: 'https://cis.example.test', deviceId: identity.deviceId,
    membershipId: identity.membershipId, accessToken: 'synthetic-access', fetch, assertCurrent: vi.fn(), now: () => now}};
}
describe('independent distribution-pinned authority', () => {
  it('requires a strict signed-resource configuration with matching realm and Auth origin', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-authority-')); dirs.push(dir);
    const file = path.join(dir, OAUTH_AUTHORITY_FILE);
    const value = {version: 1, realm: 'cn', authOrigin: 'https://auth.example.test', cisOrigin: 'https://cis.example.test'};
    fs.writeFileSync(file, JSON.stringify(value));
    expect(readOauthAuthority(dir, 'cn', value.authOrigin)).toBe(value.cisOrigin);
    expect(() => readOauthAuthority(dir, 'global', value.authOrigin)).toThrow();
    for (const cisOrigin of ['http://cis.example.test', 'https://cis.example.test/path', 'https://user@cis.example.test']) {
      fs.writeFileSync(file, JSON.stringify({...value, cisOrigin}));
      expect(() => readOauthAuthority(dir, 'cn', value.authOrigin)).toThrow();
    }
    fs.rmSync(file); fs.symlinkSync('/does-not-exist', file);
    expect(() => readOauthAuthority(dir, 'cn', value.authOrigin)).toThrow();
  });
  it('only sends a bearer to the pinned HTTPS lookup, with redirects and caching disabled', async () => {
    const f = fixture();
    await expect(fetchOauthIdentity(f.input)).resolves.toEqual(f.identity);
    expect(f.input.fetch).toHaveBeenCalledWith('https://cis.example.test/instances/oauth-identity/cloud-device-test',
      expect.objectContaining({redirect: 'error', cache: 'no-store', headers: {Authorization: 'Bearer synthetic-access', Accept: 'application/json'}}));
  });
  it.each(['deviceId', 'membershipId', 'observedAtMs', 'expiresAtMs', 'publicKey'])('rejects mismatched or stale %s', async field => {
    const f = fixture();
    const v = {...f.identity, [field]: field === 'observedAtMs' ? f.input.now() - 61_000 : field === 'expiresAtMs' ? f.input.now() - 1 : 'different'};
    await expect(fetchOauthIdentity({...f.input, fetch: async () => new Response(JSON.stringify(v))})).rejects.toThrow();
  });
  it('rejects redirects, errors, oversized or unexpected responses', async () => {
    const f = fixture();
    for (const response of [new Response('{}', {status: 403}), new Response('x'.repeat(4097)),
      new Response(JSON.stringify({...f.identity, accessToken: 'must-never-be-returned'}))]) {
      await expect(fetchOauthIdentity({...f.input, fetch: async () => response})).rejects.toThrow();
    }
    const response = new Response(JSON.stringify(f.identity));
    Object.defineProperty(response, 'redirected', {value: true});
    await expect(fetchOauthIdentity({...f.input, fetch: async () => response})).rejects.toThrow();
  });
  it('discards the identity after owner/window changes during the HTTPS request', async () => {
    const f = fixture(); let current = true;
    await expect(fetchOauthIdentity({...f.input,
      fetch: async () => { current = false; return new Response(JSON.stringify(f.identity)); },
      assertCurrent: () => { if (!current) throw new Error('changed owner'); },
    })).rejects.toThrow();
  });
});
