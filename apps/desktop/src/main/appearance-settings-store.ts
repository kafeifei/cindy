import { app } from 'electron';
import path from 'node:path';
import { readCustomWallpaperUrl } from './custom-wallpaper-settings.js';

import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings,
  isValidAppearanceSetting,
  type AppearanceOverrides,
  type AppearanceSettings,
} from '../shared/appearanceSettings.js';
import { desktopMakerLogger } from './maker-host/logger-adapter.js';
import {
  createOverrideSettingsFile,
  type OverrideSettingsState,
  type OverrideSettingsMutation,
  type OverrideSettingsCommitOptions,
} from './maker-host/override-settings-file.js';
import { peekCommittedAppSession } from './appSessionState.js';

const log = desktopMakerLogger.child('appearance-settings-store');

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'appearance-settings.json');
}

const store = createOverrideSettingsFile<AppearanceSettings>({
  filePath: settingsFilePath,
  defaults: DEFAULT_APPEARANCE_SETTINGS,
  normalize: normalizeAppearanceSettings,
  log,
  label: 'appearance',
  maxBytes: 16 * 1024,
  preserveUnreadableFile: true,
  atomicOnly: true,
  scopeKey: () => JSON.stringify(peekCommittedAppSession()),
  validateOverrides: (raw) => {
    for (const [key, value] of Object.entries(raw)) {
      if (!isValidAppearanceSetting(key, value)) throw new Error('invalid appearance setting');
    }
  },
});

export const inspectAppearanceSettings = store.inspect;
export const onAppearanceSettingsChanged = store.onChanged;
export async function clearAppearanceSettingsFields(fields: Array<keyof AppearanceSettings>): Promise<AppearanceSettings> {
  return (await store.commitAtomic({ clear: fields })).value;
}
export function commitAppearanceSettings(
  mutation: OverrideSettingsMutation<AppearanceSettings>,
  options?: OverrideSettingsCommitOptions,
) { return store.commitAtomic(mutation, options); }

export function readAppearanceSettings(): AppearanceSettings {
  const value = store.read();
  const customWallpaperUrl = readCustomWallpaperUrl();
  return {
    ...value,
    customWallpaperUrl,
    wallpaperId: value.wallpaperId === 'custom' && !customWallpaperUrl ? 'none' : value.wallpaperId,
  };
}

export function readAppearanceSettingsState(): OverrideSettingsState<AppearanceSettings> {
  return { ...store.readState(), value: readAppearanceSettings() };
}

export async function writeAppearanceSettingsPatch(
  patch: AppearanceOverrides,
): Promise<AppearanceSettings> {
  await store.writePatchAtomic(patch, { preserveDefaults: true });
  return readAppearanceSettings();
}

export async function updateAppearanceSettingsAtomic(
  updater: (current: AppearanceSettings) => AppearanceOverrides,
): Promise<AppearanceSettings> {
  await store.updateAtomic((current) => updater(current.value), { preserveDefaults: true });
  return readAppearanceSettings();
}

export async function resetAppearanceSettings(): Promise<AppearanceSettings> {
  await store.resetAtomic();
  return readAppearanceSettings();
}

export const __testing = {
  normalize: normalizeAppearanceSettings,
  settingsFilePath,
};
