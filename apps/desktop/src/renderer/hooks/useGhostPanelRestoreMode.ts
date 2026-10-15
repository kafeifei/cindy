import { getDesktopPreference, setDesktopPreference, useDesktopPreference, __resetDesktopPreferencesForTests } from '../state/hostDesktopPreferences';
export type GhostPanelRestoreMode = 'bubble' | 'sidebar';
/** Host 保存 profile override；显式设为默认值仍保留 override。 */
export function getGhostPanelRestoreMode(): GhostPanelRestoreMode { return getDesktopPreference('ghostPanelRestoreMode'); }
export function setGhostPanelRestoreMode(next: GhostPanelRestoreMode): void { void setDesktopPreference('ghostPanelRestoreMode', next); }
export function useGhostPanelRestoreMode() {
  return { mode: useDesktopPreference('ghostPanelRestoreMode'), setMode: setGhostPanelRestoreMode };
}
export const __resetGhostPanelRestoreModeForTest = __resetDesktopPreferencesForTests;
