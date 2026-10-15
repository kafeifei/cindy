import { createHash } from 'node:crypto';
import { getHostWorkspaceProviderSourceStore, commitHostWorkspaceProviderSources, type WorkspaceProviderSourceEntry } from '../hook-control/workspaceProviderSourceStore.js';
import { getHostHookPreferencesContext, notifyHostWorkspaceProviderSourcesChanged } from '../hook-control/ipc.js';
import { refreshSettingsModelRecommendation } from './catalog.js';
import { captureSettingsModelGuard } from './additionalModels.js';
import { additionalSettingsSchemas, settingsValuesEqual, type SettingsEditableValue } from '../../shared/settingsEditableCatalog.js';
import type { OverrideSettingsCommitOptions } from '../maker-host/override-settings-file.js';
import { HostSettingsError } from './operations.js';
import { HOOK_CHAT_WORKSPACE_ALIAS } from '../../shared/hookControlIpc.js';
type Key = Pick<WorkspaceProviderSourceEntry, 'channel' | 'teamId' | 'workspace'>;
const idFor = (row: Key) => createHash('sha256').update(JSON.stringify([row.channel, row.teamId, row.workspace])).digest('base64url');
function project(state: ReturnType<ReturnType<typeof getHostWorkspaceProviderSourceStore>['inspect']>) {
  if (state.status !== 'ready') return state;
  const value = additionalSettingsSchemas.imWorkspaceProviders.parse({ entries: state.value.entries.map(row => ({ workspaceId: idFor(row), providerId: row.providerId })) });
  return { status: 'ready' as const, revision: state.revision, value, defaults: { entries: [] }, customizedKeys: value.entries.length ? ['entries'] : [], isCustomized: value.entries.length > 0 };
}
function inspect() { return project(getHostWorkspaceProviderSourceStore().inspect()); }
export const nativeWorkspaceProviderSettings = {
  inspect,
  async read() {
    const raw = getHostWorkspaceProviderSourceStore().inspect();
    const state = project(raw); if (state.status !== 'ready' || raw.status !== 'ready') return state;
    const targets = getHostHookPreferencesContext()?.targets ?? [];
    if (!targets.length && !state.isCustomized) return { status: 'unavailable' as const, revision: null };
    const historical = raw.value.entries.filter(row => !targets.some(target => idFor(target) === idFor(row)));
    const catalog = await refreshSettingsModelRecommendation(); catalog.assertCurrent();
    return { ...state, choices: {
      entries: [...targets.map(row => ({ value: { workspaceId: idFor(row) }, label: row.label })), ...historical.map(row => ({ value: { workspaceId: idFor(row) }, label: `${row.workspace === HOOK_CHAT_WORKSPACE_ALIAS ? 'Cindy' : row.workspace} · ${row.channel}` }))],
      providers: catalog.providers.filter(provider => provider.connected && !provider.suspended && !provider.modelDiscoveryFailure && provider.id.length <= 128).map(provider => ({ value: provider.id, label: provider.name })),
    } };
  },
  async commit(change: { set: Record<string, SettingsEditableValue>; clear: string[] }, options: OverrideSettingsCommitOptions) {
    const raw = getHostWorkspaceProviderSourceStore().inspect(), before = project(raw);
    if (before.status !== 'ready' || raw.status !== 'ready') throw new HostSettingsError('UNREADABLE');
    const desired = change.clear.includes('entries') ? [] : additionalSettingsSchemas.imWorkspaceProviders.parse(change.set).entries;
    const guard = captureSettingsModelGuard();
    const context = getHostHookPreferencesContext();
    const stamp = JSON.stringify([context?.fingerprint, context?.targets]);
    const catalog = await refreshSettingsModelRecommendation();
    const assertCurrent = () => {
      options.assertCurrent?.(); guard(); catalog.assertCurrent();
      const latest = getHostHookPreferencesContext();
      if (JSON.stringify([latest?.fingerprint, latest?.targets]) !== stamp) throw new HostSettingsError('CONFLICT');
    };
    assertCurrent();
    const keys = new Map([...raw.value.entries, ...(context?.targets ?? [])].map(row => [idFor(row), row]));
    const entries = desired.map(row => {
      const key = keys.get(row.workspaceId); if (!key) throw new HostSettingsError('UNSUPPORTED_CAPABILITY');
      if (!before.value.entries.some(old => settingsValuesEqual(row, old)) && (!(context?.targets ?? []).some(target => idFor(target) === row.workspaceId)
        || !catalog.providers.some(provider => provider.id === row.providerId && provider.connected && !provider.suspended && !provider.modelDiscoveryFailure))) throw new HostSettingsError('MODEL_UNAVAILABLE');
      return { channel: key.channel, teamId: key.teamId, workspace: key.workspace, providerId: row.providerId };
    });
    const result = project(await commitHostWorkspaceProviderSources(entries, { ...options, assertCurrent }));
    if (result.status !== 'ready') throw new HostSettingsError('UNREADABLE');
    let applicationFailed = false;
    try { options.assertCurrent?.(); notifyHostWorkspaceProviderSourcesChanged(); } catch { applicationFailed = true; }
    return { ...result, applicationFailed };
  },
};
