import type { LiziMcpSessionContext } from '@cindy/mcps';
import type { SettingsOwnerStamp } from '../../shared/hostSettings.js';
import type { HostSettingsCaller } from '../host-settings/index.js';
import { HostSettingsError } from '../host-settings/operations.js';
import { resolveGhostFsSessionSnapshot } from './ghostFsSessionSnapshot.js';

/** Host-owned lookups keep the settings boundary testable without bootstrapping Maker or auth. */
interface HostSettingsCallerDeps {
  getOwner: () => SettingsOwnerStamp | null;
  assertOwner: (owner: SettingsOwnerStamp) => void;
  getSession: Parameters<typeof resolveGhostFsSessionSnapshot>[0];
  getSessionSource: (sessionId: string) => Promise<string | undefined>;
  confirm: (sessionId: string, input: Record<string, unknown>, recheck: () => void) => Promise<boolean>;
}

/** Discovery and execution share this live authority check; MCP context alone cannot prove locality. */
export function createHostSettingsCallerResolver(deps: HostSettingsCallerDeps) {
  return async (context: LiziMcpSessionContext): Promise<HostSettingsCaller> => {
    const owner = deps.getOwner();
    if (!owner || !context.sessionId || !context.sessionInstanceId || context.remoteHostId
      || context.mcpCallerKind !== 'root' || context.mcpCallerAttested !== true) {
      throw new HostSettingsError('SETTINGS_NOT_ALLOWED');
    }
    const sessionId = context.sessionId;
    const authority = resolveGhostFsSessionSnapshot(deps.getSession, sessionId, context.sessionInstanceId);
    if (!authority || authority.remoteHostId || authority.planModeEnabled || authority.permissionMode === 'plan') {
      throw new HostSettingsError('SETTINGS_NOT_ALLOWED');
    }
    const assertCurrent = () => {
      deps.assertOwner(owner);
      if (!authority.isCurrent?.()) throw new HostSettingsError('SETTINGS_NOT_ALLOWED');
    };
    // Only an owner-created desktop/device-link task can expose this global surface.
    // Bot, group/channel, scheduler, Review and unclassified legacy sources fail closed.
    const source = await deps.getSessionSource(sessionId);
    assertCurrent();
    if (source !== 'desktop') throw new HostSettingsError('SETTINGS_NOT_ALLOWED');
    return {
      id: `${sessionId}:${context.sessionInstanceId}`,
      assertCurrent,
      confirm: (input, recheck) => deps.confirm(sessionId, input, recheck),
    };
  };
}
