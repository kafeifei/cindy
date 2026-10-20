import { describe, expect, it, vi } from 'vitest';
import { createCloudInstanceOnboarding } from '../onboarding';
import { cloudSettingsClientHandlers } from '../ipc';
import { createCloudSettingsService } from '../service';
import { CloudClientError, type CloudClientHttp, type CloudClientIdentity } from '../transport';

const listPath = '/instance-login/api/manage/instances';
const attemptId = '11111111-1111-4111-8111-111111111111';
const secret = 'invalid-test-only-'.repeat(3);
function fixture() {
  let identity: CloudClientIdentity | null = {
    key: 'owner-a',
    generation: 1,
    accessToken: 'invalid-test-token',
    baseUrl: 'https://cis.example.test',
  };
  const target = {
    instanceId: 'instance-a',
    deviceId: 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa',
    customLabel: null,
    nameSequence: 1,
    status: {
      instanceId: 'instance-a',
      deviceId: 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa',
      desiredState: 'running',
      runtimeState: 'missing',
      image: 'registry.example.test/cloud:0.1.108',
      readiness: { ready: false },
      updateAvailable: false,
      latestReleaseTag: '0.1.108',
      upgrade: { state: 'idle' },
      loginRequired: true,
      ownership: { orgSlug: 'example', membershipId: 'owner-a', passportId: 'private' },
    },
  };
  let list: (typeof target)[] = [];
  let now = 1;
  const request = vi.fn<CloudClientHttp['request']>(
    async (_identity, path, method, _body, _signal, check) => {
      check();
      if (path === listPath && method === 'GET') return { instances: list };
      if (path === `${listPath}/wake`) {
        list = [target];
        throw new CloudClientError('CLOUD_SETTINGS_UNAVAILABLE');
      }
      if (path === '/instance-login/api/attempts')
        return { continueUrl: `/instance-login/#attemptId=${attemptId}&attemptSecret=${secret}` };
      throw Error('unexpected route');
    },
  );
  const caller = { id: 1, assertCurrent: vi.fn() },
    openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
  const deps = { identity: () => identity, http: { request }, openExternal, now: () => now };
  return {
    api: createCloudInstanceOnboarding(deps),
    caller,
    request,
    deps,
    openExternal,
    target,
    setList: (value: (typeof target)[]) => {
      list = value;
    },
    revoke: () => {
      identity = null;
    },
    advance: () => {
      now += 600_001;
    },
  };
}
describe('native cloud instance onboarding', () => {
  it('empty discovery is read-only and never initializes or creates', async () => {
    const f = fixture();
    expect(await f.api.list(f.caller)).toEqual([]);
    expect(f.request.mock.calls.map((v) => [v[1], v[2]])).toEqual([[listPath, 'GET']]);
    expect(f.openExternal).not.toHaveBeenCalled();
  });
  it('projects owned instances without ownership, image registry or credentials', async () => {
    const f = fixture();
    f.setList([f.target]);
    const result = await f.api.list(f.caller);
    expect(result[0]).toMatchObject({ loginRequired: true, version: '0.1.108', maintenance: null });
    expect(JSON.stringify(result)).not.toMatch(/private|registry|owner-a|ownership|token/u);
  });
  it('recovers the allocated record after LOGIN_REQUIRED or a lost create response', async () => {
    const f = fixture();
    expect(await f.api.claim(f.caller)).toMatchObject([
      { instanceId: 'instance-a', loginRequired: true },
    ]);
    expect(f.request.mock.calls.map((v) => [v[1], v[2]])).toEqual([
      [listPath, 'GET'],
      [`${listPath}/wake`, 'POST'],
      [listPath, 'GET'],
    ]);
    expect(f.request.mock.calls[1][3]).toEqual({});
  });
  it('an existing asleep instance is returned without waking or creating it', async () => {
    const f = fixture();
    f.target.status.desiredState = 'stopped';
    f.setList([f.target]);
    expect(await f.api.claim(f.caller)).toMatchObject([{ desiredState: 'stopped' }]);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('does not turn a list failure into a first claim', async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new CloudClientError('CLOUD_SETTINGS_UNAVAILABLE'));
    await expect(f.api.claim(f.caller)).rejects.toThrow('UNAVAILABLE');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('unknown creation is reported without automatic resubmission', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce({ instances: [] })
      .mockRejectedValueOnce(Error('lost'))
      .mockResolvedValueOnce({ instances: [] });
    await expect(f.api.claim(f.caller)).rejects.toThrow('SAVE_UNCONFIRMED');
    expect(f.request.mock.calls.filter((v) => v[2] === 'POST')).toHaveLength(1);
  });
  it('serializes creation across windows for the same membership', async () => {
    const f = fixture();
    const first = f.api.claim(f.caller);
    await expect(f.api.claim({ ...f.caller, id: 2 })).rejects.toThrow('BUSY');
    await first;
    expect(f.request.mock.calls.filter((v) => v[2] === 'POST')).toHaveLength(1);
  });
  it.each(['owner', 'window'])('discards a late claim when the %s changes', async (kind) => {
    const f = fixture();
    f.request.mockImplementationOnce(async () => {
      if (kind === 'owner') f.revoke();
      else f.api.invalidate(1);
      return { instances: [] };
    });
    await expect(f.api.claim(f.caller)).rejects.toThrow('SCOPE_CHANGED');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('initializes only the owned device using the server-owned organization and reopens the same attempt', async () => {
    const f = fixture();
    f.setList([f.target]);
    expect(await f.api.initialize(f.caller, f.target.deviceId)).toBeUndefined();
    await f.api.initialize(f.caller, f.target.deviceId);
    expect(f.request.mock.calls.filter((v) => v[2] === 'POST').map((v) => [v[1], v[3]])).toEqual([
      ['/instance-login/api/attempts', { instanceId: 'instance-a', org: 'example' }],
    ]);
    expect(f.openExternal).toHaveBeenCalledTimes(2);
    expect(new URL(f.openExternal.mock.calls[0][0]).origin).toBe('https://cis.example.test');
  });
  it('a browser opening failure retains the attempt for explicit retry', async () => {
    const f = fixture();
    f.setList([f.target]);
    f.openExternal.mockRejectedValueOnce(Error('private url'));
    await expect(f.api.initialize(f.caller, f.target.deviceId)).rejects.toThrow('UNAVAILABLE');
    await f.api.initialize(f.caller, f.target.deviceId);
    expect(f.request.mock.calls.filter((v) => v[2] === 'POST')).toHaveLength(1);
  });
  it('does not initialize an unknown device or an already initialized one', async () => {
    const f = fixture();
    f.setList([f.target]);
    await expect(f.api.initialize(f.caller, 'cloud-other')).rejects.toThrow('SCOPE_CHANGED');
    f.target.status.loginRequired = false;
    await f.api.initialize(f.caller, f.target.deviceId);
    expect(f.openExternal).not.toHaveBeenCalled();
    expect(f.request.mock.calls.every((v) => v[2] === 'GET')).toBe(true);
  });
  it.each([
    'https://evil.example/instance-login/#attemptId=x',
    '/instance-login/#attemptId=invalid&attemptSecret=invalid',
    `/instance-login/#attemptId=${attemptId}&attemptSecret=${secret}&redirect=https://evil.example`,
    `/instance-login/#attemptId=${attemptId}&attemptId=${attemptId}`,
  ])('rejects an invalid continuation without opening a browser', async (continueUrl) => {
    const f = fixture();
    f.setList([f.target]);
    f.request
      .mockResolvedValueOnce({ instances: [f.target] })
      .mockResolvedValueOnce({ continueUrl });
    await expect(f.api.initialize(f.caller, f.target.deviceId)).rejects.toThrow('INVALID_RESPONSE');
    expect(f.openExternal).not.toHaveBeenCalled();
  });
  it('never opens an authorization after account invalidation', async () => {
    const f = fixture();
    f.setList([f.target]);
    f.request.mockResolvedValueOnce({ instances: [f.target] }).mockImplementationOnce(async () => {
      f.revoke();
      return { continueUrl: `/instance-login/#attemptId=${attemptId}&attemptSecret=${secret}` };
    });
    await expect(f.api.initialize(f.caller, f.target.deviceId)).rejects.toThrow('SCOPE_CHANGED');
    expect(f.openExternal).not.toHaveBeenCalled();
  });
  it('expires cached attempts and does not reuse them after invalidation', async () => {
    const f = fixture();
    f.setList([f.target]);
    await f.api.initialize(f.caller, f.target.deviceId);
    f.advance();
    await f.api.initialize(f.caller, f.target.deviceId);
    f.api.invalidate(1);
    await f.api.initialize(f.caller, f.target.deviceId);
    expect(f.request.mock.calls.filter((v) => v[2] === 'POST')).toHaveLength(3);
  });
  it.each(['duplicate', 'mismatch'])(
    'rejects a %s membership snapshot before a write',
    async (kind) => {
      const f = fixture();
      f.setList(kind === 'duplicate' ? [f.target, f.target] : [f.target]);
      if (kind === 'mismatch') f.target.status.instanceId = 'other';
      await expect(f.api.claim(f.caller)).rejects.toThrow('INVALID_RESPONSE');
      expect(f.request).toHaveBeenCalledTimes(1);
    },
  );
  it('IPC rejects renderer-supplied identity, image or login URL', async () => {
    const f = fixture(),
      handlers = cloudSettingsClientHandlers(createCloudSettingsService(f.deps));
    for (const value of [{ instanceId: 'other' }, { image: 'other' }, { membershipId: 'other' }])
      await expect(handlers.instanceClaim(f.caller, value)).rejects.toThrow('INVALID_PARAMS');
    await expect(
      handlers.instanceInitialize(f.caller, {
        deviceId: f.target.deviceId,
        org: 'other',
        url: 'https://evil.example',
      }),
    ).rejects.toThrow('INVALID_PARAMS');
    expect(f.request).not.toHaveBeenCalled();
  });
});
