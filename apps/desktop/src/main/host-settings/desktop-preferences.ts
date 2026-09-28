import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { createLogger } from '../logger.js';
import { createOverrideSettingsFile, OverrideSettingsError, type OverrideSettingsSnapshot } from '../maker-host/override-settings-file.js';
import {
  desktopPreferenceDefaults, DESKTOP_PREFERENCE_KEYS, normalizeDesktopPreferenceOverrides,
  validateDesktopPreferencesUpdate, type DesktopPreferences, type DesktopPreferencesSnapshot,
  type DesktopPreferencesUpdate,
} from '../../shared/desktopPreferences.js';

interface StoredPreferences extends DesktopPreferences { _initialized: boolean }
/** inspect 不读取授权、不迁移 owner、不准备 Skill、不探测 OS，也不创建目录。 */
export function createDesktopPreferencesStore(options: { filePath: () => string; profileStamp: () => string }) {
  const defaults = (): StoredPreferences => ({ ...desktopPreferenceDefaults(), _initialized: false });
  const store = createOverrideSettingsFile<StoredPreferences>({
    filePath: options.filePath, scopeKey: options.profileStamp, defaults,
    normalize: raw => {
      const { _initialized, ...values } = raw as StoredPreferences;
      return { ...defaults(), ...normalizeDesktopPreferenceOverrides(values), _initialized: _initialized === true };
    },
    validateOverrides: raw => {
      const { _initialized, ...values } = raw;
      if (_initialized !== undefined && _initialized !== true) throw new Error('Invalid desktop initialization marker');
      normalizeDesktopPreferenceOverrides(values);
    },
    atomicOnly: true, preserveUnreadableFile: true, maxBytes: 128 * 1024,
    log: createLogger('desktop-preferences'), label: 'desktop-preferences',
  });
  const project = (state: OverrideSettingsSnapshot<StoredPreferences>, profileStamp: string): DesktopPreferencesSnapshot => {
    if (state.status !== 'ready') return { status: 'unreadable', revision: null, profileStamp };
    // 文件缺失不能证明这是新 profile；缺少 Renderer 数据时不可推断为已初始化默认值。
    if (!state.value._initialized) return { status: 'migrationPending', revision: state.revision, profileStamp };
    const pick = (v: StoredPreferences) => Object.fromEntries(DESKTOP_PREFERENCE_KEYS.map(k => [k, v[k]])) as unknown as DesktopPreferences;
    const customizedKeys = DESKTOP_PREFERENCE_KEYS.filter(k => state.customizedKeys.includes(k));
    return { status: 'ready', profileStamp, revision: state.revision, value: pick(state.value), defaults: pick(state.defaults),
      customizedKeys, isCustomized: customizedKeys.length > 0 };
  };
  return {
    inspect(): DesktopPreferencesSnapshot {
      const stamp = options.profileStamp();
      const result = store.inspect();
      if (stamp !== options.profileStamp()) return { status: 'unreadable', revision: null, profileStamp: options.profileStamp() };
      return project(result, stamp);
    },
    async update(raw: DesktopPreferencesUpdate, assertCurrent: () => void = () => {}, preparedReceipt = false): Promise<DesktopPreferencesSnapshot> {
      const request = validateDesktopPreferencesUpdate(raw);
      const check = () => {
        if (options.profileStamp() !== request.profileStamp) throw new OverrideSettingsError('SCOPE_CHANGED');
        assertCurrent();
      };
      check();
      const result = await store.commitAtomic(state => {
        if (request.importOnly && state.value._initialized) return {};
        return { set: { ...request.set, _initialized: true }, clear: request.clear };
      }, { expectedRevision: request.expectedRevision, assertCurrent: check });
      if (!preparedReceipt) check();
      return project(result, request.profileStamp);
    },
    onChanged: store.onChanged,
  };
}

// 不透明的进程/profile 代际，不暴露文件路径或凭据身份。
let currentRoot: string | null = null;
let currentStamp = '';
export function currentDesktopPreferencesProfileStamp(): string {
  const root = app.getPath('userData');
  if (root !== currentRoot) { currentRoot = root; currentStamp = randomUUID(); }
  return currentStamp;
}
const desktopPreferences = createDesktopPreferencesStore({
  filePath: () => path.join(app.getPath('userData'), 'host-desktop-preferences.json'),
  profileStamp: currentDesktopPreferencesProfileStamp,
});
export const inspectDesktopPreferences = desktopPreferences.inspect;
export const updateDesktopPreferences = desktopPreferences.update;
export const onDesktopPreferencesChanged = desktopPreferences.onChanged;

/** Host journals persistence independently of later account/application changes. */
export const commitDesktopPreferences = (request: DesktopPreferencesUpdate, assertCurrent?: () => void) => desktopPreferences.update(request, assertCurrent, true);
