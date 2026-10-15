import type { AgentKind } from '@/hooks/useAgentCapabilities';
import type { Effort } from '@/lib/userPreferences.types';
import {
  patchVendorPrefs,
  patchVendorPrefsPreservingModelChoice,
  setEffortForModel,
  setFastModeForModel,
  switchVendor,
} from './newMakerDraft';
import {
  setProviderModelChoice,
  setProviderModelEffort,
  setProviderModelFast,
  setProviderModelThinking,
} from './providerModelMemory';

/** 既有远程偏好消息：选模写用户记忆；调档和自动校准只更新模型预设。 */
export interface RemoteDraftPreference {
  agent: AgentKind;
  providerId: string;
  modelId: string;
  active: boolean;
  markModelChoice?: boolean;
  effort?: string;
  fast?: boolean;
  thinking?: boolean;
}

/** 在执行端使用与本地选择器相同的持久入口，控制端不另存一份云端偏好。 */
export function applyRemoteDraftPreference({
  agent,
  providerId,
  modelId,
  active,
  effort,
  fast,
  thinking,
  markModelChoice,
}: RemoteDraftPreference): void {
  const vendor = agent === 'claude-code' ? 'cc' : agent;
  if (active) {
    if (markModelChoice !== false) switchVendor(vendor);
    const patch =
      markModelChoice === false ? patchVendorPrefsPreservingModelChoice : patchVendorPrefs;
    const shouldPatchActiveModel = markModelChoice !== false || effort !== undefined;
    if (shouldPatchActiveModel) {
      patch(vendor, {
        model: modelId,
        providerId: providerId || null,
        ...(effort !== undefined ? { effort: effort as Effort } : {}),
      });
    }
  }
  if (effort !== undefined) {
    if (markModelChoice === true || (active && markModelChoice !== false)) {
      setProviderModelChoice(agent, providerId, modelId, effort as Effort);
    } else {
      setProviderModelEffort(agent, providerId, modelId, effort as Effort);
    }
    if (active) setEffortForModel(modelId, effort as Effort);
  }
  if (fast !== undefined) {
    setProviderModelFast(agent, providerId, modelId, fast);
    if (active) setFastModeForModel(modelId, fast);
  }
  if (thinking !== undefined) setProviderModelThinking(agent, providerId, modelId, thinking);
}
