import { getDesktopPreference, setDesktopPreference, useDesktopPreference } from '../state/hostDesktopPreferences';
/** Windows 事件处理同步读取已确认的 profile 缓存。 */
export function getSwallowActivationClickEnabled(): boolean { return getDesktopPreference('swallowActivationClick'); }
export function useSwallowActivationClickSettings() {
  const enabled = useDesktopPreference('swallowActivationClick');
  return { enabled, setEnabled: (next: boolean) => {
    void setDesktopPreference('swallowActivationClick', next).then(saved => {
      // 旧 macOS BrowserWindow 启动缓存只能在 Host 提交成功后更新。
      if (saved) void window.electronAPI?.windowBehavior?.setSwallowActivationClick?.(next).catch(() => {});
    });
  } };
}
