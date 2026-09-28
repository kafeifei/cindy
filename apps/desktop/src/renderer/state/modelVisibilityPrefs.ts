/** 可见性显式 override 由 Host 持久化，Renderer 仅保存可替换缓存。
 * 缺省跟随当前目录，不使用冻结的首见默认；收藏、引擎和历史不隐式打开模型。
 * pending/损坏来源失败关闭，仅保留明确成功提交的用户增量。
 */
import { useSyncExternalStore } from 'react';
import { isModelVisible, type AgentKind, type ProviderView } from '@cindy/model-providers';
import { visibilityPreferenceKey } from '../../shared/modelPresentationPreferences';
import { getDataOwnerGeneration } from '../contexts/dataOwnerGeneration';
import {
  commitHostModelPresentation,
  ensureHostModelPresentationLoaded,
  getHostModelPresentationSnapshot,
  getHostModelPresentationVersion,
  invalidateHostModelPresentationOwner,
  subscribeHostModelPresentation,
  retryHostModelPresentationMigration,
  __resetHostModelPresentationForTest,
} from './hostModelPresentationPreferences';

export const __STORAGE_KEY = 'xdt:modelVisibilityPrefs:v1';
export const getModelVisibilityVersion = getHostModelPresentationVersion;
export async function setModelVisibilityOwner(
  ownerId: string | null,
  generation: number,
  mode: 'signed-out' | 'local' | 'cloud',
): Promise<void> {
  invalidateHostModelPresentationOwner();
  const owner = getDataOwnerGeneration();
  if (owner.dataOwnerId !== ownerId || owner.generation !== generation || mode === 'signed-out')
    return;
  await ensureHostModelPresentationLoaded();
}
/** 仅记录初始化历史及已声明别名，不把目录默认写成用户 override。 */
export async function migrateModelVisibilityDefaults(
  ownerId: string | null,
  generation: number,
  providers: readonly ProviderView[],
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!ownerId) return true;
  const current = () => {
    const owner = getDataOwnerGeneration();
    return isCurrent() && owner.dataOwnerId === ownerId && owner.generation === generation;
  };
  if (!current()) return false;
  await ensureHostModelPresentationLoaded();
  if (!current()) return false;
  await retryHostModelPresentationMigration();
  if (!current()) return false;
  return !!(await commitHostModelPresentation(
    {
      kind: 'visibility-catalog',
      scopes: providers.flatMap((provider) =>
        provider.agents.map((agent) => ({
          providerId: provider.id,
          agent,
          models: (provider.models[agent] ?? []).map((model) => ({
            id: model.id,
            ...(model.defaultEnabled === undefined ? {} : { defaultEnabled: model.defaultEnabled }),
          })),
          modelPrefixes: [...(provider.routing[agent]?.modelPrefixes ?? [])],
        })),
      ),
    },
    current,
  ));
}
export function isModelEnabled(
  agent: AgentKind,
  providerId: string,
  model: { id: string; defaultEnabled?: boolean },
): boolean {
  const snapshot = getHostModelPresentationSnapshot();
  const key = visibilityPreferenceKey(agent, providerId, model.id);
  if (snapshot?.status === 'pending-migration') {
    const visibility = snapshot.value.visibility;
    if (Object.hasOwn(visibility.overrides, key)) return visibility.overrides[key]!;
    return (
      visibility.initialization.followCatalogKeys.includes(key) &&
      isModelVisible(undefined, model.defaultEnabled)
    );
  }
  if (snapshot?.status !== 'ready')
    return !getDataOwnerGeneration().dataOwnerId && isModelVisible(undefined, model.defaultEnabled);
  return isModelVisible(snapshot.value.visibility.overrides[key], model.defaultEnabled);
}
export function isModelVisibilityCustomized(
  agent: AgentKind,
  providerId: string,
  modelId: string,
): boolean {
  const snapshot = getHostModelPresentationSnapshot();
  return (
    !!snapshot &&
    (snapshot.status === 'ready' || snapshot.status === 'pending-migration') &&
    Object.hasOwn(
      snapshot.value.visibility.overrides,
      visibilityPreferenceKey(agent, providerId, modelId),
    )
  );
}
export function setModelVisibility(
  agent: AgentKind,
  providerId: string,
  modelId: string,
  enabled: boolean,
): Promise<boolean> {
  return setModelVisibilities(providerId, [{ agent, modelId }], enabled);
}
export function setManyVisibility(
  agent: AgentKind,
  providerId: string,
  modelIds: readonly string[],
  enabled: boolean,
): Promise<boolean> {
  return setModelVisibilities(
    providerId,
    modelIds.map((modelId) => ({ agent, modelId })),
    enabled,
  );
}
export async function setModelVisibilities(
  providerId: string,
  targets: readonly { agent: AgentKind; modelId: string }[],
  enabled: boolean,
): Promise<boolean> {
  if (!providerId || targets.some((target) => !target.modelId)) return false;
  if (!targets.length) return true;
  return !!(await commitHostModelPresentation({
    kind: 'visibility-set',
    providerId,
    targets: [...targets],
    enabled,
  }));
}
export async function resetModelVisibilities(
  providerId: string,
  targets: readonly { agent: AgentKind; modelId: string }[],
): Promise<boolean> {
  if (!providerId || targets.some((target) => !target.modelId)) return false;
  if (!targets.length) return true;
  return !!(await commitHostModelPresentation({
    kind: 'visibility-reset',
    providerId,
    targets: [...targets],
  }));
}
export function useModelVisibilityVersion(): number {
  return useSyncExternalStore(
    subscribeHostModelPresentation,
    getHostModelPresentationVersion,
    getHostModelPresentationVersion,
  );
}
export function __resetForTest(): void {
  __resetHostModelPresentationForTest();
}
