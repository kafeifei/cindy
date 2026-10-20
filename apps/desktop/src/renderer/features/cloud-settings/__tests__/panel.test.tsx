// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudSettingsPanel } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import { SETTINGS_SEARCH_ENTRIES } from '@/components/settings/settingsSearchCatalog';
import { cloudSearchEntryAllowed } from '../search';
import { CLOUD_SETTINGS_DOMAINS } from '../../../../shared/cloudSettings';
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: vi.fn(),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
function setup() {
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
  const client = createTrialCloudSettingsClient();
  const save = vi.spyOn(client, 'save');
  render(<CloudSettingsPanel name="Cloud trial" client={client} online trial onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.personalization' }));
  return { client, save };
}
const ready = async (input: HTMLElement) =>
  waitFor(() => expect(input.matches(':disabled')).toBe(false));
const general = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.general' }));
  await screen.findByText('settings.agentResource.title');
  const input = within(document.querySelector('#settings-agent-resource')!).getByRole('spinbutton');
  await ready(input);
  return input;
};
describe('shared native cloud settings', () => {
  it('uses native blur submission, rejects intermediate invalid values, then resets the cloud default', async () => {
    const { save } = setup();
    const input = await general();
    for (const value of ['', '-1', '3.5', '99']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    }
    expect(save).not.toHaveBeenCalled();
    for (const [index, value] of ['6', '7'].entries()) {
      fireEvent.change(input, { target: { value } });
      expect(save).toHaveBeenCalledTimes(index);
      fireEvent.blur(input);
      await waitFor(() => expect(save).toHaveBeenCalledTimes(index + 1));
      await ready(input);
      expect((input as HTMLInputElement).value).toBe(value);
    }
    fireEvent.click(
      within(input.closest('section')!).getByRole('button', { name: 'settings.defaults.restore' }),
    );
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('4'));
  });
  it('applies the native balanced preset using target CPU count, in one cloud write', async () => {
    const { save } = setup();
    const input = await general();
    fireEvent.click(screen.getByRole('radio', { name: 'settings.agentResource.presets.balanced' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await ready(input);
    expect(save.mock.calls[0][1]).toEqual({
      maxConcurrentCommands: 4,
      processPriority: 'low',
      capToolchainThreads: true,
    });
    expect(
      screen
        .getByRole('radio', { name: 'settings.agentResource.presets.balanced' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
  it('retains the native prompt editor draft across categories without a write', async () => {
    const { save } = setup();
    const input = await screen.findByRole('textbox', {
      name: 'settings.personalization.ariaLabel',
    });
    fireEvent.change(input, { target: { value: 'cloud-only draft' } });
    await general();
    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.personalization' }));
    await ready(input);
    expect((input as HTMLTextAreaElement).value).toBe('cloud-only draft');
    expect(save).not.toHaveBeenCalled();
  });
  it('saves the prompt with the original button and retains uncertain edits without replay', async () => {
    const { save } = setup();
    const input = await screen.findByRole('textbox', {
      name: 'settings.personalization.ariaLabel',
    });
    save.mockRejectedValueOnce(Error('UNKNOWN'));
    fireEvent.change(input, { target: { value: 'unsure' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.personalization.save' }));
    await screen.findByText('cloudSettings.saveUnconfirmed');
    expect((input as HTMLTextAreaElement).value).toBe('unsure');
    expect(input.matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'cloudSettings.reload' }));
    await ready(input);
    expect(save).toHaveBeenCalledTimes(1);
    expect((input as HTMLTextAreaElement).value).toBe('unsure');
  });
  it('preserves the native memory dependency between Cindy and agent memory', async () => {
    const { save } = setup();
    await screen.findByText('settings.memory.title');
    const memory = document.querySelector<HTMLElement>(
      '#settings-search-target-personalization-memory',
    )!;
    const switches = within(memory).getAllByRole('switch');
    expect(switches[1].matches(':disabled')).toBe(true);
    expect(switches[2].matches(':disabled')).toBe(true);
    fireEvent.click(switches[0]);
    await ready(switches[0]);
    await waitFor(() => expect(switches[1].matches(':disabled')).toBe(false));
    expect(switches[3].matches(':disabled')).toBe(true);
    expect(save.mock.calls[0][1]).toEqual({ maker: false });
  });
  it('uses native slider keyboard interaction and debounce without local IPC', async () => {
    const { save } = setup();
    const slider = await screen.findByRole('slider', {
      name: 'settings.compaction.card.sliderAria',
    });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][1]).toEqual({ claudeCodeAutoCompactPct: 88 });
  });
  it('uses native search and filters unsupported local-only entries without removing navigation', async () => {
    setup();
    await screen.findByRole('textbox', { name: 'settings.personalization.ariaLabel' });
    const search = screen.getByRole('combobox', { name: 'settings.search.ariaLabel' });
    fireEvent.change(search, { target: { value: 'shortcuts' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getAllByRole('tab')).toHaveLength(9);
    expect(screen.getByRole('tab', { name: 'settings.tabs.providers' })).toBeTruthy();
    const allowed = SETTINGS_SEARCH_ENTRIES.filter((e) =>
      cloudSearchEntryAllowed(e, [...CLOUD_SETTINGS_DOMAINS], false),
    );
    expect(allowed.some((e) => e.id === 'settings.agentResource.preset')).toBe(true);
    for (const denied of [
      'general.appearance',
      'general.language',
      'general.composer',
      'personalization.linkOpen',
      'settings.promptRecommendation.label',
      'settings.computerUse.android.title',
      'settings.about.storage.cleanupLabel',
    ])
      expect(allowed.some((e) => e.id === denied)).toBe(false);
  });
  it('does not write any settings just by opening every supported category', async () => {
    const { save } = setup();
    await screen.findByRole('textbox', { name: 'settings.personalization.ariaLabel' });
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      await waitFor(() => expect(screen.queryByText('cloudSettings.loading')).toBeNull());
    }
    expect(save).not.toHaveBeenCalled();
  });
});
