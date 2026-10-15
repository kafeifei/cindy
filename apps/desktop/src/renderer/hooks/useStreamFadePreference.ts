import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized, __resetDesktopPreferencesForTests } from '../state/hostDesktopPreferences';
export type StreamFadePreference = 'on' | 'off';
export function getStreamFadePreference(): StreamFadePreference { return getDesktopPreference('streamFadePreference'); }
export function useStreamFadeEnabled(): boolean { return useDesktopPreference('streamFadePreference') === 'on'; }
export function useStreamFadePreference() {
  return {
    preference: useDesktopPreference('streamFadePreference'),
    isCustomized: useDesktopPreferenceCustomized('streamFadePreference'),
    setPreference: (next: StreamFadePreference) => { void setDesktopPreference('streamFadePreference', next); },
    resetPreference: () => clearDesktopPreference('streamFadePreference'),
  };
}
export const _resetStreamFadePreferenceForTests = __resetDesktopPreferencesForTests;
