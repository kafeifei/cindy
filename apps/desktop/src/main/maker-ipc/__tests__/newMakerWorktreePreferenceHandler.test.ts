import { describe, expect, it, vi } from 'vitest';

import { MAKER_INVOKE } from '../channels';
import {
  registerNewMakerWorktreePreferenceHandler,
  type NewMakerWorktreePreferenceHandlerDeps,
} from '../newMakerWorktreePreferenceHandler';
import { IpcHarness } from './helpers/ipcHarness';

function createDeps(
  overrides: Partial<NewMakerWorktreePreferenceHandlerDeps> = {},
): NewMakerWorktreePreferenceHandlerDeps {
  return {
    isDeviceLinkInvoke: vi.fn(() => false),
    assertTrustedCaller: vi.fn(),
    savePreference: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('maker:apply-new-maker-worktree-pref IPC handler', () => {
  it('在校验或保存偏好前拒绝不可信的本机调用', async () => {
    const harness = new IpcHarness();
    const rejection = new Error('untrusted renderer');
    const deps = createDeps({
      assertTrustedCaller: vi.fn(() => {
        throw rejection;
      }),
    });
    registerNewMakerWorktreePreferenceHandler(harness, deps);

    await expect(
      harness.invoke(MAKER_INVOKE.APPLY_NEW_MAKER_WORKTREE_PREF, {
        worktreeEnabled: true,
      }),
    ).rejects.toBe(rejection);

    expect(deps.assertTrustedCaller).toHaveBeenCalledTimes(1);
    expect(deps.savePreference).not.toHaveBeenCalled();
  });

  it('retains the allowlisted device-link path without requiring an Electron sender', async () => {
    const harness = new IpcHarness();
    const deps = createDeps({
      isDeviceLinkInvoke: vi.fn(() => true),
    });
    registerNewMakerWorktreePreferenceHandler(harness, deps);

    await expect(
      harness.invoke(MAKER_INVOKE.APPLY_NEW_MAKER_WORKTREE_PREF, {
        worktreeEnabled: false,
      }),
    ).resolves.toBeUndefined();

    expect(deps.assertTrustedCaller).not.toHaveBeenCalled();
    expect(deps.savePreference).toHaveBeenCalledWith(false);
  });

  it('保存完成前不返回成功，落盘失败向调用方报告', async () => {
    const harness = new IpcHarness();
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    registerNewMakerWorktreePreferenceHandler(harness, createDeps({ savePreference: () => pending }));
    let completed = false;
    const result = harness.invoke(MAKER_INVOKE.APPLY_NEW_MAKER_WORKTREE_PREF, { worktreeEnabled: true }).finally(() => { completed = true; });
    await Promise.resolve(); expect(completed).toBe(false);
    reject(new Error('disk unavailable'));
    await expect(result).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('非法字段不能触发保存', async () => {
    const harness = new IpcHarness();
    const deps = createDeps();
    registerNewMakerWorktreePreferenceHandler(harness, deps);

    await expect(
      harness.invoke(MAKER_INVOKE.APPLY_NEW_MAKER_WORKTREE_PREF, {
        worktreeEnabled: 'yes',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

    expect(deps.assertTrustedCaller).toHaveBeenCalledTimes(1);
    expect(deps.savePreference).not.toHaveBeenCalled();
  });
});
