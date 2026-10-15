/** Host 持有显式 Harness override；缺省表示跟随推荐，不存推荐快照。
 * localStorage 仅由可信本机连接一次导入，普通读写不再使用。
 */
import { useSyncExternalStore } from 'react';
import {
  enginePreferenceKey,
  isModelPresentationEngine,
  type ModelEngine,
} from '../../shared/modelPresentationPreferences';
import {
  commitHostModelPresentation,
  getHostModelPresentationValue,
  getHostModelPresentationVersion,
  invalidateHostModelPresentationOwner,
  subscribeHostModelPresentation,
  __resetHostModelPresentationForTest,
} from './hostModelPresentationPreferences';
export type { ModelEngine, ModelEngineOverride } from '../../shared/modelPresentationPreferences';
export const __STORAGE_KEY = 'xdt:modelEnginePrefs:v1';
const usable = (providerId: string, modelId: string) =>
  !!providerId && providerId !== '*' && !!modelId;
export function getModelEngineOverride(
  providerId: string,
  modelId: string,
): ModelEngine | undefined {
  if (!usable(providerId, modelId)) return undefined;
  return getHostModelPresentationValue().engines[enginePreferenceKey(providerId, modelId)]?.agent;
}
export async function setModelEngineOverride(
  providerId: string,
  modelId: string,
  agent: ModelEngine,
): Promise<boolean> {
  if (!usable(providerId, modelId) || !isModelPresentationEngine(agent)) return false;
  return !!(await commitHostModelPresentation({ kind: 'engine-set', providerId, modelId, agent }));
}
export async function clearModelEngineOverride(
  providerId: string,
  modelId: string,
): Promise<boolean> {
  if (!usable(providerId, modelId)) return false;
  return !!(await commitHostModelPresentation({ kind: 'engine-clear', providerId, modelId }));
}
export function hasModelEngineOverride(providerId: string, modelId: string): boolean {
  return getModelEngineOverride(providerId, modelId) !== undefined;
}
export function hasAnyModelEngineOverride(): boolean {
  return Object.keys(getHostModelPresentationValue().engines).length > 0;
}
export const subscribeModelEnginePrefs = subscribeHostModelPresentation;
export function useModelEnginePrefsVersion(): number {
  return useSyncExternalStore(
    subscribeHostModelPresentation,
    getHostModelPresentationVersion,
    getHostModelPresentationVersion,
  );
}
/** AuthContext 在此兼容钩子之前发布已确认 owner 世代。 */
export function setModelEnginePrefsOwner(_ownerId: string | null): void {
  invalidateHostModelPresentationOwner();
}
export function __resetForTest(): void {
  __resetHostModelPresentationForTest();
}
