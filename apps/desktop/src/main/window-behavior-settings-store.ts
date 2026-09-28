import { validateAdditionalSettingsOverrides } from '../shared/settingsEditableCatalog.js';
/**
 * window-behavior-settings-store —— main 进程对窗口交互行为开关的持久化。
 *
 * File: <userData>/window-behavior-settings.json
 *
 * Defaults:
 *  - swallowActivationClick: false (首次点击直接透传,双屏用户默认更顺手;
 *    这是相对 PR #446 / macOS 原生 acceptFirstMouse:false 的行为变更,想要
 *    防误触的用户需在设置里显式打开)
 *  - windowsCloseBehavior: null (Windows 首次关闭时弹窗询问,选择后持久化)
 *  - linuxCloseBehavior: null (Linux 首次关闭时弹窗询问,选择后持久化)
 *
 * swallowActivationClick 迁移后由 Host profile 正本解释；本文件的旧值只作
 * 尚未迁移或暂不可读时的兼容缓存。平台关闭行为仍完全由本 store 持久化与执行。
 * inspect 只检查本文件，不读取或应用桌面运行态。
 */

import { app } from 'electron';
import path from 'node:path';

import { desktopMakerLogger } from './maker-host/logger-adapter.js';
import { createOverrideSettingsFile } from './maker-host/override-settings-file.js';
import {
  isLinuxCloseBehavior,
  isWindowsCloseBehavior,
  type LinuxCloseBehavior,
  type WindowsCloseBehavior,
} from '../shared/windowBehavior.js';

import { inspectSettingsFile, isSettingBoolean, validateOptionalSettingsFields } from './maker-host/settings-inspection.js';
import { inspectDesktopPreferences } from './host-settings/desktop-preferences.js';

const log = desktopMakerLogger.child('window-behavior-settings-store');

export function inspectWindowBehaviorSettings() {
  return inspectSettingsFile({ filePath: settingsFilePath, defaults: DEFAULTS, normalize,
    validate: (raw) => validateOptionalSettingsFields(raw, {
      swallowActivationClick: isSettingBoolean,
      windowsCloseBehavior: (value) => value === null || isWindowsCloseBehavior(value),
      linuxCloseBehavior: (value) => value === null || isLinuxCloseBehavior(value),
    }),
  });
}

export interface WindowBehaviorSettings {
  swallowActivationClick: boolean;
  windowsCloseBehavior: WindowsCloseBehavior | null;
  linuxCloseBehavior: LinuxCloseBehavior | null;
}

const DEFAULTS: WindowBehaviorSettings = {
  swallowActivationClick: false,
  windowsCloseBehavior: null,
  linuxCloseBehavior: null,
};

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'window-behavior-settings.json');
}

function normalize(raw: unknown): WindowBehaviorSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  return {
    swallowActivationClick:
      typeof r.swallowActivationClick === 'boolean'
        ? r.swallowActivationClick
        : DEFAULTS.swallowActivationClick,
    windowsCloseBehavior: isWindowsCloseBehavior(r.windowsCloseBehavior)
      ? r.windowsCloseBehavior
      : DEFAULTS.windowsCloseBehavior,
    linuxCloseBehavior: isLinuxCloseBehavior(r.linuxCloseBehavior)
      ? r.linuxCloseBehavior
      : DEFAULTS.linuxCloseBehavior,
  };
}

const store = createOverrideSettingsFile<WindowBehaviorSettings>({
  validateOverrides: raw => validateAdditionalSettingsOverrides('linuxWindow', raw),
  filePath: settingsFilePath,
  defaults: DEFAULTS,
  normalize,
  log,
  label: 'window-behavior',
});

export function readWindowBehaviorSettings(): WindowBehaviorSettings {
  const legacy = store.read();
  try {
    const desktop = inspectDesktopPreferences();
    if (desktop.status === 'ready') {
      // 创建期原生窗口只消费 Host 正本；迟到的旧缓存写入不能改变生效值。
      return { ...legacy, swallowActivationClick: desktop.value.swallowActivationClick };
    }
  } catch { /* 不可读时保留既有缓存，不迁移、不写默认。 */ }
  return legacy;
}

export function writeSwallowActivationClick(swallowActivationClick: boolean): void {
  store.writePatch({ swallowActivationClick });
  log.info('window-behavior setting written', { swallowActivationClick });
}

export function writeWindowsCloseBehavior(windowsCloseBehavior: WindowsCloseBehavior): void {
  store.writePatch({ windowsCloseBehavior });
  log.info('Windows close behavior written', { windowsCloseBehavior });
}

export function writeLinuxCloseBehavior(linuxCloseBehavior: LinuxCloseBehavior): void {
  store.writePatch({ linuxCloseBehavior });
  log.info('Linux close behavior written', { linuxCloseBehavior });
}

export const __testing = { normalize };

/** Internal Host settings adapter; no new IPC or persistence location. */
export function getWindowBehaviorSettingsStore() { return store; }
