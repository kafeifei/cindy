import { useEffect } from 'react';
import { getDesktopPreference, setDesktopPreference, useDesktopPreference } from '../state/hostDesktopPreferences';
export type SidebarViewMode = 'text' | 'card' | 'list';
export type SidebarMainViewMode = 'text' | 'list';
/** 旧布尔值和安装版本兼容由 profile 导入器一次性处理。 */
export function getSidebarViewMode(): SidebarViewMode { return getDesktopPreference('sidebarPinnedMode'); }
export function getSidebarMainViewMode(): SidebarMainViewMode { return getDesktopPreference('sidebarMainMode'); }
export function shouldNotifyMainOnPinnedModeMount(mainAlreadyNotified: boolean): boolean { return !mainAlreadyNotified; }
let notifiedMode: SidebarViewMode | null = null;
function notifyPinnedCardSummaries(mode: SidebarViewMode): void {
  if (notifiedMode === mode) return;
  const setEnabled = window.electronAPI?.localDb?.sessions?.setPinnedCardSummaries;
  if (typeof setEnabled !== 'function') return;
  notifiedMode = mode;
  void setEnabled(mode === 'card');
}
export function useSidebarCardMode() {
  const mode = useDesktopPreference('sidebarPinnedMode');
  useEffect(() => notifyPinnedCardSummaries(mode), [mode]);
  return { mode, setMode: (next: SidebarViewMode) => { void setDesktopPreference('sidebarPinnedMode', next); } };
}
export function useSidebarMainViewMode() {
  return { mode: useDesktopPreference('sidebarMainMode'),
    setMode: (next: SidebarMainViewMode) => { void setDesktopPreference('sidebarMainMode', next); } };
}
