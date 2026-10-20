// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSettingsView } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import { createCloudSettingsClient } from '../client';
import { CloudInstancesSection } from '../CloudInstancesSection';
const state = vi.hoisted(() => ({
  online: true,
  deviceId: 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa',
}));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ mode: 'cloud', dataOwnerId: 'owner-a' }),
}));
vi.mock('@/contexts/dataOwnerGeneration', () => ({
  getDataOwnerGeneration: () => ({ generation: 1 }),
  isDataOwnerGenerationCurrent: () => true,
}));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: () => [
    {
      deviceId: state.deviceId,
      name: 'Cloud A',
      isSelf: false,
      online: state.online,
      remoteControlEnabled: false,
      controlEnabled: false,
    },
  ],
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('../client', () => ({ createCloudSettingsClient: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.online = true;
});
it('uses the Main bridge even if device-link remote control is disabled', async () => {
  const bridge = {},
    client = createTrialCloudSettingsClient();
  Object.assign(window, { electronAPI: { cloudSettings: bridge } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  const connect = vi.spyOn(client, 'connect');
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  await waitFor(() => expect(connect).toHaveBeenCalled());
  expect(createCloudSettingsClient).toHaveBeenCalledWith(
    state.deviceId,
    bridge,
    expect.any(Function),
  );
  expect(screen.queryByText('cloudSettings.offline')).toBeNull();
});
it('does not connect or wake an offline instance', async () => {
  state.online = false;
  const client = createTrialCloudSettingsClient();
  Object.assign(window, { electronAPI: { cloudSettings: {} } });
  vi.mocked(createCloudSettingsClient).mockReturnValue(client);
  const connect = vi.spyOn(client, 'connect');
  render(
    <MemoryRouter initialEntries={[`/cloud-settings?deviceId=${state.deviceId}`]}>
      <CloudSettingsView />
    </MemoryRouter>,
  );
  expect(connect).not.toHaveBeenCalled();
});
it('redirects the old list route into Settings and reads owned instances without creating one', async () => {
  state.deviceId = 'local-device';
  const bridge = {
    instanceList: vi.fn().mockResolvedValue([]),
    instanceClaim: vi.fn(),
    instanceInitialize: vi.fn(),
  };
  Object.assign(window, { electronAPI: { cloudSettings: bridge } });
  try {
    render(
      <MemoryRouter initialEntries={['/cloud-settings']}>
        <Routes>
          <Route path="/cloud-settings" element={<CloudSettingsView />} />
          <Route path="/settings" element={<CloudInstancesSection />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'cloudSettings.onboarding.claim' });
    expect(bridge.instanceList).toHaveBeenCalledExactlyOnceWith({});
    expect(bridge.instanceClaim).not.toHaveBeenCalled();
    expect(createCloudSettingsClient).not.toHaveBeenCalled();
  } finally {
    state.deviceId = 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa';
  }
});
