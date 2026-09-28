import type { XdtHelperMcpDeps } from '@cindy/mcps';
import { HOST_SETTINGS_CATALOG, getHostSettings, getHostSettingsOperation, updateHostSettings, HostSettingsError, type HostSettingsCaller } from './index.js';
import { isHostSettingsDomain } from '../../shared/hostSettings.js';
import { refreshSettingsModelRecommendation } from './catalog.js';

type Callbacks = NonNullable<XdtHelperMcpDeps['settings']>;
type Context = Parameters<Callbacks['allowed']>[0];
let capture: ((context: Context) => Promise<HostSettingsCaller>) | null = null;
export function configureHostSettingsCaller(resolver: NonNullable<typeof capture>): void { capture = resolver; }
export const hostSettingsHelper: Callbacks = {
  allowed: async context => {
    if (!capture) return false;
    try { (await capture(context)).assertCurrent(); return true; } catch { return false; }
  },
  call: async (context, tool, args) => {
    try {
      if (!capture) throw new HostSettingsError('NOT_READY');
      const caller = await capture(context);
      caller.assertCurrent();
      if (tool === 'list_settings') return { ok: true, catalog: HOST_SETTINGS_CATALOG };
      if (tool === 'get_settings_operation') return { ok: true, operation: getHostSettingsOperation(caller, String(args.operation_id)) };
      if (!isHostSettingsDomain(args.domain)) throw new HostSettingsError('INVALID_PARAMS');
      if (tool === 'get_settings') {
        if (args.domain === 'newTaskDefaults') await refreshSettingsModelRecommendation();
        caller.assertCurrent();
        return { ok: true, settings: await getHostSettings(caller, args.domain, args.include_user_prompt === true, args.workspace_id as string | undefined) };
      }
      if (tool !== 'update_settings') throw new HostSettingsError('INVALID_PARAMS');
      const receipt = await updateHostSettings(caller, { domain: args.domain, workspaceId: args.workspace_id as string | undefined, operationId: String(args.operation_id), expectedRevision: String(args.expected_revision), set: args.set as Record<string, unknown> | undefined, clear: args.clear as string[] | undefined });
      return { ok: receipt.saved, receipt };
    } catch (error) {
      return { ok: false, errorCode: error instanceof HostSettingsError ? error.code : 'SETTINGS_FAILED' };
    }
  },
};
