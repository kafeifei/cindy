// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudPluginAuthorization } from '../CloudPluginAuthorization';
import { createTrialCloudSettingsClient } from '../trial';
import { parsePendingPluginSetup } from '@/lib/pluginSetupSnapshot';
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
describe('cloud plugin authorization', () => {
  it.each(['trial-oauth', 'trial-secret', 'trial-connection'])(
    'uses a valid original Host card for %s without local settings access',
    async (pluginId) => {
      const client = createTrialCloudSettingsClient();
      const result = await client.plugins!({
        operation: 'start',
        operationId: crypto.randomUUID(),
        pluginId,
      });
      expect(result.kind).toBe('setup');
      if (result.kind === 'setup')
        expect(parsePendingPluginSetup(result.snapshot as object)?.ghost.id).toBe(pluginId);
    },
  );
  it('opens and cancels an original native OAuth card without calling local authorization', async () => {
    Object.assign(window, {
      electronAPI: new Proxy(
        {},
        {
          get() {
            throw Error('LOCAL_API_FORBIDDEN');
          },
        },
      ),
    });
    const client = createTrialCloudSettingsClient(),
      plugins = vi.spyOn(client, 'plugins');
    render(<CloudPluginAuthorization client={client} active online name="Cloud" trial />);
    const buttons = await screen.findAllByRole('button', {
      name: 'settings.providers.button.authorize',
    });
    fireEvent.click(buttons[0]);
    expect(await screen.findByRole('region', { name: 'OAuth' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'newChat.pluginSetup.cancel' }));
    await screen.findByText('cloudSettings.authPhase.cancelled');
    expect(plugins.mock.calls.filter(([c]) => c.operation === 'start')).toHaveLength(1);
    expect(plugins.mock.calls.some(([c]) => c.operation === 'cancel')).toBe(true);
  });
  it('recovers a lost reply by status without creating another authorization', async () => {
    const client = createTrialCloudSettingsClient();
    const original = client.plugins!.bind(client);
    const plugins = vi.spyOn(client, 'plugins').mockImplementation(async (command) => {
      const result = await original(command);
      if (command.operation === 'start') throw Error('LOST');
      return result;
    });
    render(<CloudPluginAuthorization client={client} active online name="Cloud" trial />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'settings.providers.button.authorize' }))[0],
    );
    fireEvent.click(await screen.findByRole('button', { name: 'cloudSettings.authCheck' }));
    await screen.findByText('cloudSettings.authPhase.waiting');
    expect(plugins.mock.calls.filter(([c]) => c.operation === 'start')).toHaveLength(1);
  });
});

it('custom settings preview never opens a local plugin or a real remote desktop', async () => {
  Object.assign(window, {
    electronAPI: new Proxy(
      {},
      {
        get() {
          throw Error('LOCAL_API_FORBIDDEN');
        },
      },
    ),
  });
  const client = createTrialCloudSettingsClient(),
    invoke = vi.spyOn(client, 'plugins');
  render(<CloudPluginAuthorization client={client} active online name="Cloud" trial />);
  fireEvent.click(await screen.findByRole('button', { name: 'cloudSettings.pluginSettings' }));
  await screen.findByText('cloudSettings.pluginSettingsTrial');
  expect(
    invoke.mock.calls.some(
      ([c]) => c.operation === 'open-settings' && c.pluginId === 'trial-custom',
    ),
  ).toBe(true);
});
it('GitHub CLI uses the original plugin card and never runs a controller shell', async () => {
  const client = createTrialCloudSettingsClient();
  const result = await client.plugins!({
    operation: 'start',
    operationId: crypto.randomUUID(),
    pluginId: 'cindy-github',
  });
  expect(result.kind).toBe('setup');
  if (result.kind === 'setup')
    expect(parsePendingPluginSetup(result.snapshot as object)?.ghost.id).toBe('cindy-github');
});
