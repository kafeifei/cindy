import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized, __resetDesktopPreferencesForTests } from '../state/hostDesktopPreferences';

import { desktopPreferenceDefaults } from '../../shared/desktopPreferences';
import { getVoiceInputSettings } from './useVoiceInputSettings';
import { findComposerVoiceInputConflict } from '@/voice-input/composerVoiceInputConflict';
import { hasComposerModifier } from '@/voice-input/composerShortcut';

export { hasComposerModifier } from '@/voice-input/composerShortcut';

export type ComposerSendShortcutPreference = 'enter' | 'modifier-enter';

export type ComposerEnterIntent = 'queue' | 'steer' | 'native' | 'ignore' | null;

export type ComposerEnterEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey' | 'repeat' | 'isComposing'
>;

export type ComposerSendShortcutUpdateResult =
  | { ok: true }
  | { ok: false; conflict: 'composer-voice-input' };

export const COMPOSER_SEND_SHORTCUT_STORAGE_KEY = 'chat.sendShortcutPreference';
export const DEFAULT_COMPOSER_SEND_SHORTCUT: ComposerSendShortcutPreference = desktopPreferenceDefaults().composerSendShortcut;

export function getComposerModifierShortcutLabel(platform: string | undefined): string {
  return platform === 'darwin' ? '⌘+Enter' : 'Ctrl+Enter';
}

export function getComposerSendShortcutLabel(
  preference: ComposerSendShortcutPreference,
  platform: string | undefined,
): string {
  return preference === 'modifier-enter' ? getComposerModifierShortcutLabel(platform) : 'Enter';
}

/**
 * Decide what the composer should do with an Enter keydown.
 *
 * The resolver deliberately does not perform any side effect. Callers can
 * therefore share the same preference semantics while keeping their own
 * event-target and delivery plumbing.
 */
export function resolveComposerEnterIntent(
  event: ComposerEnterEvent,
  preference: ComposerSendShortcutPreference,
  options: { turnRunning: boolean; platform: string | undefined },
): ComposerEnterIntent {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return null;
  if (event.isComposing) return 'native';

  const hasModifier = hasComposerModifier(event, options.platform);
  if (event.repeat) {
    const isSendShortcut = preference === 'enter' || hasModifier;
    return isSendShortcut ? 'ignore' : 'native';
  }

  if (preference === 'modifier-enter') {
    return hasModifier ? 'queue' : 'native';
  }

  if (!hasModifier) return 'queue';
  return options.turnRunning ? 'steer' : 'queue';
}

export function getComposerSendShortcutPreference(): ComposerSendShortcutPreference { return getDesktopPreference('composerSendShortcut'); }
export function useComposerSendShortcutPreference() {
  return { preference: useDesktopPreference('composerSendShortcut'), isCustomized: useDesktopPreferenceCustomized('composerSendShortcut'),
    setPreference: (next: ComposerSendShortcutPreference): ComposerSendShortcutUpdateResult => {
      if (findComposerVoiceInputConflict(next, getVoiceInputSettings().shortcut, window.electronAPI?.platform)) {
        return { ok: false, conflict: 'composer-voice-input' };
      }
      void setDesktopPreference('composerSendShortcut', next);
      return { ok: true };
    },
    resetPreference: () => clearDesktopPreference('composerSendShortcut'),
  };
}
export const _resetComposerSendShortcutPreferenceForTests = __resetDesktopPreferencesForTests;
