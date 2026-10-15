/** 个性化设置的只读显示缓存；持久化与启动消费均由 Host 负责。 */
import { useEffect, useSyncExternalStore } from 'react';
import { getUserPromptView, refreshUserPrompt, setUserPrompt, resetUserPrompt, subscribeUserPrompt } from '@/lib/userPromptStore';

export function useUserPrompt() {
  const state = useSyncExternalStore(subscribeUserPrompt, getUserPromptView);
  useEffect(() => { void refreshUserPrompt(); }, []);
  return { ...state, setValue: setUserPrompt, resetValue: resetUserPrompt };
}
