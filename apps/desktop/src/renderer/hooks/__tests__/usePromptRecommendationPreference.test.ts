// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetPromptRecommendationPreferenceForTests, getPromptRecommendationPreference, subscribePromptRecommendationPreference, syncPromptRecommendationPreferenceFromStorageValue } from '../usePromptRecommendationPreference';
import { installDesktopPreferencesHarness, settleDesktopPreferences } from '../../__tests__/desktopPreferencesHarness';
let host: ReturnType<typeof installDesktopPreferencesHarness>;
beforeEach(() => { localStorage.clear(); _resetPromptRecommendationPreferenceForTests(); host = installDesktopPreferencesHarness(); });
describe('prompt recommendation preference runtime sync', () => {
  it('Host push 更新同步真值，旧 storage 事件不再覆盖 Host', async () => {
    await settleDesktopPreferences();
    expect(getPromptRecommendationPreference()).toBe(true);
    host.external({ promptRecommendationEnabled: false }); await settleDesktopPreferences();
    expect(getPromptRecommendationPreference()).toBe(false);
    syncPromptRecommendationPreferenceFromStorageValue('true');
    expect(getPromptRecommendationPreference()).toBe(false);
  });
  it('Host 已提交变化通知运行期 Store 清理推荐，无关字段不重复通知', async () => {
    await settleDesktopPreferences();
    const listener = vi.fn(); const unsubscribe = subscribePromptRecommendationPreference(listener);
    host.external({ promptRecommendationEnabled: false }); await settleDesktopPreferences();
    expect(listener).toHaveBeenCalledExactlyOnceWith(false);
    host.external({ theme: 'dark' }); await settleDesktopPreferences();
    expect(listener).toHaveBeenCalledTimes(1); unsubscribe();
  });
});
