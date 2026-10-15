import { useEffect } from 'react';
import { getDesktopPreference, setDesktopPreference, useDesktopPreference } from '../state/hostDesktopPreferences';
export function getNotificationsEnabled(): boolean { return getDesktopPreference('notificationsEnabled'); }
/** 运行态应用只消费 Host 确认的偏好，不是第二个持久化写入方。 */
export function syncNotificationsEnabledToMain(enabled = getNotificationsEnabled()): void {
  void window.electronAPI?.notificationSetDesktopEnabled?.(enabled);
}
export function useNotificationSettings() {
  const enabled = useDesktopPreference('notificationsEnabled');
  useEffect(() => syncNotificationsEnabledToMain(enabled), [enabled]);
  return { enabled, setEnabled: (next: boolean) => { void setDesktopPreference('notificationsEnabled', next); } };
}
