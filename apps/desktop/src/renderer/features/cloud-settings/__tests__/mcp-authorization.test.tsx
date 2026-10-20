// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudMcpAuthorization } from '../CloudMcpAuthorization';
import { createTrialCloudSettingsClient } from '../trial';
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
const props = { active: true, online: true, name: 'Cloud', trial: true };
async function setup() {
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
    manage = vi.spyOn(client, 'manage');
  const view = render(<CloudMcpAuthorization {...props} client={client} />);
  fireEvent.click(
    (await screen.findAllByRole('button', { name: 'cloudSettings.mcpCredentials' }))[0],
  );
  return {
    client,
    manage,
    view,
    token: screen.getByLabelText('settings.mcp.fields.token') as HTMLInputElement,
  };
}
describe('native cloud MCP credentials', () => {
  it('shows the native row and saved status, never reads existing secrets into the controller', async () => {
    const f = await setup();
    expect(f.token.value).toBe('');
    expect(screen.getByText('settings.mcp.fields.tokenSaved')).toBeTruthy();
    expect(screen.getByText('https://example.com/mcp')).toBeTruthy();
    expect(screen.getByText('X-API-Key')).toBeTruthy();
    expect(f.manage.mock.calls.filter(([c]) => c.operation !== 'list')).toHaveLength(0);
  });
  it('does not interpret blank token or closing the form as credential removal', async () => {
    const f = await setup();
    expect(
      screen.getAllByRole('button', { name: 'settings.mcp.save' })[0].matches(':disabled'),
    ).toBe(true);
    fireEvent.change(f.token, { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'cloudSettings.mcpCredentials' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'cloudSettings.mcpCredentials' })[0]);
    expect((screen.getByLabelText('settings.mcp.fields.token') as HTMLInputElement).value).toBe('');
    expect(f.manage.mock.calls.some(([c]) => c.operation === 'run')).toBe(false);
  });
  it('submits only the new token once, clears it and reads back the cloud state', async () => {
    const f = await setup();
    fireEvent.change(f.token, { target: { value: 'synthetic-secret' } });
    const save = screen.getAllByRole('button', { name: 'settings.mcp.save' })[0];
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByText('cloudSettings.authPhase.succeeded');
    expect(f.manage.mock.calls.filter(([c]) => c.operation === 'run')).toHaveLength(1);
    expect(f.manage.mock.calls.find(([c]) => c.operation === 'run')?.[0]).toMatchObject({
      values: { bearerToken: 'synthetic-secret' },
    });
    expect(f.token.value).toBe('');
    await waitFor(() =>
      expect(f.manage.mock.calls.filter(([c]) => c.operation === 'list').length).toBe(2),
    );
  });
  it('clears new input when leaving the category or losing the connection', async () => {
    const f = await setup();
    fireEvent.change(f.token, { target: { value: 'synthetic-secret' } });
    f.view.rerender(<CloudMcpAuthorization {...props} client={f.client} active={false} />);
    expect(screen.queryByLabelText('settings.mcp.fields.token')).toBeNull();
    f.view.rerender(<CloudMcpAuthorization {...props} client={f.client} online={false} />);
    expect(
      screen
        .getAllByRole('button', { name: 'cloudSettings.mcpCredentials' })
        .every((b) => b.matches(':disabled')),
    ).toBe(true);
  });
  it('uses status after a lost write response without resubmitting the credential', async () => {
    const f = await setup();
    f.manage.mockRestore();
    const base = f.client.manage!.bind(f.client);
    const spy = vi.spyOn(f.client, 'manage').mockImplementation(async (command) => {
      const result = await base(command);
      if (command.operation === 'run') throw Error('LOST');
      return result;
    });
    fireEvent.change(f.token, { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.mcp.save' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'cloudSettings.authCheck' }));
    await screen.findByText('cloudSettings.authPhase.succeeded');
    expect(spy.mock.calls.filter(([c]) => c.operation === 'run')).toHaveLength(1);
    expect(f.token.value).toBe('');
  });
});
