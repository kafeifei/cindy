import { expect, it, vi } from 'vitest';
import { CloudClientError, createCloudClientHttp } from '../transport';

const owner = {
  key: 'owner',
  generation: 1,
  baseUrl: 'https://cis.example.test/api',
  accessToken: 'invalid-test-token',
};
const signal = () => new AbortController().signal;

it('uses the configured HTTPS base and bearer without cookies, redirects or referrers', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  expect(
    await createCloudClientHttp(fetcher).request(
      owner,
      '/client/settings',
      'POST',
      { example: true },
      signal(),
      () => {},
    ),
  ).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([
    'https://cis.example.test/api/client/settings',
    expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-test-token', 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: '{"example":true}',
    }),
  ]);
});
it.each([
  'http://cis.example.test',
  'https://u:p@cis.example.test',
  'https://cis.example.test?token=x',
  'https://cis.example.test#fragment',
  'invalid',
])('refuses an invalid configured endpoint %s without sending credentials', async (baseUrl) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createCloudClientHttp(fetcher).request(
      { ...owner, baseUrl },
      '/client/settings',
      'GET',
      undefined,
      signal(),
      () => {},
    ),
  ).rejects.toThrow('NOT_READY');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['https://other.example.test', '//other.example.test', '/../credentials'])(
  'rejects an arbitrary transport path %s',
  async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createCloudClientHttp(fetcher).request(owner, path, 'GET', undefined, signal(), () => {}),
    ).rejects.toThrow('NOT_READY');
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it.each([
  [401, 'SCOPE_CHANGED'],
  [403, 'SCOPE_CHANGED'],
  [404, 'UNSUPPORTED'],
  [501, 'UNSUPPORTED'],
  [429, 'BUSY'],
  [500, 'UNAVAILABLE'],
] as const)('maps HTTP %s without leaking the response body or retrying', async (status, code) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('private-response-body', { status }));
  const error = (await createCloudClientHttp(fetcher)
    .request(owner, '/client/settings', 'POST', {}, signal(), () => {})
    .catch((e) => e)) as Error;
  expect(error.message).toBe(`CLOUD_SETTINGS_${code}`);
  expect(error.message).not.toContain('private');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('bounds streamed response size and cancels the reader', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(65537));
    },
    cancel,
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
  await expect(
    createCloudClientHttp(fetcher).request(
      owner,
      '/client/settings',
      'GET',
      undefined,
      signal(),
      () => {},
    ),
  ).rejects.toThrow('INVALID_RESPONSE');
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('rejects malformed JSON with a fixed public error', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-not-json'));
  await expect(
    createCloudClientHttp(fetcher).request(
      owner,
      '/client/settings',
      'GET',
      undefined,
      signal(),
      () => {},
    ),
  ).rejects.toThrow(/^CLOUD_SETTINGS_INVALID_RESPONSE$/);
});
it('drops a completed response after the owner boundary changes', async () => {
  let current = true;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    current = false;
    return Response.json({ secret: 'private' });
  });
  await expect(
    createCloudClientHttp(fetcher).request(
      owner,
      '/client/settings',
      'GET',
      undefined,
      signal(),
      () => {
        if (!current) throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
      },
    ),
  ).rejects.toThrow('SCOPE_CHANGED');
});
it('does not expose raw network exceptions', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error('Bearer invalid-test-token private-internal-host'));
  await expect(
    createCloudClientHttp(fetcher).request(
      owner,
      '/client/settings',
      'GET',
      undefined,
      signal(),
      () => {},
    ),
  ).rejects.toThrow(/^CLOUD_SETTINGS_UNAVAILABLE$/);
});
it('maps a maintenance PATCH conflict without treating it as a changed login', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private', { status: 409 }));
  await expect(
    createCloudClientHttp(fetcher).request(
      owner,
      '/instances/example/maintenance',
      'PATCH',
      {},
      signal(),
      () => {},
    ),
  ).rejects.toThrow('CLOUD_SETTINGS_CONFLICT');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('maps owner upgrade conflicts without claiming the account changed or leaking error details', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: 'NO_RELEASE_AVAILABLE', message: 'private' } },
        { status: 409 },
      ),
    );
  await expect(
    createCloudClientHttp(fetcher).request(
      owner,
      '/instances/owned/maintenance/upgrade',
      'POST',
      {},
      signal(),
      () => {},
    ),
  ).rejects.toThrow(/^CLOUD_SETTINGS_CONFLICT$/);
  expect(fetcher).toHaveBeenCalledOnce();
});
