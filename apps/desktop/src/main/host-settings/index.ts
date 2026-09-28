import { isAdditionalSettingsDomain, isModelSettingsDomain, additionalSettingsMetadata } from '../../shared/settingsEditableCatalog.js';
import { readAdditionalSettings, commitAdditionalSettings } from './additional.js';
import { HOST_SETTINGS_CATALOG, isHostSettingsDomain, normalizeHostSettingsChange, type HostSettingsSnapshot, type HostSettingsDomain, type HostSettingsUpdate, type NewTaskDefaultSettings, type HostSettingsReceipt } from '../../shared/hostSettings.js';
import { inspectAppearanceSettings, onAppearanceSettingsChanged, commitAppearanceSettings } from '../appearance-settings-store.js';
import { inspectDatabaseSizeWarningSettings, onDatabaseSizeWarningSettingsChanged, commitDatabaseSizeWarningSettings } from '../database-size-warning-settings.js';
import { inspectPersonalization, onPersonalizationChanged, commitPersonalization, currentSettingsOwner, assertSettingsOwner, settingsOwnerKey } from './personalization.js';
import { inspectNewTaskDefaults, onNewTaskDefaultsChanged, commitNewTaskDefaults } from './new-task-defaults.js';
import { SettingsOperationJournal, HostSettingsError } from './operations.js';
import { OverrideSettingsError } from '../maker-host/override-settings-file.js';

/** Synchronous fresh read. No auth loading, repairs, network, defaults writes or prompt bodies. */
export function readHostSettings(): HostSettingsSnapshot {
  const ownerStamp = currentSettingsOwner();
  const personalization = inspectPersonalization();
  return {
    ownerStamp,
    newTaskDefaults: inspectNewTaskDefaults(),
    personalization: personalization.status === 'ready' ? { ...personalization, value: { isCustomized: personalization.isCustomized }, defaults: { isCustomized: false } } : personalization,
    databaseWarning: inspectDatabaseSizeWarningSettings(),
    appearance: inspectAppearanceSettings(),
  };
}
export function onHostSettingsChanged(listener: () => void): () => void {
  const off = [onNewTaskDefaultsChanged(listener), onPersonalizationChanged(listener), onDatabaseSizeWarningSettingsChanged(listener), onAppearanceSettingsChanged(listener)];
  return () => off.forEach(dispose => dispose());
}
export interface HostSettingsCaller {
  id: string;
  assertCurrent: () => void;
  confirm?: (input: Record<string, unknown>, assertCurrent: () => void) => Promise<boolean>;
}
interface Application {
  models?: {
    read: typeof import('./additionalModels.js').readModelSettings;
    validate: typeof import('./additionalModels.js').validateModelSettingsChange;
    commit: typeof import('./additionalModels.js').commitModelSettings;
  };
  appearance: (value: HostSettingsSnapshot['appearance'] & { status: 'ready' }) => void;
  databaseWarning: () => void;
  additional?: (domain: import('../../shared/settingsEditableCatalog.js').AdditionalSettingsDomain, revision: string, changedKeys?: readonly string[]) => Promise<void>;
  validateNewTaskDefaults: (value: NewTaskDefaultSettings) => Promise<void>;
}
let application: Application | null = null;
export function configureHostSettingsApplication(value: Application): void { application = value; }
const journal = new SettingsOperationJournal();
async function inspectDomain(domain: HostSettingsDomain, workspaceId?: string) {
  if (isModelSettingsDomain(domain)) return application?.models ? application.models.read(domain) : { status: 'unavailable' as const, revision: null };
  return isAdditionalSettingsDomain(domain) ? readAdditionalSettings(domain, workspaceId) : readHostSettings()[domain];
}
function validateScope(domain: HostSettingsDomain, workspaceId: unknown, writing = false): void {
  if (workspaceId !== undefined && (domain !== 'workspaceTools' || typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(workspaceId))
    || writing && domain === 'workspaceTools' && workspaceId === undefined) throw new HostSettingsError('INVALID_PARAMS');
}

export async function getHostSettings(caller: HostSettingsCaller, domain: HostSettingsDomain, includeUserPrompt = false, workspaceId?: string) {
  caller.assertCurrent();
  validateScope(domain, workspaceId);
  const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  const assertCurrent = () => { assertSettingsOwner(owner); caller.assertCurrent(); };
  const snapshot = await inspectDomain(domain, workspaceId);
  assertCurrent();
  if (snapshot.status !== 'ready') return snapshot;
  let body: { userPrompt: string } | undefined;
  if (includeUserPrompt) {
    if (domain !== 'personalization') throw new HostSettingsError('INVALID_PARAMS');
    if (!caller.confirm || !await caller.confirm({ domain, action: 'read_user_prompt', scope: 'owner', applies: 'next_agent_start' }, assertCurrent)) throw new HostSettingsError('CONFIRMATION_REQUIRED');
    assertCurrent();
    const fresh = inspectPersonalization();
    if (fresh.status !== 'ready' || fresh.revision !== snapshot.revision) throw new HostSettingsError('CONFLICT');
    body = fresh.value;
  }
  assertCurrent();
  const value = domain === 'telegramPersona' ? { ...snapshot.value, soul: '' } : body ?? snapshot.value;
  return { ...snapshot, value, operationId: journal.issue(settingsOwnerKey(owner), caller.id, domain, snapshot.revision) };
}
export function getHostSettingsOperation(caller: HostSettingsCaller, id: string) {
  caller.assertCurrent(); const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  return journal.get(id, settingsOwnerKey(owner), caller.id);
}
export async function updateHostSettings(caller: HostSettingsCaller, input: HostSettingsUpdate, nativeSave = false): Promise<HostSettingsReceipt> {
  caller.assertCurrent();
  const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  if (!isHostSettingsDomain(input.domain) || typeof input.operationId !== 'string' || typeof input.expectedRevision !== 'string') throw new HostSettingsError('INVALID_PARAMS');
  validateScope(input.domain, input.workspaceId, true);
  let change: ReturnType<typeof normalizeHostSettingsChange>;
  try { change = normalizeHostSettingsChange({ domain: input.domain, set: input.set, clear: input.clear }); }
  catch { throw new HostSettingsError('INVALID_PARAMS'); }
  const assertCurrent = () => { assertSettingsOwner(owner); caller.assertCurrent(); };
  return journal.execute({ operationId: input.operationId, owner: settingsOwnerKey(owner), caller: caller.id, domain: input.domain, revision: input.expectedRevision, normalizedChange: { ...change, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) }, assertCurrent, perform: async () => {
    const before = await inspectDomain(input.domain, input.workspaceId);
    assertCurrent();
    if (before.status !== 'ready') throw new HostSettingsError('UNREADABLE');
    if (before.revision !== input.expectedRevision) throw new HostSettingsError('CONFLICT');
    if (input.domain === 'newTaskDefaults' && [...Object.keys(change.set), ...change.clear].some(key => !['worktree', 'planMode'].includes(key))) {
      const state = inspectNewTaskDefaults();
      if (state.status !== 'ready' || !application) throw new HostSettingsError('NOT_READY');
      const next = { ...state.value, ...Object.fromEntries(change.clear.map(k => [k, state.defaults[k as keyof NewTaskDefaultSettings]])), ...change.set } as NewTaskDefaultSettings;
      await application.validateNewTaskDefaults(next);
      assertCurrent();
    }
    const catalog = HOST_SETTINGS_CATALOG.find(entry => entry.domain === change.domain)!;
    const modelAdapter = isModelSettingsDomain(change.domain) ? application?.models : null;
    if (isModelSettingsDomain(change.domain) && !modelAdapter) throw new HostSettingsError('NOT_READY');
    let modelValidation = modelAdapter && isModelSettingsDomain(change.domain)
      ? await modelAdapter.validate(change.domain, change) : undefined;
    const choices = modelValidation?.choices ?? ('choices' in before ? before.choices : undefined);
    assertCurrent();
    if (!nativeSave && (!caller.confirm || !await caller.confirm({ domain: change.domain, set: change.set, clear: change.clear,
      before: before.value, defaults: before.defaults, ...(choices ? { choices } : {}),
      ...('workspaceLabel' in before ? { workspaceLabel: before.workspaceLabel } : {}),
      scope: 'scope' in catalog ? catalog.scope : '', applies: 'applies' in catalog ? catalog.applies : '',
    }, assertCurrent))) throw new HostSettingsError('CONFIRMATION_REQUIRED');
    assertCurrent();
    // A confirmation can remain open while a provider is disconnected or a model changes.
    if (modelAdapter && isModelSettingsDomain(change.domain)) modelValidation = await modelAdapter.validate(change.domain, change);
    assertCurrent();
    const options = { expectedRevision: input.expectedRevision, assertCurrent: () => { assertCurrent(); modelValidation?.assertCurrent(); } };
    let revision: string | undefined;
    let applicationFailed = false;
    try {
      // Runtime validation above closes the grammar; these casts only express the correlated domain to TS.
      if (modelAdapter && isModelSettingsDomain(change.domain)) revision = (await modelAdapter.commit(change.domain, change, options)).revision;
      else if (isAdditionalSettingsDomain(change.domain)) {
        const result = await commitAdditionalSettings(change.domain, change, options, input.workspaceId);
        revision = result.revision; applicationFailed = result.applicationFailed === true;
      }
      else if (change.domain === 'appearance') revision = (await commitAppearanceSettings(change as never, options)).revision;
      else if (change.domain === 'databaseWarning') revision = (await commitDatabaseSizeWarningSettings(change as never, options)).revision;
      else if (change.domain === 'personalization') revision = (await commitPersonalization(change as never, options)).revision ?? undefined;
      else revision = (await commitNewTaskDefaults(change as never, options)).revision;
    } catch (error) {
      if (error instanceof OverrideSettingsError) throw new HostSettingsError(error.code);
      throw error;
    }
    // Persistence has completed. Never throw into the journal's save-failure path from here.
    const additionalEffect = isAdditionalSettingsDomain(change.domain) ? additionalSettingsMetadata[change.domain].applies : null;
    let applied: HostSettingsReceipt['application'] = additionalEffect === 'next_agent_start' ? 'next_agent_start' : additionalEffect === 'next_task' || additionalEffect === 'next_connection' ? 'next_task' : change.domain === 'newTaskDefaults' ? 'next_task' : change.domain === 'personalization' ? 'next_agent_start' : 'applied';
    try {
      assertCurrent();
      if (isAdditionalSettingsDomain(change.domain) && application?.additional && revision) await application.additional(change.domain, revision, [...Object.keys(change.set), ...change.clear]);
      else if (change.domain === 'appearance') {
        const state = inspectAppearanceSettings();
        if (state.status !== 'ready' || !application) throw new Error('not ready');
        application.appearance(state);
      } else if (change.domain === 'databaseWarning') {
        if (!application) throw new Error('not ready');
        application.databaseWarning();
      }
    } catch { applied = 'failed'; }
    if (applicationFailed) applied = 'failed';
    return { operationId: input.operationId, domain: input.domain, status: 'saved', saved: true, application: applied, revision };
  } });
}
export { HOST_SETTINGS_CATALOG, HostSettingsError };
