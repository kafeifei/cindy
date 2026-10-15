// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LinkStatus = 'stopped' | 'connecting' | 'online';
type Directory = { devices: DeviceLinkDeviceView[] };

function device(overrides: Partial<DeviceLinkDeviceView> = {}): DeviceLinkDeviceView {
  return {
    deviceId: 'cloud-test', name: 'Cloud Cindy', platform: 'linux',
    appVersion: '0.0.0-test', lastSeenAt: null, busy: false,
    online: false, remoteControlEnabled: false, controlEnabled: true, isSelf: false,
    ...overrides,
  };
}

function bridge() {
  const statuses = new Set<(payload: { status: LinkStatus }) => void>();
  const presences = new Set<(payload: DeviceLinkPresenceSnapshot) => void>();
  const controls = new Set<() => void>();
  const listDevices = vi.fn<() => Promise<Directory>>();
  vi.stubGlobal('electronAPI', {
    deviceLink: {
      listDevices,
      getState: vi.fn().mockResolvedValue({ linkStatus: 'online' }),
      onStatusChanged: vi.fn((fn: (payload: { status: LinkStatus }) => void) => {
        statuses.add(fn); return () => statuses.delete(fn);
      }),
      onPresenceChanged: vi.fn((fn: (payload: DeviceLinkPresenceSnapshot) => void) => {
        presences.add(fn); return () => presences.delete(fn);
      }),
      onControlTargetChanged: vi.fn((fn: () => void) => {
        controls.add(fn); return () => controls.delete(fn);
      }),
    },
  });
  return {
    listDevices,
    status: (status: LinkStatus) => act(() => statuses.forEach((fn) => fn({ status }))),
    controls: () => act(() => controls.forEach((fn) => fn())),
    onlinePresence: () => act(() => presences.forEach((fn) => fn({
      deviceId: 'cloud-test', deviceName: 'Cloud Cindy', platform: 'linux',
      appVersion: '0.0.0-test', lastSeenAt: 1000, online: true,
      remoteControlEnabled: true, busy: false,
    }))),
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function deferred() {
  let resolve!: (value: Directory) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Directory>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('new-task device picker recovery', () => {
  it('refreshes a stale offline row on relay reconnect without a new presence event', async () => {
    const api = bridge();
    api.listDevices.mockResolvedValueOnce({ devices: [device()] })
      .mockResolvedValue({ devices: [device({ online: true, remoteControlEnabled: true })] });
    const { useSelectableDevices } = await import('@/hooks/useControllableDevices');
    const { result } = renderHook(useSelectableDevices);
    await flush();
    expect(result.current.devices[0]?.online).toBe(false);
    api.status('online');
    await flush();
    expect(result.current.loaded).toBe(true);
    expect(result.current.devices[0]?.online).toBe(true);
  });

  it('retains cached rows on failure and retries without another push', async () => {
    const api = bridge();
    api.listDevices.mockResolvedValueOnce({ devices: [device()] })
      .mockRejectedValueOnce(new Error('temporary directory failure'))
      .mockResolvedValue({ devices: [device({ online: true, remoteControlEnabled: true })] });
    const { useSelectableDevices } = await import('@/hooks/useControllableDevices');
    const { result } = renderHook(useSelectableDevices);
    await flush();
    api.onlinePresence();
    await flush();
    expect(result.current.loaded).toBe(false);
    expect(result.current.devices[0]?.online).toBe(false);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(result.current.loaded).toBe(true);
    expect(result.current.devices[0]?.online).toBe(true);
  });

  it('shares one authoritative directory with the sidebar and keeps another peer usable', async () => {
    const api = bridge();
    const mac = device({ deviceId: 'peer-mac', name: 'Mac', platform: 'darwin',
      online: true, remoteControlEnabled: true });
    api.listDevices.mockResolvedValueOnce({ devices: [device(), mac] })
      .mockResolvedValue({ devices: [device({ online: true, remoteControlEnabled: true }), mac] });
    const { useSelectableDevices } = await import('@/hooks/useControllableDevices');
    const { useDeviceLinkDeviceList } = await import('@/features/device-link/useDeviceLinkDeviceList');
    const { result } = renderHook(() => ({
      picker: useSelectableDevices(), sidebar: useDeviceLinkDeviceList(),
    }));
    await flush();
    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(result.current.picker.devices.find((d) => d.deviceId === 'peer-mac')?.online).toBe(true);
    api.onlinePresence();
    await flush();
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(result.current.picker.devices.every((d) => d.online)).toBe(true);
    expect(result.current.sidebar?.every((d) => d.online)).toBe(true);
  });

  it('clears a stopped account and rejects its late directory response', async () => {
    const api = bridge();
    const pending = deferred();
    api.listDevices.mockResolvedValueOnce({ devices: [device()] })
      .mockReturnValueOnce(pending.promise);
    const { useSelectableDevices } = await import('@/hooks/useControllableDevices');
    const { result } = renderHook(useSelectableDevices);
    await flush();
    api.controls();
    await flush();
    api.status('stopped');
    await flush();
    expect(result.current.devices).toEqual([]);
    pending.resolve({ devices: [device({ online: true, remoteControlEnabled: true })] });
    await flush();
    expect(result.current.devices).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });

  it.each(['resolve', 'reject'] as const)('ignores a superseded response that later %ss', async (finish) => {
    const api = bridge();
    const old = deferred();
    api.listDevices.mockReturnValueOnce(old.promise).mockResolvedValue({ devices: [] });
    const { useSelectableDevices } = await import('@/hooks/useControllableDevices');
    const { result } = renderHook(useSelectableDevices);
    await flush();
    api.controls();
    await flush();
    expect(result.current).toEqual({ devices: [], loaded: true });
    if (finish === 'resolve') old.resolve({ devices: [device()] });
    else old.reject(new Error('superseded failure'));
    await flush();
    expect(result.current).toEqual({ devices: [], loaded: true });
  });

  it('does not treat a failed first read as an authoritative empty directory', async () => {
    const api = bridge();
    api.listDevices.mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue({ devices: [] });
    const { useSelectableDevices } = await import('@/hooks/useControllableDevices');
    const { result } = renderHook(useSelectableDevices);
    await flush();
    expect(result.current).toEqual({ devices: [], loaded: false });
    api.controls();
    await flush();
    expect(result.current).toEqual({ devices: [], loaded: true });
  });
});
