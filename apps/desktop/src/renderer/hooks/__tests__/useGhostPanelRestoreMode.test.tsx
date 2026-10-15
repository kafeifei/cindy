// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetGhostPanelRestoreModeForTest, getGhostPanelRestoreMode, setGhostPanelRestoreMode, useGhostPanelRestoreMode } from '../useGhostPanelRestoreMode';
import { clearDesktopPreference } from '../../state/hostDesktopPreferences';
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;
beforeEach(() => { localStorage.clear(); __resetGhostPanelRestoreModeForTest(); host = installDesktopPreferencesHarness(); });
afterEach(() => { cleanup(); __resetGhostPanelRestoreModeForTest(); });
describe('useGhostPanelRestoreMode', () => {
  it('默认沿用浮动气泡且不写默认值快照', () => {
    expect(getGhostPanelRestoreMode()).toBe('bubble');
    expect(localStorage.getItem('ghostPanel.restoreMode')).toBeNull();
  });
  it('Host 接受切换后同步同窗口消费者，不再写旧键', async () => {
    const first = renderHook(() => useGhostPanelRestoreMode());
    const second = renderHook(() => useGhostPanelRestoreMode());
    await act(async () => { first.result.current.setMode('sidebar'); await settleDesktopPreferences(); });
    expect(first.result.current.mode).toBe('sidebar'); expect(second.result.current.mode).toBe('sidebar');
    expect(host.snapshot()).toMatchObject({ value: { ghostPanelRestoreMode: 'sidebar' } });
    expect(localStorage.getItem('ghostPanel.restoreMode')).toBeNull();
  });
  it('显式选择默认仍为 override，只有 clear 才删除', async () => {
    setGhostPanelRestoreMode('sidebar'); await settleDesktopPreferences();
    setGhostPanelRestoreMode('bubble'); await settleDesktopPreferences();
    expect(host.snapshot()).toMatchObject({ customizedKeys: ['ghostPanelRestoreMode'] });
    await clearDesktopPreference('ghostPanelRestoreMode');
    expect(getGhostPanelRestoreMode()).toBe('bubble'); expect(host.snapshot()).toMatchObject({ customizedKeys: [] });
  });
  it('接收其他窗口的 Host 变更，不接受 storage 作为第二正本', async () => {
    const view = renderHook(() => useGhostPanelRestoreMode());
    await act(async () => { await settleDesktopPreferences(); host.external({ ghostPanelRestoreMode: 'sidebar' }); await settleDesktopPreferences(); });
    expect(view.result.current.mode).toBe('sidebar');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ghostPanel.restoreMode', newValue: 'bubble' })));
    expect(view.result.current.mode).toBe('sidebar');
  });
});
