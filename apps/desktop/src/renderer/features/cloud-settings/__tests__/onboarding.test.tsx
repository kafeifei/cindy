// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CloudInstancesPage, type CloudInstancesApi } from '../CloudInstancesPage';
import type { CloudInstanceView } from '../../../../shared/cloudInstanceControl';
import zhCN from '@/i18n/locales/zh-CN/common.json';
import zhTW from '@/i18n/locales/zh-TW/common.json';
import en from '@/i18n/locales/en/common.json';
import ja from '@/i18n/locales/ja/common.json';
import ko from '@/i18n/locales/ko/common.json';
const confirmation = vi.hoisted(() => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => confirmation,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  confirmation.confirm.mockResolvedValue(true);
});
const resources = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko };
const target: CloudInstanceView = {
  instanceId: 'example-instance',
  deviceId: 'example-device',
  name: 'Cloud A',
  nameSequence: 1,
  desiredState: 'running',
  runtimeState: 'missing',
  ready: false,
  loginRequired: true,
  version: '0.1.108',
  imageId: null,
  latestVersion: '0.1.108',
  updateAvailable: false,
  upgradeState: 'idle',
  observedAtMs: null,
  maintenance: null,
};
async function setup(
  items: CloudInstanceView[] = [],
  locale: keyof typeof resources = 'zh-CN',
  fail = false,
) {
  const api = {
    instanceList: vi.fn<CloudInstancesApi['instanceList']>().mockResolvedValue(items),
    instanceClaim: vi.fn<CloudInstancesApi['instanceClaim']>().mockResolvedValue([target]),
    instanceInitialize: vi.fn<CloudInstancesApi['instanceInitialize']>().mockResolvedValue(),
    instancePower: vi.fn<CloudInstancesApi['instancePower']>().mockResolvedValue(),
  };
  if (fail) api.instanceList.mockRejectedValue(Error('read failed'));
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    resources: Object.fromEntries(
      Object.entries(resources).map(([lang, common]) => [lang, { translation: common }]),
    ),
  });
  const onOpen = vi.fn(),
    onBack = vi.fn(),
    onOpenDesktop = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <CloudInstancesPage
        api={api}
        onBack={onBack}
        onOpen={onOpen}
        onOpenDesktop={onOpenDesktop}
        canOpenDesktop={(instance) => instance.deviceId === 'example-device'}
      />
    </I18nextProvider>,
  );
  await waitFor(() => expect(api.instanceList).toHaveBeenCalledTimes(1));
  return { api, onOpen, onBack, onOpenDesktop, i18n, ...view };
}
it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'shows the empty state in %s without creating anything',
  async (lang) => {
    const f = await setup([], lang);
    await screen.findByRole('button', { name: resources[lang].cloudSettings.onboarding.claim });
    expect(f.container.textContent).not.toContain('cloudSettings.');
    expect(f.api.instanceClaim).not.toHaveBeenCalled();
    expect(f.api.instanceInitialize).not.toHaveBeenCalled();
  },
);
it('a failed read shows retry, never the claim action', async () => {
  const f = await setup([], 'zh-CN', true);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '领取云实例' })).toBeNull();
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
});
it('double clicking claim sends once, initializes only the returned device and shows progress', async () => {
  const f = await setup();
  const button = await screen.findByRole('button', { name: '领取云实例' });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByRole('button', { name: '重新打开登录页' });
  expect(f.api.instanceClaim).toHaveBeenCalledTimes(1);
  expect(f.api.instanceInitialize).toHaveBeenCalledExactlyOnceWith({ deviceId: 'example-device' });
  expect(screen.getByRole('list', { name: '领取进度' })).toBeTruthy();
  expect(f.onOpen).not.toHaveBeenCalled();
});
it('unknown creation blocks automatic resubmission until explicit reconciliation', async () => {
  const f = await setup();
  f.api.instanceClaim.mockRejectedValue(Error('unknown'));
  fireEvent.click(await screen.findByRole('button', { name: '领取云实例' }));
  const check = await screen.findByRole('button', { name: '检查领取结果' });
  expect((screen.getByRole('button', { name: '领取云实例' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  f.api.instanceList.mockResolvedValue([target]);
  fireEvent.click(check);
  await screen.findByRole('button', { name: '登录云端 Cindy' });
  expect(f.api.instanceClaim).toHaveBeenCalledTimes(1);
  expect(f.api.instanceInitialize).not.toHaveBeenCalled();
});
it('existing sleeping instances have a settings entry, never a claim or automatic wake', async () => {
  const f = await setup([{ ...target, loginRequired: false, desiredState: 'stopped' }]);
  const button = await screen.findByRole('button', { name: '实例设置' });
  expect(screen.queryByRole('button', { name: '领取云实例' })).toBeNull();
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(f.onOpen).toHaveBeenCalledWith('example-device');
});
it('login completion waits for runtime readiness before opening the settings', async () => {
  const f = await setup([target]);
  fireEvent.click(await screen.findByRole('button', { name: '登录云端 Cindy' }));
  await screen.findByRole('button', { name: '重新打开登录页' });
  f.api.instanceList.mockResolvedValue([{ ...target, loginRequired: false }]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.cloudSettings.reload }));
  await screen.findByText(zhCN.cloudSettings.instance.state.starting);
  expect(f.onOpen).not.toHaveBeenCalled();
  f.api.instanceList.mockResolvedValue([
    { ...target, loginRequired: false, ready: true, runtimeState: 'running' },
  ]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.cloudSettings.reload }));
  await waitFor(() => expect(f.onOpen).toHaveBeenCalledExactlyOnceWith('example-device'));
});

const running: CloudInstanceView = {
  ...target,
  loginRequired: false,
  ready: true,
  runtimeState: 'running',
};
const sleeping: CloudInstanceView = {
  ...running,
  desiredState: 'stopped',
  runtimeState: 'stopped',
  ready: false,
};

it('quick desktop opens only the selected ready instance and never changes its power state', async () => {
  const f = await setup([
    running,
    { ...running, deviceId: 'device-b', instanceId: 'b', name: 'Cloud B' },
  ]);
  const own = within(await screen.findByRole('region', { name: 'Cloud A' }));
  fireEvent.click(own.getByRole('button', { name: zhCN.remoteDesktop.title }));
  expect(f.onOpenDesktop).toHaveBeenCalledExactlyOnceWith(running);
  expect(
    (
      within(screen.getByRole('region', { name: 'Cloud B' })).getByRole('button', {
        name: zhCN.remoteDesktop.title,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it('canceling quick sleep preserves the instance and names the target in the confirmation', async () => {
  confirmation.confirm.mockResolvedValueOnce(false);
  const f = await setup([running]);
  fireEvent.click(await screen.findByRole('button', { name: '休眠' }));
  await waitFor(() => expect(confirmation.confirm).toHaveBeenCalledOnce());
  expect(confirmation.confirm.mock.calls[0][0].description).toContain('Cloud A');
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it('quick wake submits once for the selected instance and keeps stale list results disabled', async () => {
  const f = await setup([sleeping]);
  const wake = await screen.findByRole('button', { name: '唤醒' });
  fireEvent.click(wake);
  fireEvent.click(wake);
  await waitFor(() =>
    expect(f.api.instancePower).toHaveBeenCalledExactlyOnceWith({
      deviceId: 'example-device',
      action: 'wake',
    }),
  );
  await screen.findByText(zhCN.cloudSettings.instance.wakeSent);
  expect((wake as HTMLButtonElement).disabled).toBe(true);
  expect(confirmation.confirm).not.toHaveBeenCalled();
  f.api.instanceList.mockResolvedValue([running]);
  fireEvent.click(screen.getByRole('button', { name: zhCN.cloudSettings.reload }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '休眠' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
});

it('unknown power results are not retried or cleared by background refresh', async () => {
  const f = await setup([sleeping]);
  f.api.instancePower.mockRejectedValueOnce(Error('unconfirmed'));
  fireEvent.click(await screen.findByRole('button', { name: '唤醒' }));
  await screen.findByRole('alert');
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(f.api.instanceList.mock.calls.length).toBeGreaterThanOrEqual(3));
  expect(screen.getByRole('alert').textContent).toBe(zhCN.cloudSettings.instance.unconfirmed);
  fireEvent.click(screen.getByRole('button', { name: '唤醒' }));
  expect(f.api.instancePower).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: zhCN.cloudSettings.reload }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it.each(['starting', 'stopping', 'verifying'] as const)(
  'transition %s never permits quick power or desktop',
  async (state) => {
    const instance =
      state === 'starting'
        ? { ...running, ready: false, runtimeState: 'pending' }
        : state === 'stopping'
          ? { ...sleeping, runtimeState: 'running' }
          : { ...running, upgradeState: 'verifying' as const };
    const f = await setup([instance]);
    const region = within(await screen.findByRole('region', { name: 'Cloud A' }));
    expect(
      (
        region.getByRole('button', {
          name: state === 'stopping' ? '唤醒' : '休眠',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (region.getByRole('button', { name: zhCN.remoteDesktop.title }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(f.api.instancePower).not.toHaveBeenCalled();
  },
);

it('leaving while the sleep confirmation is open sends no power request', async () => {
  let finish!: (value: boolean) => void;
  confirmation.confirm.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const f = await setup([running]);
  fireEvent.click(await screen.findByRole('button', { name: '休眠' }));
  f.unmount();
  finish(true);
  await Promise.resolve();
  expect(f.api.instancePower).not.toHaveBeenCalled();
});

it.each(Object.keys(resources) as Array<keyof typeof resources>)(
  'quick actions and update summaries translate in %s',
  async (lang) => {
    const f = await setup([running], lang);
    await screen.findByText(resources[lang].cloudSettings.instance.noUpdate);
    expect(f.container.textContent).not.toContain('cloudSettings.');
    expect(
      screen.getByRole('button', { name: resources[lang].cloudSettings.instance.sleep }),
    ).toBeTruthy();
    expect(f.api.instancePower).not.toHaveBeenCalled();
  },
);
it('a late claim response after leaving does not initialize a cloud identity', async () => {
  const f = await setup();
  let resolve!: (value: CloudInstanceView[]) => void;
  f.api.instanceClaim.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  fireEvent.click(await screen.findByRole('button', { name: '领取云实例' }));
  f.unmount();
  resolve([target]);
  await Promise.resolve();
  expect(f.api.instanceInitialize).not.toHaveBeenCalled();
});
it('multiple owned instances require an explicit choice and do not auto-login', async () => {
  const f = await setup([
    target,
    {
      ...target,
      instanceId: 'b',
      deviceId: 'device-b',
      name: 'Cloud B',
      loginRequired: false,
      ready: true,
    },
  ]);
  fireEvent.click(await screen.findByRole('button', { name: '实例设置' }));
  expect(f.onOpen).toHaveBeenCalledWith('device-b');
  expect(f.api.instanceInitialize).not.toHaveBeenCalled();
  expect(f.api.instanceClaim).not.toHaveBeenCalled();
});

it('maintenance shortcut opens only the selected instance without changing its policy', async () => {
  const f = await setup([
    running,
    { ...running, deviceId: 'device-b', instanceId: 'b', name: 'Cloud B' },
  ]);
  fireEvent.click(
    within(await screen.findByRole('region', { name: 'Cloud B' })).getByRole('button', {
      name: '更新与维护',
    }),
  );
  expect(f.onOpen).toHaveBeenCalledExactlyOnceWith('device-b', 'maintenance');
  expect(f.api.instancePower).not.toHaveBeenCalled();
});
