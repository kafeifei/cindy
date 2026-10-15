import { getDesktopPreference, setDesktopPreference, useDesktopPreference } from '../state/hostDesktopPreferences';
export function getFeishuNotificationsEnabled(): boolean { return getDesktopPreference('feishuNotificationsEnabled'); }
/** 也供 Bot 解绑界面调用；只改 profile 偏好，不触及 Bot 凭据。 */
export function setFeishuNotificationsEnabled(next: boolean): void { void setDesktopPreference('feishuNotificationsEnabled', next); }
export function useFeishuNotificationSettings() {
  return { enabled: useDesktopPreference('feishuNotificationsEnabled'), setEnabled: setFeishuNotificationsEnabled };
}
