import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopPreferenceDefaults, type DesktopPreferencesSnapshot } from '../../shared/desktopPreferences.js';

const h = vi.hoisted(() => ({ root: '', inspect: vi.fn<() => DesktopPreferencesSnapshot>(), update: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => h.root } }));
vi.mock('../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('../host-settings/desktop-preferences.js', () => ({ inspectDesktopPreferences: h.inspect, updateDesktopPreferences: h.update }));
vi.mock('../host-settings/startup.js', () => { throw new Error('Host Skill preparation forbidden'); });
vi.mock('../appSessionState.js', () => { throw new Error('Authorization access forbidden'); });
import { inspectWindowBehaviorSettings, readWindowBehaviorSettings, writeSwallowActivationClick } from '../window-behavior-settings-store';

const file = () => path.join(h.root, 'window-behavior-settings.json');
function ready(enabled: boolean): DesktopPreferencesSnapshot {
  const defaults = desktopPreferenceDefaults();
  return { status: 'ready', profileStamp: 'fixture-profile', revision: 'fixture-revision', defaults,
    value: { ...defaults, swallowActivationClick: enabled }, customizedKeys: ['swallowActivationClick'], isCustomized: true };
}
beforeEach(() => {
  h.root = fs.mkdtempSync(path.join(os.tmpdir(), 'window-prefs-'));
  h.inspect.mockReset(); h.update.mockClear();
  h.inspect.mockReturnValue({ status: 'migrationPending', profileStamp: 'fixture-profile', revision: 'fixture-revision' });
});
afterEach(() => fs.rmSync(h.root, { recursive: true, force: true }));

describe('窗口创建期消费 profile 偏好', () => {
  it('ready 正本覆盖旧 click 缓存，保留关闭行为，迟到旧写入不改变生效值', () => {
    fs.writeFileSync(file(), JSON.stringify({ swallowActivationClick: false, windowsCloseBehavior: 'tray', linuxCloseBehavior: 'quit' }));
    h.inspect.mockReturnValue(ready(true));
    expect(readWindowBehaviorSettings()).toEqual({ swallowActivationClick: true, windowsCloseBehavior: 'tray', linuxCloseBehavior: 'quit' });
    writeSwallowActivationClick(false);
    expect(readWindowBehaviorSettings().swallowActivationClick).toBe(true);
    h.inspect.mockReturnValue(ready(false));
    writeSwallowActivationClick(true);
    expect(readWindowBehaviorSettings().swallowActivationClick).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each(['migrationPending', 'unreadable'] as const)('%s 只沿用既有缓存，不迁移或写默认', status => {
    fs.writeFileSync(file(), JSON.stringify({ swallowActivationClick: true, windowsCloseBehavior: 'tray' }));
    const before = fs.readFileSync(file());
    h.inspect.mockReturnValue(status === 'unreadable'
      ? { status, profileStamp: 'fixture-profile', revision: null }
      : { status, profileStamp: 'fixture-profile', revision: 'fixture-revision' });
    expect(readWindowBehaviorSettings()).toEqual({ swallowActivationClick: true, windowsCloseBehavior: 'tray', linuxCloseBehavior: null });
    expect(fs.readFileSync(file())).toEqual(before);
    expect(fs.readdirSync(h.root)).toEqual(['window-behavior-settings.json']);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('core inspector 不读取 Host profile、更不应用 runtime，缺失文件检查也无写入', () => {
    h.inspect.mockImplementation(() => { throw new Error('runtime read forbidden during inspection'); });
    expect(inspectWindowBehaviorSettings()).toMatchObject({ status: 'ready', value: { swallowActivationClick: false } });
    expect(h.inspect).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(fs.readdirSync(h.root)).toEqual([]);
  });
});
