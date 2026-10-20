import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudSettingsClient } from '../client';
import { fixture } from '../../../../main/cloud-settings-client/__tests__/fixture';
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
function setup() {
  const f = fixture();
  cleanups.push(f.stop);
  let owner = true;
  const bridge = f.bridge();
  const client = createCloudSettingsClient('cloud-a', bridge, () => {
    if (!owner) throw new Error('CLOUD_SETTINGS_SCOPE_CHANGED');
  });
  return {
    ...f,
    bridge,
    client,
    revokeUi: () => {
      owner = false;
    },
  };
}
describe('native CIS settings client using existing settingsWeb commands', () => {
  it('uses the verified instance, existing capabilities and batch reads', async () => {
    const f = setup();
    const cap = await f.client.connect();
    expect(cap.domains).toEqual(['memory']);
    expect(cap.cpuCount).toBe(4);
    expect(cap.pluginAuthorization).toBeUndefined();
    await f.client.read(['memory']);
    expect(f.history).toEqual([{ kind: 'readBatch', domains: ['memory'] }]);
    expect(f.request.mock.calls.every((c) => !c[1].includes('remote-resources'))).toBe(true);
  });
  it('saves with the original operation/revision and verifies readback', async () => {
    const f = setup(),
      [s] = await f.client.read(['memory']);
    const saved = await f.client.save(s, { maker: false });
    expect(saved.state.value?.maker).toBe(false);
    expect(f.history.find((c) => c.kind === 'update')).toMatchObject({
      change: { operationId: s.operationId, expectedRevision: 'r1', set: { maker: false } },
    });
    const reset = await f.client.save(saved.state, {}, ['maker']);
    expect(reset.state.customizedKeys).toEqual([]);
  });
  it('a lost save response queries the original request without resubmitting', async () => {
    const f = setup(),
      [s] = await f.client.read(['memory']);
    f.loseReply();
    expect((await f.client.save(s, { maker: false })).state.value?.maker).toBe(false);
    expect(f.history.filter((c) => c.kind === 'update')).toHaveLength(1);
    expect(f.request.mock.calls.some((c) => c[2] === 'GET' && c[1].includes('/requests/'))).toBe(
      true,
    );
  });
  it('unknown transport outcome uses the existing receipt before readback', async () => {
    const f = setup(),
      [s] = await f.client.read(['memory']);
    f.loseReply();
    f.unknown();
    expect((await f.client.save(s, { maker: false })).state.value?.maker).toBe(false);
    expect(f.history.filter((c) => c.kind === 'update')).toHaveLength(1);
    expect(f.history.filter((c) => c.kind === 'receipt')).toHaveLength(1);
  });
  it('rejects external revision changes without overwriting them', async () => {
    const f = setup(),
      [s] = await f.client.read(['memory']);
    f.externalChange();
    await expect(f.client.save(s, { maker: false })).rejects.toThrow('CONFLICT');
  });
  it.each(['owner', 'region', 'signout', 'ui'] as const)(
    'rejects stale access after %s changes',
    async (kind) => {
      const f = setup(),
        [s] = await f.client.read(['memory']);
      const count = f.request.mock.calls.length;
      if (kind === 'signout') f.setIdentity(null);
      else if (kind === 'ui') f.revokeUi();
      else f.setIdentity({ ...f.identity(), key: kind });
      await expect(f.client.save(s, { maker: false })).rejects.toThrow('SCOPE_CHANGED');
      expect(f.request).toHaveBeenCalledTimes(count);
    },
  );
  it('unsupported CIS never falls back to web cookies, resource invoke or local settings', async () => {
    const f = setup();
    f.unsupported();
    await expect(f.client.connect()).rejects.toThrow('UNSUPPORTED');
    expect(f.history).toEqual([]);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it.each([
    'shortcuts',
    'desktopGeneral',
    'appearance',
    'linuxWindow',
    'personalization',
    'gitSafety',
  ])('does not guess or write unsupported %s', async (domain) => {
    const f = setup();
    await f.client.connect();
    await expect(f.client.read([domain as never])).rejects.toThrow('UNSUPPORTED');
    expect(f.history).toEqual([]);
  });
  it('keeps the cloud target fixed even when the supplied display device is wrong', async () => {
    const f = setup();
    await expect(
      createCloudSettingsClient('cloud-other', f.bridge, () => {}).connect(),
    ).rejects.toThrow('SCOPE_CHANGED');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('discards a late open and closes the Main handle when the page was left', async () => {
    const f = setup();
    const original = f.bridge.open;
    let release!: () => void;
    f.bridge.open = vi.fn(async (input) => {
      const opened = await original(input);
      await new Promise<void>((r) => {
        release = r;
      });
      return opened;
    });
    const close = vi.spyOn(f.bridge, 'close');
    const loading = f.client.connect();
    const failed = expect(loading).rejects.toThrow('SCOPE_CHANGED');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.client.close();
    release();
    await failed;
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
  it('a fresh explicit connection cannot reuse the previous window ticket', async () => {
    const f = setup(),
      [s] = await f.client.read(['memory']);
    await f.client.reconnect();
    await expect(f.client.save(s, { maker: false })).rejects.toThrow('NOT_READY');
    expect(f.history.filter((c) => c.kind === 'update')).toHaveLength(0);
  });
});
