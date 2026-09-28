import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_SETTINGS } from '../../../shared/appearanceSettings.js';
import { desktopPreferenceDefaults, type DesktopPreferencesSnapshot } from '../../../shared/desktopPreferences.js';
import type { HostSettingState, NewTaskDefaultSettings } from '../../../shared/hostSettings.js';

const forbidden = vi.hoisted(() => vi.fn(() => { throw new Error('不得越过注入的读取边界'); }));
vi.mock('../../appearance-settings-store.js', () => ({ inspectAppearanceSettings: forbidden }));
vi.mock('../../database-size-warning-settings.js', () => ({ inspectDatabaseSizeWarningSettings: forbidden }));
vi.mock('../new-task-defaults.js', () => ({ inspectNewTaskDefaultsForSnapshot: forbidden }));
vi.mock('../personalization.js', () => ({ inspectPersonalizationForSnapshot: forbidden }));
vi.mock('../desktop-preferences.js', () => ({ inspectDesktopPreferences: forbidden }));
import { inspectPreferenceSettingsForSnapshot, type PreferenceSettingsReaders } from '../readers/preferences.js';

function ready<T>(value: T, customizedKeys: string[] = []): Extract<HostSettingState<T>, { status: 'ready' }> {
  return { status: 'ready', value, defaults: structuredClone(value), customizedKeys,
    isCustomized: customizedKeys.length > 0, revision: 'private-revision' };
}
function fixture() {
  const appearance = ready({ ...DEFAULT_APPEARANCE_SETTINGS }, ['uiFamily']);
  const desktop: Extract<DesktopPreferencesSnapshot, { status: 'ready' }> = {
    ...ready(desktopPreferenceDefaults()), profileStamp: 'private-profile', customizedKeys: [],
  };
  const newTaskDefaults: NewTaskDefaultSettings = { harness: 'codex', providerId: null, modelId: null,
    effort: null, fast: false, thinking: true, worktree: false, planMode: false };
  const readers: PreferenceSettingsReaders = {
    appearance: () => appearance, desktop: () => desktop,
    newTaskDefaults: () => ready(newTaskDefaults), personalization: () => ready({ isCustomized: false }),
    databaseWarning: () => ready({ thresholdGiB: 10, disabled: false }),
  };
  return { appearance, desktop, readers };
}

describe('桌面与原四域的逐叶只读投影', () => {
  it('不读取字体、主题名、音效路径/名称及显示器身份，且不输出内部revision', () => {
    const { appearance, desktop, readers } = fixture();
    const privateRead = vi.fn(() => { throw new Error('不得读取私密正文'); });
    Object.defineProperty(appearance.value, 'uiFamily', { get: privateRead });
    Object.defineProperty(appearance.value, 'codeFamily', { get: privateRead });
    Object.defineProperty(desktop.value, 'themeFamilyId', { get: privateRead });
    desktop.customizedKeys = ['themeFamilyId', 'agentIslandDisplayTarget', 'agentIslandSoundSettings'];
    desktop.value.agentIslandDisplayTarget = { mode: 'display', displayId: 1 };
    Object.defineProperty(desktop.value.agentIslandDisplayTarget, 'displayId', { get: privateRead });
    desktop.value.agentIslandSoundSettings.sounds.start = { type: 'custom', path: '', name: '' };
    Object.defineProperty(desktop.value.agentIslandSoundSettings.sounds.start, 'path', { get: privateRead });
    Object.defineProperty(desktop.value.agentIslandSoundSettings.sounds.start, 'name', { get: privateRead });
    const out = inspectPreferenceSettingsForSnapshot('darwin', readers);
    expect(out.fields['appearance.uiFontCustomized']).toEqual({ status: 'value', value: true, source: 'override' });
    expect(out.fields['desktop.themeFamilyIdConfigured']).toMatchObject({ value: true });
    expect(out.fields['desktop.agentIslandDisplayTargetConfigured']).toMatchObject({ value: true });
    expect(out.fields['desktop.agentIslandSoundSettings.sounds.start']).toEqual({ status: 'value', source: 'override', value: { type: 'custom', configured: true } });
    expect(JSON.stringify(out)).not.toMatch(/private-profile|private-revision|displayId|uiFamily|"path"/);
    expect(privateRead).not.toHaveBeenCalled(); expect(forbidden).not.toHaveBeenCalled();
  });
  it('显式保存默认false仍是override，而默认false保持default', () => {
    const { desktop, readers } = fixture();
    desktop.value.notificationsEnabled = false;
    desktop.value.feishuNotificationsEnabled = false;
    desktop.customizedKeys = ['notificationsEnabled'];
    const out = inspectPreferenceSettingsForSnapshot('darwin', readers);
    expect(out.fields['desktop.notificationsEnabled']).toEqual({ status: 'value', source: 'override', value: false });
    expect(out.fields['desktop.feishuNotificationsEnabled']).toEqual({ status: 'value', source: 'default', value: false });
  });
  it('单域抛错只使该域不可读，不使其它字段回退或失败', () => {
    const { readers } = fixture();
    readers.appearance = () => { throw new Error('私密底层错误'); };
    const out = inspectPreferenceSettingsForSnapshot('darwin', readers);
    expect(out.fields['appearance.uiFontSize']).toEqual({ status: 'unreadable' });
    expect(out.fields['databaseWarning.disabled']).toMatchObject({ status: 'value', value: false });
    expect(JSON.stringify(out)).not.toContain('私密底层错误');
  });
});
