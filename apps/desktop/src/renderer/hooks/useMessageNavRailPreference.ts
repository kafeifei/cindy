import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized, __resetDesktopPreferencesForTests } from '../state/hostDesktopPreferences';
export function getMessageNavRailEnabled(): boolean { return getDesktopPreference('messageNavRailEnabled'); }
export function useMessageNavRailPreference() {
  return {
    enabled: useDesktopPreference('messageNavRailEnabled'),
    isCustomized: useDesktopPreferenceCustomized('messageNavRailEnabled'),
    setEnabled: (next: boolean) => { void setDesktopPreference('messageNavRailEnabled', next); },
    resetPreference: () => clearDesktopPreference('messageNavRailEnabled'),
  };
}
export const _resetMessageNavRailPreferenceForTests = __resetDesktopPreferencesForTests;
