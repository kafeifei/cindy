import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createXdtHelperMcpServer, type LiziMcpSessionContext } from '@cindy/mcps';
import type { Session } from '@cindy/maker-core';

const isolated = vi.hoisted(() => ({
  root: '', owner: 'fixture-owner', generation: 1, pending: false,
  forbiddenOwnerLoad: vi.fn(() => { throw new Error('No session loading or owner-scoped getter'); }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron', () => ({ app: { getPath: () => isolated.root } }));
vi.mock('../../logger.js', () => ({ createLogger: () => isolated.logger }));
vi.mock('../../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => isolated.logger } }));
vi.mock('../../appSessionState.js', () => ({
  peekCommittedAppSession: () => ({ mode: 'cloud', dataOwnerId: isolated.owner, generation: isolated.generation }),
  isAppSessionBoundaryPending: () => isolated.pending,
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  getActiveAppSession: isolated.forbiddenOwnerLoad,
  activeOwnerScopeKey: isolated.forbiddenOwnerLoad,
  ownerScopedUserDataPath: isolated.forbiddenOwnerLoad,
}));
// Do not import the Maker bootstrap, auth adapters or global Skill preparation in this regression.
vi.mock('../../host-settings/catalog.js', () => ({ refreshSettingsModelRecommendation: vi.fn() }));

import { createHostSettingsCallerResolver } from '../hostSettingsCaller.js';
import { configureHostSettingsCaller, hostSettingsHelper } from '../../host-settings/helper.js';
import { currentSettingsOwner, assertSettingsOwner } from '../../host-settings/personalization.js';
import { SettingsConfirmationBridge } from '../../host-settings/confirmation.js';
import * as settings from '../../host-settings/index.js';

function payload(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
}

function fixture() {
  const context: LiziMcpSessionContext = {
    agentKind: 'pi', workingDir: isolated.root,
    sessionId: 'fixture-session', sessionInstanceId: 'fixture-instance',
    mcpCallerKind: 'root', mcpCallerAttested: true,
    // Deliberately no remoteHostId: reproduces the former Pi bridge omission.
  };
  const live = {
    instanceId: 'fixture-instance', workDir: isolated.root, remoteHostId: null as string | null,
    stablePermissionModeState: { mode: 'bypassPermissions', generation: 1 },
    stablePlanModeState: { enabled: false, generation: 1 },
  };
  const broadcast = vi.fn();
  const confirmation = new SettingsConfirmationBridge(broadcast, 100);
  const confirm = vi.fn((sessionId: string, input: Record<string, unknown>, recheck: () => void) =>
    confirmation.request(sessionId, input, { title: 'Fixture', description: 'Fixture' }, recheck));
  const getSource = vi.fn(async () => 'desktop');
  const resolver = createHostSettingsCallerResolver({
    getOwner: currentSettingsOwner, assertOwner: assertSettingsOwner,
    getSession: id => id === context.sessionId ? live as unknown as Session : undefined,
    getSessionSource: getSource, confirm,
  });
  configureHostSettingsCaller(resolver);
  return { context, live, broadcast, confirmation, confirm, getSource, resolver };
}

beforeEach(() => {
  isolated.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-settings-caller-'));
  isolated.generation += 1;
  isolated.pending = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  try { expect(isolated.forbiddenOwnerLoad).not.toHaveBeenCalled(); }
  finally { fs.rmSync(isolated.root, { recursive: true, force: true }); }
});

describe('Host settings production caller resolver', () => {
  it('allows a current local desktop root and invalidates it on permission/owner changes', async () => {
    const f = fixture();
    expect(await hostSettingsHelper.allowed(f.context)).toBe(true);
    const caller = await f.resolver(f.context);
    expect(caller.id).toBe('fixture-session:fixture-instance');
    expect(f.getSource).toHaveBeenCalledWith('fixture-session');
    expect(await hostSettingsHelper.call(f.context, 'get_settings', { domain: 'appearance' })).toMatchObject({ ok: true });
    expect(f.confirm).not.toHaveBeenCalled();
    f.live.stablePlanModeState = { ...f.live.stablePlanModeState, generation: 2 };
    expect(caller.assertCurrent).toThrow('SETTINGS_NOT_ALLOWED');
    const next = await f.resolver(f.context);
    isolated.generation += 1;
    expect(next.assertCurrent).toThrow();
  });

  it('denies discovery and direct execution for a live SSH Session even when context omits locality', async () => {
    const f = fixture();
    // All other gates are satisfied, and even a genuine operation issued while local is not authority.
    const before = await hostSettingsHelper.call(f.context, 'get_settings', { domain: 'appearance' }) as {
      settings: { operationId: string; revision: string };
    };
    expect(f.getSource).toHaveBeenCalledWith('fixture-session');
    f.live.remoteHostId = 'fixture-ssh-host';
    const read = vi.spyOn(settings, 'getHostSettings');
    const operation = vi.spyOn(settings, 'getHostSettingsOperation');
    const write = vi.spyOn(settings, 'updateHostSettings');
    const readFile = vi.spyOn(fs, 'readFileSync');
    const publishFile = vi.spyOn(fs, 'renameSync');
    const calls = [
      ['list_settings', {}],
      ['get_settings', { domain: 'personalization', include_user_prompt: true }],
      ['get_settings', { domain: 'appearance' }],
      ['update_settings', { domain: 'appearance', expected_revision: before.settings.revision,
        operation_id: before.settings.operationId, set: { uiSize: 16 } }],
      ['get_settings_operation', { operation_id: before.settings.operationId }],
    ] as const;
    expect(await hostSettingsHelper.allowed(f.context)).toBe(false);
    for (const [tool, args] of calls) {
      expect(await hostSettingsHelper.call(f.context, tool, args)).toEqual({ ok: false, errorCode: 'SETTINGS_NOT_ALLOWED' });
    }

    // Exercise the real helper discovery and dispatch, not a mocked `allowed` callback.
    const server = createXdtHelperMcpServer({ settings: hostSettingsHelper }, {
      ...f.context, agentKind: 'pi', getSessionContext: () => f.context,
    });
    const [left, right] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'fixture-settings-caller', version: '1.0.0' });
    try {
      await Promise.all([client.connect(left), server.connect(right)]);
      const overview = payload(await client.callTool({ name: 'list_tools', arguments: {} }));
      expect(overview.categories).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'settings' })]));
      expect(payload(await client.callTool({ name: 'list_tools', arguments: { category: 'settings' } })))
        .toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      for (const [name, args] of calls) {
        expect(payload(await client.callTool({ name: 'call_tool', arguments: { name, args } })))
          .toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      }
    } finally {
      await client.close(); await server.close();
      f.confirmation.cleanupForSession(f.context.sessionId!);
    }
    expect(read).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(publishFile).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
    expect(f.confirmation.pendingSnapshots()).toEqual([]);
    expect(fs.readdirSync(isolated.root)).toEqual([]);
  });

  it.each([
    { mcpCallerKind: 'descendant' as const }, { mcpCallerAttested: false },
    { mcpCallerKind: 'unknown' as const }, { sessionInstanceId: 'stale-instance' },
    { remoteHostId: 'fixture-ssh-host' },
  ])('keeps the existing context gates closed: %j', async invalid => {
    const f = fixture();
    expect(await hostSettingsHelper.allowed({ ...f.context, ...invalid })).toBe(false);
    expect(f.confirm).not.toHaveBeenCalled();
  });

  it('denies Plan, non-desktop source and a pending owner boundary', async () => {
    const f = fixture();
    f.live.stablePlanModeState.enabled = true;
    expect(await hostSettingsHelper.allowed(f.context)).toBe(false);
    f.live.stablePlanModeState.enabled = false;
    f.getSource.mockResolvedValue('scheduler');
    expect(await hostSettingsHelper.allowed(f.context)).toBe(false);
    f.getSource.mockResolvedValue('desktop');
    isolated.pending = true;
    expect(await hostSettingsHelper.allowed(f.context)).toBe(false);
    expect(f.confirm).not.toHaveBeenCalled();
  });
});
