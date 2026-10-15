// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetDesktopPreferencesForTests, connectHostDesktopPreferences, getDesktopPreference, updateDesktopPreference } from '../../state/hostDesktopPreferences';
import { desktopPreferencesHarness, installDesktopPreferencesHarness, settleDesktopPreferences } from '../../__tests__/desktopPreferencesHarness';
import { useNotificationSettings } from '../useNotificationSettings';
import { useSwallowActivationClickSettings } from '../useSwallowActivationClickSettings';
import { useFeishuNotificationSettings } from '../useFeishuNotificationSettings';
import { useExperimentalFlag } from '../useExperimentalFeatures';
import { useSidebarCardMode, useSidebarMainViewMode } from '../useSidebarCardMode';
import { LocaleProvider, bootstrapInitialLocale, useLocale } from '../useLocale';
const i18n = vi.hoisted(() => ({ changeLanguage: vi.fn() }));
vi.mock('@/i18n', () => ({ i18n, DEFAULT_LOCALE: 'en', SUPPORTED_LOCALES: ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] }));
vi.mock('../../lib/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
let host: ReturnType<typeof installDesktopPreferencesHarness>;
beforeEach(() => {
  localStorage.clear(); __resetDesktopPreferencesForTests(); i18n.changeLanguage.mockClear();
  Object.assign(window, { electronAPI: { preferredSystemLocale: 'ko', notificationSetDesktopEnabled: vi.fn(async () => {}), windowBehavior: { setSwallowActivationClick: vi.fn(async () => {}) } } });
  host = installDesktopPreferencesHarness();
});
afterEach(__resetDesktopPreferencesForTests);
describe('profile hooks use the same acknowledged Host state', () => {
  it('persists notification, Feishu, activation click, network debug and both sidebar modes', async () => {
    const prefs = renderHook(() => ({ notification: useNotificationSettings(), feishu: useFeishuNotificationSettings(), click: useSwallowActivationClickSettings(), debug: useExperimentalFlag('debug-network'), pinned: useSidebarCardMode(), main: useSidebarMainViewMode() }));
    await act(async () => {
      prefs.result.current.notification.setEnabled(false); prefs.result.current.feishu.setEnabled(true);
      prefs.result.current.click.setEnabled(true); prefs.result.current.debug.setEnabled(true);
      prefs.result.current.pinned.setMode('card'); prefs.result.current.main.setMode('text');
      await settleDesktopPreferences();
    });
    expect(host.snapshot()).toMatchObject({ value: { notificationsEnabled: false, feishuNotificationsEnabled: true, swallowActivationClick: true, networkDebugEnabled: true, sidebarPinnedMode: 'card', sidebarMainMode: 'text' } });
    expect(prefs.result.current.debug.enabled).toBe(true);
    expect(prefs.result.current.feishu.enabled).toBe(true);
    expect(prefs.result.current.pinned.mode).toBe('card');
    expect(localStorage.getItem('experimental.debug-network')).toBeNull();
  });
  it('keeps locale first frame and all mounted providers on the committed profile language', async () => {
    __resetDesktopPreferencesForTests();
    host = installDesktopPreferencesHarness({ locale: 'ja' });
    localStorage.setItem('language', 'en');
    expect(bootstrapInitialLocale()).toBe('ja');
    const wrapper = ({ children }: { children: ReactNode }) => createElement(LocaleProvider, null, children);
    const a = renderHook(useLocale, { wrapper }); const b = renderHook(useLocale, { wrapper });
    expect(a.result.current.effectiveLocale).toBe('ja');
    await act(async () => { a.result.current.setLocale('system'); await settleDesktopPreferences(); });
    expect(b.result.current.locale).toBe('system'); expect(b.result.current.effectiveLocale).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
    expect(host.snapshot()).toMatchObject({ customizedKeys: ['locale'] });
  });
  it('does not turn readonly lightweight windows into importers or writers', async () => {
    const h = desktopPreferencesHarness(null);
    const { update: _update, ...readApi } = h.api;
    Object.assign(window, { electronAPI: { desktopPreferences: readApi } });
    localStorage.setItem('theme', 'dark'); localStorage.setItem('language', 'ja');
    expect(getDesktopPreference('theme')).toBe('dark');
    connectHostDesktopPreferences({ readOnly: true }); await settleDesktopPreferences();
    expect(getDesktopPreference('theme')).toBe('dark'); expect(getDesktopPreference('locale')).toBe('ja');
    expect(h.api.update).not.toHaveBeenCalled();
    expect(await updateDesktopPreference('locale', () => 'en')).toBe(false);
    h.external({ locale: 'ko' }); await settleDesktopPreferences();
    expect(getDesktopPreference('locale')).toBe('ko');
  });
  it('applies consecutive sound leaf edits to the newest acknowledged group', async () => {
    await settleDesktopPreferences();
    const one = updateDesktopPreference('agentIslandSoundSettings', current => ({ ...current, sounds: { ...current.sounds, start: { type: 'builtin', id: 'none' } } }));
    const two = updateDesktopPreference('agentIslandSoundSettings', current => ({ ...current, sounds: { ...current.sounds, error: { type: 'builtin', id: 'none' } } }));
    expect(await one).toBe(true); expect(await two).toBe(true);
    expect(host.snapshot()).toMatchObject({ value: { agentIslandSoundSettings: { sounds: { start: { id: 'none' }, error: { id: 'none' }, complete: { id: 'gem-collect' } } } } });
  });
});
