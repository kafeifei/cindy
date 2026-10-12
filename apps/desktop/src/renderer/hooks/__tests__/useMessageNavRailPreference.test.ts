// @vitest-environment jsdom
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;


/**
 * useMessageNavRailPreference — 覆盖 override 语义(规则 20):
 *  - 默认开启;localStorage 只存 override
 *  - 关闭 → 写入;开回默认 → 删除 key(清 override)
 *  - 非法存储值回落默认
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  _resetMessageNavRailPreferenceForTests,
  getMessageNavRailEnabled,
  useMessageNavRailPreference,
} from '../useMessageNavRailPreference';

const KEY = 'chat.messageNavRail.enabled';

describe('useMessageNavRailPreference', () => {
  beforeEach(() => {
    localStorage.clear();
    host = installDesktopPreferencesHarness();
    _resetMessageNavRailPreferenceForTests();
  });

  it('defaults to enabled with no stored override', async () => {
    expect(getMessageNavRailEnabled()).toBe(true);
    const { result } = renderHook(() => useMessageNavRailPreference());
    expect(result.current.enabled).toBe(true);
    expect(result.current.isCustomized).toBe(false);
  });

  it('reads a stored disabled override', async () => {
    localStorage.setItem(KEY, 'false');
    expect(getMessageNavRailEnabled()).toBe(false);
    const { result } = renderHook(() => useMessageNavRailPreference());
    expect(result.current.enabled).toBe(false);
    expect(result.current.isCustomized).toBe(true);
  });

  it('keeps an older stored enabled value as a user override', async () => {
    localStorage.setItem(KEY, 'true');
    expect(getMessageNavRailEnabled()).toBe(true);
    const { result } = renderHook(() => useMessageNavRailPreference());
    expect(result.current.enabled).toBe(true);
    expect(result.current.isCustomized).toBe(true);
  });

  it('falls back to default on garbage stored value', async () => {
    localStorage.setItem(KEY, 'whatever');
    expect(getMessageNavRailEnabled()).toBe(true);
  });

  it('disabling persists override; reset clears the Host override', async () => {
    const { result } = renderHook(() => useMessageNavRailPreference());
    await act(async () => { result.current.setEnabled(false); await settleDesktopPreferences(); });
    expect(host.snapshot()).toMatchObject({ value: { messageNavRailEnabled: false }, customizedKeys: ['messageNavRailEnabled'] });
    expect(getMessageNavRailEnabled()).toBe(false);

    await act(async () => { await result.current.resetPreference(); await settleDesktopPreferences(); });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getMessageNavRailEnabled()).toBe(true);
    expect(result.current.isCustomized).toBe(false);
  });
});
