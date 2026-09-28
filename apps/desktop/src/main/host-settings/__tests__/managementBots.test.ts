import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HookControlManager } from '../../hook-control/manager.js';
import type { ManagementExecution } from '../management.js';
import { configureCloudHookManagement, listOfficialBotManagement } from '../managementBots.js';
const caller = { key: 'isolated-cloud-owner', assertCurrent() {} };
afterEach(() => vi.useRealTimers());
function setup() {
  const view: any = {
    url: 'https://hook.example.invalid',
    enabled: true,
    serverMultiTeam: true,
    bindings: [
      { teamId: 'team-a', slackUserId: 'user-a', teamName: 'Workspace A', displaced: true },
    ],
    pendingBind: null,
    binding: null,
    telegram: {},
    x: {},
  };
  const manager = {
    snapshot: () => structuredClone(view),
    rebindTeam: vi.fn((teamId: string) => {
      view.pendingBind = {
        teamId,
        intent: 'rebind',
        state: 'pending',
        authorizeUrl: 'https://auth.example.invalid/slack?state=fixture',
      };
      return true;
    }),
    cancelPendingBind: vi.fn(() => {
      view.pendingBind = null;
      return true;
    }),
    bindRevoke: vi.fn(() => {
      view.binding = null;
      return true;
    }),
  };
  configureCloudHookManagement(() => manager as unknown as HookControlManager);
  let cancel = () => {};
  const execution: ManagementExecution = {
    signal: new AbortController().signal,
    assertCurrent() {},
    prompt: vi.fn(),
    onCancel(fn) {
      cancel = fn;
    },
  };
  const action = () =>
    listOfficialBotManagement(caller)
      .find((e) => e.id.endsWith(':team-a'))!
      .actions.find((a) => a.intent === 'authorize')!;
  return { view, manager, execution, action, cancel: () => cancel() };
}
describe('official cloud bot native binding branches', () => {
  it('rebinds only the selected displaced workspace and waits for its active result', async () => {
    vi.useFakeTimers();
    const s = setup();
    const run = s.action().run({}, s.execution);
    await Promise.resolve();
    expect(s.manager.rebindTeam).toHaveBeenCalledWith('team-a');
    expect(s.execution.prompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'browser' }));
    s.view.bindings.push({ teamId: 'untouched', displaced: false });
    s.view.bindings[0].displaced = false;
    s.view.pendingBind = null;
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(s.view.bindings[1]).toEqual({ teamId: 'untouched', displaced: false });
  });
  it('does not report cleared authorization as a successful rebind', async () => {
    vi.useFakeTimers();
    const s = setup();
    const run = s.action().run({}, s.execution);
    const rejected = expect(run).rejects.toThrow('AUTH_FAILED');
    await Promise.resolve();
    s.view.pendingBind = null;
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(s.view.bindings[0].displaced).toBe(true);
  });
  it('does not cancel a different native authorization that took over', async () => {
    vi.useFakeTimers();
    const s = setup();
    const run = s.action().run({}, s.execution);
    const rejected = expect(run).rejects.toThrow('CHANGED');
    await Promise.resolve();
    s.view.pendingBind.authorizeUrl = 'https://auth.example.invalid/slack?state=another';
    s.cancel();
    expect(s.manager.cancelPendingBind).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
  });
  it('supports the native disconnect action for a legacy single binding', async () => {
    const s = setup();
    s.view.serverMultiTeam = false;
    s.view.bindings = [];
    s.view.binding = { state: 'confirmed', slackUserId: 'user-a' };
    const action = listOfficialBotManagement(caller)[0]!.actions.find(
      (a) => a.intent === 'disconnect',
    )!;
    await action.run({}, s.execution);
    expect(s.manager.bindRevoke).toHaveBeenCalledTimes(1);
  });
});
