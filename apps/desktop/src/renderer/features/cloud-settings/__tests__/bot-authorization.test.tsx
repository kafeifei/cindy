// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudBotAuthorization } from '../CloudBotAuthorization';
import { createTrialCloudSettingsClient } from '../trial';
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
describe('cloud IM authorization', () => {
  it.each(['Slack', 'Telegram', 'X', 'settings.wechatBot.title'])(
    'connects and cancels %s with cloud tickets and no local API',
    async (label) => {
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
      const props = { client, online: true, active: true, name: 'Cloud', trial: true };
      const view = render(<CloudBotAuthorization {...props} />);
      const toggle = await screen.findByRole('switch', { name: label });
      fireEvent.click(toggle);
      const complete = await screen.findByRole('button', {
        name: 'cloudSettings.authTrialComplete',
      });
      fireEvent.click(complete);
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
      expect(manage.mock.calls.filter(([c]) => c.operation === 'run')).toHaveLength(1);
      expect(manage.mock.calls[0][0]).toMatchObject({ section: 'bots' });
      view.rerender(<CloudBotAuthorization {...props} online={false} />);
      expect(toggle.matches(':disabled')).toBe(true);
    },
  );
});
