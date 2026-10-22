import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture } from './fixture';
import { CLOUD_CLIENT_CHANNELS, type CloudClientOpen } from '../../../shared/cloudSettingsClient';

const mock = vi.hoisted(() => ({
  handle: vi.fn(),
  quit: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
  pending: false,
  owner: 'member-a',
  mode: 'cloud',
  generation: 1,
  member: 'member-a',
  authenticated: true,
  token: 'invalid-test-token',
  realm: 'cn',
  device: 'controller-a',
  baseUrl: 'https://cis.example.test',
  authChanged: undefined as (() => void) | undefined,
  off: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { once: mock.quit },
  ipcMain: { handle: mock.handle },
  net: { fetch: mock.fetch },
}));
vi.mock('../../authManager', () => ({
  peekCommittedAuthIdentity: () => ({ isAuthenticated: mock.authenticated, userId: mock.member }),
  getAccessToken: () => mock.token,
  getActiveAuthRealm: () => mock.realm,
  getDeviceId: () => mock.device,
  onAuthStateChange: (callback: () => void) => {
    mock.authChanged = callback;
    return mock.off;
  },
}));
vi.mock('../../appSessionState', () => ({
  isAppSessionBoundaryPending: () => mock.pending,
  peekCommittedAppSession: () => ({
    mode: mock.mode,
    dataOwnerId: mock.owner,
    generation: mock.generation,
  }),
}));
vi.mock('../../clientEndpointsService', () => ({ getClientEndpointForRealm: () => mock.baseUrl }));
vi.mock('../../security/trustedAppRenderer', () => ({
  assertTrustedAppRendererEvent: (event: { trusted: boolean }) => {
    if (!event.trusted) throw Error('PERMISSION_DENIED');
  },
}));
let f: ReturnType<typeof fixture>;
let sender: EventEmitter & { id: number };
let event: { sender: typeof sender; trusted: boolean };
function call(key: 'open', payload: unknown): Promise<CloudClientOpen>;
function call(
  key: Exclude<keyof typeof CLOUD_CLIENT_CHANNELS, 'open'>,
  payload: unknown,
): Promise<unknown>;
function call(key: keyof typeof CLOUD_CLIENT_CHANNELS, payload: unknown): Promise<unknown> {
  const handler = mock.handle.mock.calls.find(([name]) => name === CLOUD_CLIENT_CHANNELS[key])![1];
  return Promise.resolve().then(() => handler(event, payload));
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(mock, {
    pending: false,
    owner: 'member-a',
    mode: 'cloud',
    generation: 1,
    member: 'member-a',
    authenticated: true,
    token: 'invalid-test-token',
    realm: 'cn',
    device: 'controller-a',
    baseUrl: 'https://cis.example.test',
  });
  f = fixture();
  sender = Object.assign(new EventEmitter(), { id: 1 });
  event = { sender, trusted: true };
  mock.fetch.mockImplementation(async (url, init) => {
    const output = await f.request(
      f.identity(),
      new URL(String(url)).pathname,
      init!.method!,
      init!.body ? JSON.parse(String(init!.body)) : undefined,
      init!.signal!,
      () => {},
    );
    return output === undefined ? new Response(null, { status: 204 }) : Response.json(output);
  });
  (await import('../runtime')).registerCloudSettingsClientIpc();
});
afterEach(() => {
  mock.quit.mock.calls.find(([name]) => name === 'before-quit')?.[1]();
  f.stop();
  vi.useRealTimers();
});
it('registers the closed bridge once and rejects untrusted IPC before network access', async () => {
  (await import('../runtime')).registerCloudSettingsClientIpc();
  expect(mock.handle).toHaveBeenCalledTimes(Object.keys(CLOUD_CLIENT_CHANNELS).length);
  event.trusted = false;
  await expect(call('open', { deviceId: 'cloud-a' })).rejects.toThrow('PERMISSION_DENIED');
  await expect(
    call('instanceUpgrade', {
      deviceId: 'cloud-a',
      requestId: '33333333-3333-4333-8333-333333333333',
    }),
  ).rejects.toThrow('PERMISSION_DENIED');
  expect(mock.fetch).not.toHaveBeenCalled();
});
it.each(['signed-out', 'local', 'mismatch', 'boundary'])(
  'refuses a %s committed identity without reading any cloud settings',
  async (condition) => {
    if (condition === 'boundary') mock.pending = true;
    else if (condition === 'mismatch') mock.member = 'other-member';
    else mock.mode = condition;
    await expect(call('open', { deviceId: 'cloud-a' })).rejects.toThrow('SCOPE_CHANGED');
    expect(mock.fetch).not.toHaveBeenCalled();
  },
);
it.each(['realm', 'owner', 'generation', 'device', 'endpoint'])(
  'invalidates a handle on %s changes',
  async (condition) => {
    const { handle } = await call('open', { deviceId: 'cloud-a' });
    if (condition === 'realm') mock.realm = 'global';
    else if (condition === 'owner') {
      mock.owner = 'member-b';
      mock.member = 'member-b';
    } else if (condition === 'generation') mock.generation++;
    else if (condition === 'device') mock.device = 'controller-b';
    else mock.baseUrl = 'https://other.example.test';
    mock.authChanged!();
    const count = mock.fetch.mock.calls.length;
    await expect(call('read', { handle, domains: ['memory'] })).rejects.toThrow('SCOPE_CHANGED');
    expect(mock.fetch).toHaveBeenCalledTimes(count);
  },
);
it('same-owner token renewal keeps the handle and uses the new token', async () => {
  const { handle } = await call('open', { deviceId: 'cloud-a' });
  mock.token = 'rotated-test-token';
  mock.authChanged!();
  await call('read', { handle, domains: ['memory'] });
  expect(mock.fetch.mock.calls.at(-1)![1]!.headers).toMatchObject({
    Authorization: 'Bearer rotated-test-token',
  });
});
it('renews only an open cloud settings handle and stops after closing it', async () => {
  const { handle } = await call('open', { deviceId: 'cloud-a' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mock.fetch.mock.calls.at(-1)![0]).toMatch(/\/heartbeat$/);
  expect(mock.fetch.mock.calls.at(-1)![1]!.credentials).toBe('omit');
  await call('close', { handle });
  const count = mock.fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mock.fetch).toHaveBeenCalledTimes(count);
});
it.each([401, 403, 409])(
  'discards a session after heartbeat HTTP %s without resubmitting any setting',
  async (status) => {
    const { handle } = await call('open', { deviceId: 'cloud-a' });
    mock.fetch.mockResolvedValueOnce(new Response(null, { status }));
    await vi.advanceTimersByTimeAsync(30_000);
    const count = mock.fetch.mock.calls.length;
    await expect(call('read', { handle, domains: ['memory'] })).rejects.toThrow('SCOPE_CHANGED');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mock.fetch).toHaveBeenCalledTimes(count);
    expect(f.history).toEqual([]);
  },
);
it('a temporary heartbeat outage allows recovery but never retries a configuration write', async () => {
  const { handle } = await call('open', { deviceId: 'cloud-a' });
  mock.fetch.mockRejectedValueOnce(Error('fixture network outage'));
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mock.fetch.mock.calls.filter(([url]) => String(url).endsWith('/heartbeat'))).toHaveLength(
    2,
  );
  await expect(call('read', { handle, domains: ['memory'] })).resolves.toBeDefined();
  expect(
    f.history.every((command) => command.kind === 'read' || command.kind === 'readBatch'),
  ).toBe(true);
});
it.each(['destroyed', 'render-process-gone', 'navigation'])(
  'invalidates handles after renderer %s',
  async (type) => {
    const { handle } = await call('open', { deviceId: 'cloud-a' });
    if (type === 'navigation')
      sender.emit('did-start-navigation', {}, 'https://other.example.test', false, true);
    else sender.emit(type);
    const count = mock.fetch.mock.calls.length;
    await expect(call('read', { handle, domains: ['memory'] })).rejects.toThrow('SCOPE_CHANGED');
    expect(mock.fetch).toHaveBeenCalledTimes(count);
  },
);
