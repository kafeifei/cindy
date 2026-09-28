import path from 'node:path';
import { app } from 'electron';
import { createLogger } from '../logger.js';
import { dataOwnerStorageKey, isAppSessionBoundaryPending, peekCommittedAppSession } from '../appSessionState.js';
import { createOverrideSettingsFile, type OverrideSettingsCommitOptions, type OverrideSettingsMutation } from '../maker-host/override-settings-file.js';
import type { PersonalizationSettings, SettingsOwnerStamp, HostSettingState } from '../../shared/hostSettings.js';
import { HostSettingsError } from './operations.js';

interface StoredPersonalization extends PersonalizationSettings { _initialized: boolean }
const defaults: StoredPersonalization = { userPrompt: '', _initialized: false };

/** 仅观察内存中的 owner，不执行旧 app-session 的读取或修复。 */
export function currentSettingsOwner(): SettingsOwnerStamp | null {
  const session = peekCommittedAppSession();
  if (!session || !session.dataOwnerId || isAppSessionBoundaryPending()) return null;
  return { dataOwnerId: session.dataOwnerId, ownerGeneration: session.generation };
}
/** 两个 Host owner store 共用的纯定位；不经过会加载或迁移会话的通用 getter。 */
export function settingsOwnerFilePath(fileName: 'host-personalization.json' | 'host-new-task-defaults.json'): string {
  const owner = currentSettingsOwner();
  if (!owner?.dataOwnerId) throw new HostSettingsError('OWNER_CHANGED');
  const userDataPath = app.getPath('userData');
  if (!path.isAbsolute(userDataPath)) throw new HostSettingsError('OWNER_CHANGED');
  return path.join(userDataPath, 'owners', dataOwnerStorageKey(owner.dataOwnerId), fileName);
}
export function settingsOwnerKey(stamp: SettingsOwnerStamp): string {
  return `${stamp.dataOwnerId ?? 'none'}:${stamp.ownerGeneration}`;
}
export function assertSettingsOwner(stamp: SettingsOwnerStamp): void {
  const current = currentSettingsOwner();
  if (!current || settingsOwnerKey(current) !== settingsOwnerKey(stamp)) throw new HostSettingsError('OWNER_CHANGED');
}

const store = createOverrideSettingsFile<StoredPersonalization>({
  filePath: () => settingsOwnerFilePath('host-personalization.json'),
  defaults,
  normalize: (raw) => ({ ...defaults, ...raw as StoredPersonalization }),
  validateOverrides: (raw) => {
    for (const [key, value] of Object.entries(raw)) {
      if (key === '_initialized' && typeof value === 'boolean') continue;
      if (key === 'userPrompt' && typeof value === 'string' && value.length <= 8000) continue;
      throw new HostSettingsError('UNREADABLE');
    }
  },
  scopeKey: () => JSON.stringify(currentSettingsOwner()),
  atomicOnly: true,
  preserveUnreadableFile: true,
  maxBytes: 64 * 1024,
  log: createLogger('host-personalization'),
  label: 'personalization',
});

export const onPersonalizationChanged = store.onChanged;

function projectPersonalization(snapshot: ReturnType<typeof store.inspect>): HostSettingState<PersonalizationSettings> {
  if (snapshot.status !== 'ready') return snapshot;
  const customizedKeys = snapshot.customizedKeys.filter((key) => key === 'userPrompt');
  return { ...snapshot, value: { userPrompt: snapshot.value.userPrompt }, defaults: { userPrompt: '' }, customizedKeys, isCustomized: customizedKeys.length > 0 };
}
export function inspectPersonalization(): HostSettingState<PersonalizationSettings> {
  if (!currentSettingsOwner()) return { status: 'unavailable', revision: null };
  return projectPersonalization(store.inspect());
}
/** 不向快照交出正文；尚未初始化与明确恢复默认是两种不同状态。 */
export function inspectPersonalizationForSnapshot(): HostSettingState<{ isCustomized: boolean }> | { status: 'migrationPending'; revision: null } {
  if (!currentSettingsOwner()) return { status: 'unavailable', revision: null };
  const raw = store.inspect();
  if (raw.status === 'ready' && !raw.value._initialized) return { status: 'migrationPending', revision: null };
  const result = projectPersonalization(raw);
  return result.status === 'ready' ? { ...result, value: { isCustomized: result.isCustomized }, defaults: { isCustomized: false } } : result;
}

/** 仅启动装配和原生设置 UI 可在没有 Agent 读取确认时消费正文。 */
export function readHostUserPrompt(): string {
  const snapshot = inspectPersonalization();
  if (snapshot.status === 'unavailable') return '';
  if (snapshot.status !== 'ready') throw new HostSettingsError('UNREADABLE');
  return snapshot.value.userPrompt;
}

export async function commitPersonalization(mutation: OverrideSettingsMutation<PersonalizationSettings>, options: OverrideSettingsCommitOptions = {}) {
  const owner = currentSettingsOwner();
  if (!owner) throw new HostSettingsError('OWNER_CHANGED');
  const result = await store.commitAtomic({ set: { ...mutation.set, _initialized: true }, clear: mutation.clear }, {
    ...options,
    assertCurrent: () => { assertSettingsOwner(owner); options.assertCurrent?.(); },
  });
  const customizedKeys = result.customizedKeys.filter(key => key === 'userPrompt');
  return { ...result, value: { userPrompt: result.value.userPrompt }, defaults: { userPrompt: '' }, customizedKeys, isCustomized: customizedKeys.length > 0 };
}

/** 只初始化一次；显式恢复默认后也保留已初始化标记。 */
export async function importLegacyPersonalization(userPrompt: unknown, owner: SettingsOwnerStamp, expectedRevision: string): Promise<'imported' | 'already_initialized'> {
  if (typeof userPrompt !== 'string' || userPrompt.length > 8000) throw new HostSettingsError('INVALID_PARAMS');
  let result: 'imported' | 'already_initialized' = 'imported';
  await store.commitAtomic((state) => {
    if (state.value._initialized) {
      result = 'already_initialized';
      return {};
    }
    return { set: { ...(userPrompt === '' ? {} : { userPrompt }), _initialized: true } };
  }, { expectedRevision, assertCurrent: () => assertSettingsOwner(owner) });
  return result;
}
