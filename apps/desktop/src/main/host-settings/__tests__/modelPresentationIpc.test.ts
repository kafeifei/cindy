import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  createModelPresentationPreferencesHandlers,
  registerModelPresentationPreferencesIpc,
} from '../model-presentation-preferences-ipc';
import { createModelPresentationPreferencesApi } from '../../../preload/modelPresentationPreferences';
import {
  emptyModelPresentationPreferences,
  MODEL_PRESENTATION_CHANNELS,
} from '../../../shared/modelPresentationPreferences';
import type { BrowserWindow, IpcMainInvokeEvent, IpcRenderer } from 'electron';
import { markAppContentWindow } from '../../windowFocusClassifier';
interface TestWindow {
  destroyed: boolean;
  isDestroyed(): boolean;
  webContents: {
    id: number;
    session: object;
    mainFrame: { url: string; parent: null };
    isDestroyed(): boolean;
    send: ReturnType<typeof vi.fn>;
  };
}
const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, raw?: unknown) => unknown>(),
  windows: new Map<number, TestWindow>(),
  access: new Map<number, 'read' | 'write'>(),
  viewers: new Set<number>(),
  partition: {},
  getOwner: vi.fn(),
  assertOwner: vi.fn(),
  inspect: vi.fn(),
  mutate: vi.fn(),
  importLegacy: vi.fn(),
  persist: vi.fn(),
  beforeCommit: null as (() => void) | null,
  changed: null as (() => void) | null,
}));
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: (sender: { id: number }) => native.windows.get(sender.id) ?? null,
    getAllWindows: () => [...native.windows.values()],
  },
  session: { defaultSession: native.partition },
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, raw?: unknown) => unknown) =>
      native.handlers.set(channel, handler),
  },
}));
vi.mock('../../security/trustedAppRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../security/trustedAppRenderer')>();
  const location = {
    devServerUrl: 'https://renderer.example.test/',
    packagedRendererFile: '/synthetic-renderer/index.html',
  };
  return {
    assertTrustedAppRendererEvent: (event: IpcMainInvokeEvent) => {
      if (!actual.isTrustedAppRendererEventForLocation(event, location))
        throw new Error('PERMISSION_DENIED');
    },
    isTrustedTopLevelCindyRendererEvent: (event: IpcMainInvokeEvent) =>
      actual.isTrustedTopLevelCindyRendererEventForLocation(event, location),
    isTrustedCindyRendererWindow: (win: BrowserWindow) =>
      actual.isTrustedCindyRendererWindowForLocation(win, location),
  };
});
vi.mock('../../remote-desktop-viewer/registry', () => ({
  isRemoteDesktopViewer: (id: number) => native.viewers.has(id),
}));
vi.mock('../personalization', () => ({
  currentSettingsOwner: native.getOwner,
  assertSettingsOwner: native.assertOwner,
}));
vi.mock('../model-presentation-preferences', () => ({
  inspectModelPresentationPreferences: native.inspect,
  importLegacyModelPresentationPreferences: native.importLegacy,
  mutateModelPresentationPreferences: native.mutate,
  onModelPresentationPreferencesChanged: (listener: () => void) => { native.changed = listener; },
}));
const stamp = { dataOwnerId: 'owner-a', ownerGeneration: 1 };
function setup() {
  const event = { sender: { id: 2 } } as IpcMainInvokeEvent;
  const inspect = vi.fn(() => ({
    status: 'ready' as const,
    initialized: true,
    ownerStamp: stamp,
    revision: 'revision',
    value: emptyModelPresentationPreferences(),
  }));
  const mutate = vi.fn(async (_raw, assert?: () => void) => {
    assert?.();
    return { snapshot: inspect() };
  });
  const importLegacy = vi.fn(async (_raw, assert?: () => void) => {
    assert?.();
    return inspect();
  });
  const assertLocal = vi.fn((input: IpcMainInvokeEvent) => {
    if (input !== event) throw new Error('untrusted/remote');
  });
  const assertOwner = vi.fn();
  const handlers = createModelPresentationPreferencesHandlers({
    assertLocal,
    getOwner: () => stamp,
    assertOwner,
    inspect,
    mutate,
    importLegacy,
  });
  return { handlers, inspect, mutate, importLegacy, assertLocal, assertOwner, event };
}
describe('native model preference IPC', () => {
  it('trusted top-level local sender is required for reads and writes; remote cannot import', async () => {
    const { handlers, event, inspect, mutate } = setup();
    expect(handlers.get(event).status).toBe('ready');
    expect(() => handlers.get({} as IpcMainInvokeEvent)).toThrow();
    expect(() =>
      handlers.mutate({} as IpcMainInvokeEvent, {
        ownerStamp: stamp,
        expectedRevision: 'revision',
        operation: { kind: 'reset' },
      }),
    ).toThrow();
    expect(() => handlers.importLegacy({} as IpcMainInvokeEvent, {})).toThrow();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
  it.each([
    {
      ownerStamp: { ...stamp, ownerGeneration: 0 },
      expectedRevision: 'revision',
      operation: { kind: 'reset' },
    },
    { ownerStamp: stamp, expectedRevision: '', operation: { kind: 'reset' } },
    {
      ownerStamp: stamp,
      expectedRevision: 'revision',
      operation: { kind: 'engine-set', providerId: 'p', modelId: 'm', agent: 'orca' },
    },
    { ownerStamp: stamp, expectedRevision: 'revision', operation: { kind: 'reset', extra: true } },
    {
      ownerStamp: stamp,
      expectedRevision: 'revision',
      operation: { kind: 'reset' },
      remoteDeviceId: 'controller',
    },
  ])('rejects forged owner, unknown shape, enums and remote hints before side effects', (raw) => {
    const { handlers, event, mutate } = setup();
    expect(() => handlers.mutate(event, raw)).toThrow();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('checks caller again in commit and sanitizes storage error details', async () => {
    const { handlers, event, mutate, assertLocal, assertOwner } = setup();
    await handlers.mutate(event, {
      ownerStamp: stamp,
      expectedRevision: 'revision',
      operation: { kind: 'reset' },
    });
    expect(assertLocal).toHaveBeenCalledTimes(3);
    expect(assertOwner).toHaveBeenCalledTimes(2);
    mutate.mockRejectedValueOnce(new Error('private/user/path secret-token'));
    const error = await handlers
      .mutate(event, {
        ownerStamp: stamp,
        expectedRevision: 'revision',
        operation: { kind: 'reset' },
      })
      .catch((e) => e);
    expect(error.message).toContain('PRECONDITION_FAILED');
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain('/path');
  });
  it('preload exposes fixed local channels and drops Electron event objects', async () => {
    let callback!: (...args: unknown[]) => void;
    const ipc = {
      invoke: vi.fn(async () => ({})),
      on: vi.fn((_channel, cb) => {
        callback = cb;
      }),
      removeListener: vi.fn(),
    };
    const api = createModelPresentationPreferencesApi(ipc as unknown as IpcRenderer);
    await api.get();
    expect(ipc.invoke).toHaveBeenCalledWith(MODEL_PRESENTATION_CHANNELS.get);
    const listener = vi.fn();
    const off = api.onChanged(listener);
    callback({ privileged: true }, stamp);
    expect(listener).toHaveBeenCalledExactlyOnceWith(stamp);
    off();
    expect(ipc.removeListener).toHaveBeenCalledWith(MODEL_PRESENTATION_CHANNELS.changed, callback);
    expect(Object.keys(api).sort()).toEqual(['get', 'importLegacy', 'mutate', 'onChanged']);
  });
});

function windowEvent(id: number, options: {
  access?: 'read' | 'write' | 'none';
  appContent?: boolean;
  viewer?: boolean;
  otherPartition?: boolean;
  child?: boolean;
  url?: string;
} = {}): IpcMainInvokeEvent {
  const win: TestWindow = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    webContents: {
      id,
      session: options.otherPartition ? {} : native.partition,
      mainFrame: { url: options.url ?? 'https://renderer.example.test/', parent: null },
      isDestroyed: () => win.destroyed,
      send: vi.fn(),
    },
  };
  native.windows.set(id, win);
  if (options.appContent !== false) markAppContentWindow(win as unknown as BrowserWindow);
  const access = options.access ?? 'write';
  if (access !== 'none') native.access.set(id, access);
  if (options.viewer) native.viewers.add(id);
  const mainFrame = win.webContents.mainFrame;
  return {
    sender: win.webContents,
    senderFrame: options.child ? { url: mainFrame.url, parent: mainFrame } : mainFrame,
  } as unknown as IpcMainInvokeEvent;
}
const resetRequest = () => ({
  ownerStamp: stamp,
  expectedRevision: 'revision',
  operation: { kind: 'reset' },
});
const importRequest = () => ({
  ownerStamp: stamp,
  expectedRevision: 'revision',
  source: {
    visibility: {
      overrides: null,
      initialization: null,
      migrationComplete: false,
      defaultsMigration: false,
      localAdoption: false,
      legacy: null,
      local: { overrides: null, initialization: null },
    },
    engines: null,
    favorites: null,
    hasProviderHistory: false,
  },
});

describe('生产注册的模型偏好窗口授权', () => {
  beforeEach(() => {
    native.windows.clear();
    native.access.clear();
    native.viewers.clear();
    native.beforeCommit = null;
    native.persist.mockReset();
    native.getOwner.mockReset().mockReturnValue(stamp);
    native.assertOwner.mockReset().mockImplementation((expected) => {
      if (JSON.stringify(native.getOwner()) !== JSON.stringify(expected)) throw new Error('owner changed');
    });
    native.inspect.mockReset().mockImplementation(() => ({
      status: 'ready',
      initialized: true,
      ownerStamp: stamp,
      revision: 'revision',
      value: emptyModelPresentationPreferences(),
    }));
    native.mutate.mockReset().mockImplementation(async (_raw, check: () => void) => {
      native.beforeCommit?.();
      check();
      native.persist();
      return { snapshot: native.inspect() };
    });
    native.importLegacy.mockReset().mockImplementation(async (_raw, check: () => void) => {
      native.beforeCommit?.();
      check();
      native.persist();
      return native.inspect();
    });
    registerModelPresentationPreferencesIpc({
      isLocalWindow: (id, access) => {
        const win = native.windows.get(id);
        const allowed = native.access.get(id);
        return !!win && !win.destroyed && !!allowed && (access === 'read' || allowed === 'write');
      },
    });
  });

  it('已登记的主窗和副应用窗可读写，只读辅助窗只能读取', async () => {
    for (const id of [1, 2]) {
      const event = windowEvent(id);
      expect(native.handlers.get(MODEL_PRESENTATION_CHANNELS.get)!(event)).toMatchObject({ status: 'ready' });
      await native.handlers.get(MODEL_PRESENTATION_CHANNELS.mutate)!(event, resetRequest());
      await native.handlers.get(MODEL_PRESENTATION_CHANNELS.importLegacy)!(event, importRequest());
    }
    expect(native.persist).toHaveBeenCalledTimes(4);
    for (const appContent of [true, false]) {
      const event = windowEvent(appContent ? 3 : 4, { access: 'read', appContent });
      expect(native.handlers.get(MODEL_PRESENTATION_CHANNELS.get)!(event)).toMatchObject({ status: 'ready' });
      expect(() => native.handlers.get(MODEL_PRESENTATION_CHANNELS.mutate)!(event, resetRequest())).toThrow('PERMISSION_DENIED');
      expect(() => native.handlers.get(MODEL_PRESENTATION_CHANNELS.importLegacy)!(event, importRequest())).toThrow('PERMISSION_DENIED');
    }
    expect(native.persist).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['远控窗口，即使被误授写权限', { viewer: true }],
    ['不同 profile partition', { otherPartition: true }],
    ['同源子 frame', { child: true }],
    ['导航到外部网页', { url: 'https://untrusted.example.test/' }],
    ['未登记窗口伪造副窗 query', { access: 'none' as const, url: 'https://renderer.example.test/?secondaryWindow=1' }],
  ] as const)('%s不能读取、写入或导入', (_label, options) => {
    const event = windowEvent(99, options);
    expect(() => native.handlers.get(MODEL_PRESENTATION_CHANNELS.get)!(event)).toThrow('PERMISSION_DENIED');
    expect(() => native.handlers.get(MODEL_PRESENTATION_CHANNELS.mutate)!(event, resetRequest())).toThrow('PERMISSION_DENIED');
    expect(() => native.handlers.get(MODEL_PRESENTATION_CHANNELS.importLegacy)!(event, importRequest())).toThrow('PERMISSION_DENIED');
    expect(native.getOwner).not.toHaveBeenCalled();
    expect(native.inspect).not.toHaveBeenCalled();
    expect(native.mutate).not.toHaveBeenCalled();
    expect(native.importLegacy).not.toHaveBeenCalled();
    expect(native.persist).not.toHaveBeenCalled();
  });

  it.each(['mutate', 'importLegacy'] as const)('%s在提交前重新校验窗口权限、partition和身份', async (operation) => {
    const revoke = [
      () => native.access.set(1, 'read'),
      () => { native.windows.get(1)!.webContents.session = {}; },
      () => native.viewers.add(1),
      () => { native.windows.get(1)!.webContents.mainFrame.url = 'https://untrusted.example.test/'; },
      () => { native.windows.get(1)!.destroyed = true; },
      () => native.getOwner.mockReturnValue({ ...stamp, ownerGeneration: 2 }),
    ];
    for (const invalidation of revoke) {
      native.viewers.clear();
      native.getOwner.mockReturnValue(stamp);
      const event = windowEvent(1);
      native.beforeCommit = invalidation;
      await expect(native.handlers.get(MODEL_PRESENTATION_CHANNELS[operation])!(
        event, operation === 'mutate' ? resetRequest() : importRequest(),
      )).rejects.toThrow('PRECONDITION_FAILED');
    }
    expect(native.persist).not.toHaveBeenCalled();
  });

  it('变更通知只发给当前登记且同profile的可信读取窗口', () => {
    windowEvent(1);
    windowEvent(2);
    windowEvent(3, { access: 'read' });
    windowEvent(4, { access: 'read', appContent: false });
    windowEvent(5, { viewer: true });
    windowEvent(6, { otherPartition: true });
    windowEvent(7, { access: 'none', url: 'https://renderer.example.test/?secondaryWindow=1' });
    windowEvent(8, { url: 'https://untrusted.example.test/' });
    windowEvent(9);
    native.windows.get(9)!.destroyed = true;
    native.changed!();
    for (const [id, win] of native.windows) {
      if (id <= 4) expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(MODEL_PRESENTATION_CHANNELS.changed, stamp);
      else expect(win.webContents.send).not.toHaveBeenCalled();
    }
  });
});
