// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { CloudInstanceSection } from '../CloudInstanceSection';
import { CloudSettingsPanel } from '../CloudSettingsView';
import { createTrialCloudSettingsClient } from '../trial';
import type {
  CloudInstanceView,
  CloudMaintenanceEdit,
  CloudUpgradeOperation,
} from '../../../../shared/cloudInstanceControl';
import zhCN from '@/i18n/locales/zh-CN/common.json';
import zhTW from '@/i18n/locales/zh-TW/common.json';
import en from '@/i18n/locales/en/common.json';
import ja from '@/i18n/locales/ja/common.json';
import ko from '@/i18n/locales/ko/common.json';
const mock = vi.hoisted(() => ({
  confirm: vi.fn<(input: { description?: string }) => Promise<boolean>>().mockResolvedValue(true),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({ useConfirmDialog: () => mock }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/device-link/useDeviceLinkDeviceList', () => ({
  useDeviceLinkDeviceList: vi.fn(),
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mock.confirm.mockResolvedValue(true);
});
const resources = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko };
async function setup({
  running = false,
  language = 'zh-CN',
  panel = false,
  custom = false,
  revision = false,
  focusMaintenance = false,
  manualUpgrade = false,
  version = '0.1.108',
  latestVersion = '0.1.108',
} = {}) {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: false,
    resources: Object.fromEntries(
      Object.entries(resources).map(([k, translation]) => [k, { translation }]),
    ),
  });
  const value: CloudInstanceView = {
    instanceId: 'instance-a',
    deviceId: 'cloud-a',
    name: 'Cloud A',
    nameSequence: 1,
    desiredState: running ? 'running' : 'stopped',
    runtimeState: running ? 'running' : 'stopped',
    ready: running,
    version,
    manualUpgrade,
    imageId: 'a'.repeat(64),
    latestVersion,
    updateAvailable: revision,
    upgradeState: 'idle',
    observedAtMs: 100,
    maintenance: {
      instanceId: 'instance-a',
      revision: 'a'.repeat(64),
      defaultsRevision: 1,
      autoUpdate: true,
      raw: {
        policyMode: custom ? 'custom' : 'inherit',
        calendar: null,
        scheduledTaskPolicy: 'protect',
        pausedUntilMs: null,
      },
      effective: {
        source: 'inherit',
        calendar: {
          timezone: 'Asia/Shanghai',
          windows: [
            {
              id: 'daily',
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              startLocal: '03:00',
              endLocal: '05:00',
            },
          ],
        },
      },
      executionMode: 'scheduled',
      nextEligibleAtMs: 10000,
      serverTimeMs: 100,
      windows: [],
    },
  };
  const client = Object.assign(createTrialCloudSettingsClient(), {
    instance: vi.fn(async () => structuredClone(value)),
    upgrade: vi.fn<() => Promise<CloudUpgradeOperation>>().mockImplementation(async () => {
      value.upgradeOperation = {
        operationId: 'user-example',
        phase: 'requested',
        active: true,
        updatedAtMs: 123,
      };
      return value.upgradeOperation;
    }),
    power: vi.fn<(action: 'wake' | 'sleep') => Promise<void>>().mockResolvedValue(undefined),
    maintenance: vi.fn(async (change: CloudMaintenanceEdit) => ({
      ...value.maintenance!,
      autoUpdate: change.autoUpdate,
      revision: 'b'.repeat(64),
    })),
  });
  const connect = vi.spyOn(client, 'connect'),
    changed = vi.fn();
  const tree = (active = true) => (
    <I18nextProvider i18n={i18n}>
      {panel ? (
        <CloudSettingsPanel client={client} name="Cloud A" online={false} onBack={vi.fn()} />
      ) : (
        <CloudInstanceSection
          client={client}
          name="Cloud A"
          active={active}
          changed={changed}
          focusMaintenance={focusMaintenance}
        />
      )}
    </I18nextProvider>
  );
  const rendered = render(tree());
  await screen.findByText(version);
  return { client, value, connect, changed, i18n, ...rendered, tree };
}
it('shows overview and explicit wake while offline without opening runtime settings', async () => {
  const f = await setup({ panel: true });
  expect(screen.getByRole('tab', { name: '云实例' }).getAttribute('aria-selected')).toBe('true');
  expect(f.connect).not.toHaveBeenCalled();
  expect(f.client.power).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '唤醒' }));
  await waitFor(() => expect(f.client.power).toHaveBeenCalledWith('wake'));
});
it('canceling sleep sends no write', async () => {
  mock.confirm.mockResolvedValueOnce(false);
  const f = await setup({ running: true });
  fireEvent.click(screen.getByRole('button', { name: '休眠' }));
  await waitFor(() => expect(mock.confirm).toHaveBeenCalled());
  expect(f.client.power).not.toHaveBeenCalled();
  expect(mock.confirm.mock.calls[0][0].description).toContain('Cloud A');
});
it('sleep requires confirmation and double clicks send only one request', async () => {
  const f = await setup({ running: true });
  let finish!: () => void;
  f.client.power.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const button = screen.getByRole('button', { name: '休眠' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(f.client.power).toHaveBeenCalledTimes(1));
  expect(mock.confirm).toHaveBeenCalledTimes(1);
  finish();
  await screen.findByText('已提交休眠，正在核对实例状态。');
});
it('does not retry uncertain power requests; explicit refresh is required', async () => {
  const f = await setup();
  f.client.power.mockRejectedValueOnce(Error('network'));
  fireEvent.click(screen.getByRole('button', { name: '唤醒' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '唤醒' }));
  expect(f.client.power).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('editing auto update does not write until save and does not wake the instance', async () => {
  const f = await setup();
  fireEvent.click(screen.getByRole('switch', { name: '自动更新云实例' }));
  expect(f.client.maintenance).not.toHaveBeenCalled();
  expect(f.client.power).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存维护设置' }));
  await waitFor(() =>
    expect(f.client.maintenance).toHaveBeenCalledWith({
      revision: 'a'.repeat(64),
      defaultsRevision: 1,
      autoUpdate: false,
      policyMode: 'inherit',
    }),
  );
  await screen.findByText('维护设置已保存。');
});
it('retains maintenance drafts across tab switches', async () => {
  const f = await setup({ panel: true });
  fireEvent.click(screen.getByRole('switch', { name: '自动更新云实例' }));
  fireEvent.click(screen.getByRole('tab', { name: zhCN.settings.tabs.general }));
  fireEvent.click(screen.getByRole('tab', { name: '云实例' }));
  await waitFor(() => expect(f.client.instance.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  expect(f.client.maintenance).not.toHaveBeenCalled();
});
it('conflicting saves retain edits and never silently overwrite the newer revision', async () => {
  const f = await setup();
  f.client.maintenance.mockRejectedValueOnce(Error('CLOUD_SETTINGS_CONFLICT'));
  fireEvent.click(screen.getByRole('switch'));
  fireEvent.click(screen.getByRole('button', { name: '保存维护设置' }));
  await screen.findByText('维护设置已在其他地方修改，请刷新后重新编辑。');
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '保存维护设置' }));
  expect(f.client.maintenance).toHaveBeenCalledTimes(1);
});
it('validates custom schedules before saving', async () => {
  const f = await setup({ custom: true });
  fireEvent.change(screen.getByLabelText('开始'), { target: { value: '04:45' } });
  fireEvent.click(screen.getByRole('button', { name: '保存维护设置' }));
  await screen.findByText('请检查时区、日期和时间：每段须为 1–6 小时，且不能重叠。');
  expect(f.client.maintenance).not.toHaveBeenCalled();
});
it('selects a timezone by searching its city and saves only its IANA identifier', async () => {
  const f = await setup({ custom: true });
  fireEvent.click(screen.getByRole('button', { name: '时区' }));
  const search = await screen.findByRole('combobox', { name: '搜索城市或时区…' });
  fireEvent.change(search, { target: { value: 'not-a-timezone' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(f.client.maintenance).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: '东京' } });
  expect(screen.getByRole('option').textContent).toContain('UTC+09:00');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByRole('button', { name: '时区' }).textContent).toContain('东京');
  expect(f.client.maintenance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存维护设置' }));
  await waitFor(() =>
    expect(f.client.maintenance).toHaveBeenCalledWith(
      expect.objectContaining({
        policyMode: 'custom',
        calendar: expect.objectContaining({ timezone: 'Asia/Tokyo' }),
      }),
    ),
  );
  expect(f.client.power).not.toHaveBeenCalled();
});
it('distinguishes a cloud revision from an identical version number', async () => {
  await setup({ revision: true });
  expect(screen.getByText('有新的云端修订')).toBeTruthy();
  expect(screen.queryByText('暂无可用更新')).toBeNull();
});
it.each(['zh-CN', 'zh-TW', 'en', 'ja', 'ko'])(
  'renders management controls in %s without untranslated keys',
  async (language) => {
    await setup({ language, custom: true });
    const strings = resources[language as keyof typeof resources].cloudSettings.instance;
    expect(screen.getByRole('button', { name: strings.wake })).toBeTruthy();
    expect(screen.getByRole('switch', { name: strings.autoUpdate })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: strings.timezone }));
    const search = await screen.findByRole('combobox', { name: strings.timezoneSearch });
    fireEvent.change(search, { target: { value: strings.timezoneCities.shanghai } });
    expect(screen.getByRole('option').textContent).toContain('Asia/Shanghai');
    expect(document.body.textContent).not.toContain('cloudSettings.');
  },
);

it('maintenance shortcut scrolls to the policy after loading, without changing it', async () => {
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const f = await setup({ focusMaintenance: true });
    await waitFor(() => expect(scroll).toHaveBeenCalledOnce());
    expect((scroll.mock.contexts[0] as HTMLElement).id).toBe('cloud-instance-maintenance');
    expect(f.client.maintenance).not.toHaveBeenCalled();
    expect(f.client.power).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});

it('requests an upgrade with auto-update disabled and preserves schedules without a modal', async () => {
  const f = await setup({
    running: true,
    revision: true,
    manualUpgrade: true,
    version: '0.1.108-cloud.2-cn-amd64',
    latestVersion: '0.1.108-cloud.10-cn-amd64',
  });
  f.value.maintenance!.autoUpdate = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await waitFor(() =>
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'),
  );
  expect(screen.getByText('0.1.108-cloud.10-cn-amd64')).toBeTruthy();
  const button = screen.getByRole('button', { name: '立即升级' });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText('升级已排队，等待任务空闲。');
  expect(f.client.upgrade).toHaveBeenCalledOnce();
  expect(f.client.power).not.toHaveBeenCalled();
  expect(f.client.maintenance).not.toHaveBeenCalled();
  expect(mock.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '休眠' }).hasAttribute('disabled')).toBe(true);
});
it.each(['stopped', 'no-release', 'old-server', 'draft', 'held', 'resource-change'])(
  'cannot submit an upgrade while %s',
  async (kind) => {
    const f = await setup({
      running: kind !== 'stopped',
      revision: kind !== 'no-release',
      manualUpgrade: kind !== 'old-server',
    });
    if (kind === 'draft') fireEvent.click(screen.getByRole('switch'));
    if (kind === 'held' || kind === 'resource-change') {
      if (kind === 'held')
        f.value.upgradeOperation = {
          operationId: 'user-held',
          phase: 'recovery-hold',
          active: true,
          updatedAtMs: 100,
        };
      else f.value.resourceChanging = true;
      fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '休眠' }).hasAttribute('disabled')).toBe(true),
      );
    }
    const button = screen.queryByRole('button', { name: '立即升级' });
    if (button) {
      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.click(button);
    }
    expect(f.client.upgrade).not.toHaveBeenCalled();
  },
);
it('does not resubmit an uncertain request and recovers persisted progress on explicit refresh', async () => {
  const f = await setup({ running: true, revision: true, manualUpgrade: true });
  f.client.upgrade.mockRejectedValueOnce(Error('CLOUD_SETTINGS_SAVE_UNCONFIRMED'));
  fireEvent.click(screen.getByRole('button', { name: '立即升级' }));
  await screen.findByText('尚未确认升级结果，请先刷新状态。请勿重复提交。');
  fireEvent.click(screen.getByRole('button', { name: '立即升级' }));
  expect(f.client.upgrade).toHaveBeenCalledOnce();
  f.value.upgradeOperation = {
    operationId: 'user-example',
    phase: 'backup-running',
    active: true,
    updatedAtMs: 200,
  };
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await screen.findByText('正在备份云实例…');
  expect(screen.queryByRole('alert')).toBeNull();
  f.value.upgradeOperation = { ...f.value.upgradeOperation, phase: 'completed', active: false };
  f.value.version = '0.1.108-cloud.10-cn-amd64';
  f.value.latestVersion = null;
  f.value.updateAvailable = false;
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await screen.findByText('云实例升级完成。');
  expect(screen.getByText('0.1.108-cloud.10-cn-amd64')).toBeTruthy();
  expect(screen.getByText('暂无可用更新')).toBeTruthy();
  expect(screen.getByRole('button', { name: '立即升级' }).hasAttribute('disabled')).toBe(true);
});
it.each(['zh-CN', 'zh-TW', 'en', 'ja', 'ko'])(
  'localizes the immediate upgrade action and queue in %s',
  async (language) => {
    const f = await setup({ running: true, revision: true, manualUpgrade: true, language });
    const strings = resources[language as keyof typeof resources].cloudSettings.instance;
    fireEvent.click(screen.getByRole('button', { name: strings.upgradeNow }));
    await screen.findByText(strings.upgradeQueued);
    expect(document.body.textContent).not.toContain('cloudSettings.');
    expect(f.client.upgrade).toHaveBeenCalledOnce();
  },
);
