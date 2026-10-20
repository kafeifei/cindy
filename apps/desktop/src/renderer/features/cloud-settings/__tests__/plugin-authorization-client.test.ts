import { expect, it } from 'vitest';
import { fixture } from '../../../../main/cloud-settings-client/__tests__/fixture';
import { createCloudSettingsClient } from '../client';
import { cloudPluginCommandSchema } from '../../../../shared/cloudPluginAuthorization';
it('does not advertise a new cloud plugin resource that is not deployed', async () => {
  const f = fixture();
  try {
    const client = createCloudSettingsClient('cloud-a', f.bridge(), () => {});
    expect((await client.connect()).pluginAuthorization).toBeUndefined();
    expect(client.plugins).toBeUndefined();
    expect(f.history).toEqual([]);
  } finally {
    f.stop();
  }
});
it('the isolated plugin preview contract still rejects arbitrary credentials and commands', () => {
  expect(
    cloudPluginCommandSchema.safeParse({
      operation: 'start',
      pluginId: 'sample',
      command: 'shell',
      token: 'invalid-example',
    }).success,
  ).toBe(false);
});
