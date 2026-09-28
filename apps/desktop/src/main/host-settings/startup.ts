import type { CreateSessionOptions } from '@cindy/maker-core';
import { readHostUserPrompt } from './personalization.js';

/** 在生成项目上下文之前冻结 Host 正文；后续拼接顺序和存活任务快照保持不变。 */
export function captureHostPersonalization(opts: Pick<CreateSessionOptions,
  'userPrompt' | 'hostStartupPreferences' | 'makerMemoryEnabled' | 'displayReasoning'>): void {
  const userPrompt = readHostUserPrompt();
  opts.userPrompt = userPrompt;
  opts.hostStartupPreferences = {
    userPrompt,
    makerMemoryEnabled: opts.makerMemoryEnabled,
    displayReasoning: opts.displayReasoning,
  };
}
