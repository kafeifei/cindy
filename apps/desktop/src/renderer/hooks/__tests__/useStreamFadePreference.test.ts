// @vitest-environment jsdom
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;


/**
 * useStreamFadePreference — 覆盖 override 语义(规则 20):
 *  - 默认 'on'(动效开启);localStorage 只存 override
 *  - 切 'off' → 写入;切回 'on' → 删除 key(清 override)
 *  - 非法存储值回落默认
 *  - useStreamFadeEnabled 订阅联动:设置页切换后消息渲染侧即时拿到新值
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  _resetStreamFadePreferenceForTests,
  getStreamFadePreference,
  useStreamFadeEnabled,
  useStreamFadePreference,
} from '../useStreamFadePreference';

const KEY = 'chat.streamFadePreference';

describe('useStreamFadePreference', () => {
  beforeEach(() => {
    localStorage.clear();
    host = installDesktopPreferencesHarness();
    _resetStreamFadePreferenceForTests();
  });

  it('defaults to on with no stored override', async () => {
    expect(getStreamFadePreference()).toBe('on');
    const { result } = renderHook(() => useStreamFadePreference());
    expect(result.current.preference).toBe('on');
    expect(result.current.isCustomized).toBe(false);
  });

  it('reads a stored off override', async () => {
    localStorage.setItem(KEY, 'off');
    expect(getStreamFadePreference()).toBe('off');
    const { result } = renderHook(() => useStreamFadePreference());
    expect(result.current.isCustomized).toBe(true);
  });

  it('preserves an explicit legacy default override', async () => {
    localStorage.setItem(KEY, 'on');
    expect(getStreamFadePreference()).toBe('on');
    expect(localStorage.getItem(KEY)).toBe('on');
    const { result } = renderHook(() => useStreamFadePreference());
    expect(result.current.isCustomized).toBe(true);
  });

  it('falls back to default on garbage stored value', async () => {
    localStorage.setItem(KEY, 'whatever');
    expect(getStreamFadePreference()).toBe('on');
  });

  it('setting off persists override; reset clears the Host override', async () => {
    const { result } = renderHook(() => useStreamFadePreference());
    await act(async () => { result.current.setPreference('off'); await settleDesktopPreferences(); });
    expect(host.snapshot()).toMatchObject({ value: { streamFadePreference: 'off' }, customizedKeys: ['streamFadePreference'] });
    expect(getStreamFadePreference()).toBe('off');

    await act(async () => { await result.current.resetPreference(); await settleDesktopPreferences(); });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getStreamFadePreference()).toBe('on');
    expect(result.current.isCustomized).toBe(false);
  });

  it('useStreamFadeEnabled tracks toggles from the settings hook', async () => {
    const pref = renderHook(() => useStreamFadePreference());
    const enabled = renderHook(() => useStreamFadeEnabled());
    expect(enabled.result.current).toBe(true);

    await act(async () => { pref.result.current.setPreference('off'); await settleDesktopPreferences(); });
    expect(enabled.result.current).toBe(false);

    await act(async () => { pref.result.current.setPreference('on'); await settleDesktopPreferences(); });
    expect(enabled.result.current).toBe(true);
  });

  it('useStreamFadeEnabled tracks Host changes without the settings hook mounted', async () => {
    const enabled = renderHook(() => useStreamFadeEnabled());
    expect(enabled.result.current).toBe(true);

    await act(async () => { await settleDesktopPreferences(); host.external({ streamFadePreference: 'off' }); await settleDesktopPreferences(); });
    expect(enabled.result.current).toBe(false);

    await act(async () => { host.external({ streamFadePreference: 'on' }); await settleDesktopPreferences(); });
    expect(enabled.result.current).toBe(true);
  });
});
