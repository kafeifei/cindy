// @vitest-environment jsdom
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;


/**
 * useLinkOpenPreference — 覆盖 override 语义(规则 20):
 *  - web 默认 'external';local 默认 'sidebar';localStorage 只存 override
 *  - 选回该开关默认 → 删除对应 key
 *  - 旧统一 key 按"是否自定义"一次性迁到新开关
 *  - 非法存储值回落默认
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  _resetLinkOpenPreferenceForTests,
  getLinkOpenPreference,
  getLinkOpenPreferenceForUrl,
  isLocalOpenUrl,
  useLinkOpenPreference,
} from '../useLinkOpenPreference';

const LEGACY_KEY = 'chat.linkOpenPreference';
const WEB_KEY = 'chat.webLinkOpenPreference';
const LOCAL_KEY = 'chat.localLinkOpenPreference';

describe('isLocalOpenUrl', () => {
  it.each([
    ['https://example.com/path', false],
    ['http://192.168.1.8/admin', false],
    ['http://10.0.0.1/', false],
    ['http://localhost.example.com/', false],
    ['not a url', false],
    ['file:///tmp/report.html', true],
    ['http://localhost:3000/app', true],
    ['https://127.0.0.1:5173/', true],
    ['http://127.0.0.2/', true],
    ['http://[::1]/', true],
    ['http://foo.localhost/dev', true],
  ])('%s → %s', (url, expected) => {
    expect(isLocalOpenUrl(url)).toBe(expected);
  });
});

describe('useLinkOpenPreference', () => {
  beforeEach(() => {
    localStorage.clear();
    host = installDesktopPreferencesHarness();
    _resetLinkOpenPreferenceForTests();
  });

  it('defaults web to external and local to sidebar with no stored override', async () => {
    expect(getLinkOpenPreference('web')).toBe('external');
    expect(getLinkOpenPreference('local')).toBe('sidebar');
    const web = renderHook(() => useLinkOpenPreference('web'));
    const local = renderHook(() => useLinkOpenPreference('local'));
    expect(web.result.current.preference).toBe('external');
    expect(web.result.current.isCustomized).toBe(false);
    expect(local.result.current.preference).toBe('sidebar');
    expect(local.result.current.isCustomized).toBe(false);
  });

  it('reads a stored web sidebar override without touching local', async () => {
    localStorage.setItem(WEB_KEY, 'sidebar');
    expect(getLinkOpenPreference('web')).toBe('sidebar');
    expect(getLinkOpenPreference('local')).toBe('sidebar');
    const { result } = renderHook(() => useLinkOpenPreference('web'));
    expect(result.current.isCustomized).toBe(true);
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  it('falls back to each kind default on garbage stored value', async () => {
    localStorage.setItem(WEB_KEY, 'whatever');
    localStorage.setItem(LOCAL_KEY, 'whatever');
    expect(getLinkOpenPreference('web')).toBe('external');
    expect(getLinkOpenPreference('local')).toBe('sidebar');
  });

  it('setting web to sidebar persists; reset clears the Host override', async () => {
    const { result } = renderHook(() => useLinkOpenPreference('web'));
    await act(async () => { result.current.setPreference('sidebar'); await settleDesktopPreferences(); });
    expect(getLinkOpenPreference('web')).toBe('sidebar');
    expect(getLinkOpenPreference('web')).toBe('sidebar');

    await act(async () => { await result.current.resetPreference(); await settleDesktopPreferences(); });
    expect(localStorage.getItem(WEB_KEY)).toBeNull();
    expect(getLinkOpenPreference('web')).toBe('external');
    expect(result.current.isCustomized).toBe(false);
  });

  it('setting local to external persists; reset clears the Host override', async () => {
    const { result } = renderHook(() => useLinkOpenPreference('local'));
    await act(async () => { result.current.setPreference('external'); await settleDesktopPreferences(); });
    expect(getLinkOpenPreference('local')).toBe('external');
    expect(getLinkOpenPreference('local')).toBe('external');

    await act(async () => { await result.current.resetPreference(); await settleDesktopPreferences(); });
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(getLinkOpenPreference('local')).toBe('sidebar');
    expect(result.current.isCustomized).toBe(false);
  });

  it('preserves an explicit stored default as an override', async () => {
    localStorage.setItem(WEB_KEY, 'external');
    expect(getLinkOpenPreference('web')).toBe('external');
    expect(localStorage.getItem(WEB_KEY)).toBe('external');
    expect(renderHook(() => useLinkOpenPreference('web')).result.current.isCustomized).toBe(true);
  });

  it('interprets the explicit legacy external choice for both kinds without writing', async () => {
    localStorage.setItem(LEGACY_KEY, 'external');
    expect(getLinkOpenPreference('web')).toBe('external');
    expect(getLinkOpenPreference('local')).toBe('external');
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(localStorage.getItem(WEB_KEY)).toBeNull();
    expect(getLinkOpenPreference('local')).toBe('external');
  });

  it('interprets the explicit legacy sidebar choice for both kinds without writing', async () => {
    localStorage.setItem(LEGACY_KEY, 'sidebar');
    expect(getLinkOpenPreference('web')).toBe('sidebar');
    expect(getLinkOpenPreference('local')).toBe('sidebar');
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(getLinkOpenPreference('web')).toBe('sidebar');
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  it('does not overwrite an already-split custom key without deleting the rollback key', async () => {
    localStorage.setItem(LEGACY_KEY, 'sidebar');
    localStorage.setItem(LOCAL_KEY, 'external');
    expect(getLinkOpenPreference('local')).toBe('external');
    expect(getLinkOpenPreference('web')).toBe('sidebar');
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(getLinkOpenPreference('local')).toBe('external');
    expect(getLinkOpenPreference('web')).toBe('sidebar');
  });

  it('picks the matching preference for a URL', async () => {
    localStorage.setItem(WEB_KEY, 'sidebar');
    localStorage.setItem(LOCAL_KEY, 'external');
    expect(getLinkOpenPreferenceForUrl('https://example.com')).toBe('sidebar');
    expect(getLinkOpenPreferenceForUrl('http://localhost:3000')).toBe('external');
    expect(getLinkOpenPreferenceForUrl('file:///tmp/a.html')).toBe('external');
  });
});
