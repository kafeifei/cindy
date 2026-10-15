import { broadcastAnalyticsSettingsChange } from '../analyticsSettingsService.js';
import { getMakerIfReady } from '../maker-host/index.js';
import { getSubagentModelSettingsStore } from '../maker-host/subagent-model-settings-store.js';
import { additionalSettingsRuntime, additionalModelRuntime, additionalLiveApplication } from './additionalRuntime.js';
import type { AdditionalSettingsDomain } from '../../shared/settingsEditableCatalog.js';
import { currentSettingsOwner, assertSettingsOwner } from './personalization.js';
import { inspectAdditionalSettings } from './additional.js';
import { readMemorySettings } from '../maker-host/memory-settings-store.js';

/** Apply through the same runtime services as native settings, preserving busy turns. */
export async function applyAdditionalSettings(domain: AdditionalSettingsDomain, revision: string, changedKeys?: readonly string[]): Promise<void> {
  if (domain === 'modelContext' || domain === 'modelAccess' || domain === 'providerNames' || domain === 'modelPrices') {
    const runtime = additionalModelRuntime();
    if (!runtime && getMakerIfReady()) throw new Error('NOT_READY');
    if (domain === 'modelContext') await runtime?.refreshContext();
    else if (domain === 'modelPrices') runtime?.pricingChanged();
    else runtime?.accessChanged();
    return;
  }
  if (['computerTools', 'androidTools', 'browserTools'].includes(domain)) {
    const runtime = additionalModelRuntime();
    if (!runtime && getMakerIfReady()) throw new Error('NOT_READY');
    await runtime?.refreshTools(); return;
  }
  if (domain === 'chatEmbedding') {
    const runtime = additionalSettingsRuntime()?.chatEmbedding;
    if (!runtime) throw new Error('NOT_READY');
    await runtime.reconcile(); return;
  }
  if (domain === 'privacy') {
    broadcastAnalyticsSettingsChange();
    return;
  }
  if (domain !== 'memory' && domain !== 'contacts' && domain !== 'subagentModel') return;
  const inspect = domain === 'subagentModel' ? () => getSubagentModelSettingsStore().inspect() : inspectAdditionalSettings;
  const owner = currentSettingsOwner();
  if (!owner) throw new Error('OWNER_CHANGED');
  const stillValid = () => {
    try { assertSettingsOwner(owner); return inspect(domain as never).revision === revision; }
    catch { return false; }
  };
  const maker = getMakerIfReady();
  if (!maker) return; // Startup consumes the saved settings.
  const runtime = additionalLiveApplication();
  if (!runtime) throw new Error('NOT_READY');
  const { applyMemoryChangeWithCodexRestart, applyCodexSpawnConfigChangeWithRestart, shutdownAgentMcpEnvironmentsBestEffort } = runtime;
  if (domain === 'subagentModel') {
    if (changedKeys && !changedKeys.includes('codexSmartSubagentRouting')) return;
    await applyCodexSpawnConfigChangeWithRestart(async () => {
      if (!stillValid()) throw new Error('OWNER_CHANGED');
      return {};
    }, stillValid);
    return;
  }
  const applyNativeMemory = async (agent: 'claude-code' | 'codex' | 'pi') => {
    if (!stillValid()) throw new Error('OWNER_CHANGED');
    if (!maker.listAvailableAgents().includes(agent)) return;
    const memory = readMemorySettings();
    if (agent !== 'pi' && memory.maker) await maker.makerMemory?.syncNativeAgentsOff([agent]);
    else await maker.setAgentMemory(agent, agent === 'claude-code' ? memory.claudeCode : memory[agent]);
  };
  await applyMemoryChangeWithCodexRestart({
    stillValid,
    persist: async () => {
      if (!stillValid()) throw new Error('OWNER_CHANGED');
      if (domain === 'memory') {
        const memory = readMemorySettings();
        if (memory.maker) await maker.makerMemory?.enable({ skipAgentSync: true });
        else await maker.makerMemory?.disable();
        await applyNativeMemory('claude-code');
        await applyNativeMemory('pi');
      }
      return {};
    },
    applyRuntime: async () => {
      if (!stillValid()) return;
      if (domain === 'memory') await applyNativeMemory('codex');
      if (!stillValid()) return;
      await shutdownAgentMcpEnvironmentsBestEffort('Host settings');
    },
  });
}
