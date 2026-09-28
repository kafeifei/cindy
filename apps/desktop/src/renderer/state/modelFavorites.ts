/** 收藏是有序配置副本，不是布尔星标；Host 分配持久单调身份并保存 seed 墓碑。
 * Renderer 仅发布已提交副本；编辑一个 uid 不改引擎偏好或默认调档。
 * 编辑成相同配置的旧锚点仍独立保留。
 */
import { useSyncExternalStore } from 'react';
import { EFFORT_VALUES } from '@cindy/model-providers';
import {
  isModelPresentationEngine,
  normalizeModelFavoriteConfig,
  type ModelFavoriteConfig,
  type ModelFavoriteItem,
  type ModelFavoritePatch,
} from '../../shared/modelPresentationPreferences';
import {
  commitHostModelPresentation,
  getHostModelPresentationValue,
  invalidateHostModelPresentationOwner,
  subscribeHostModelPresentation,
  __resetHostModelPresentationForTest,
} from './hostModelPresentationPreferences';
export type {
  ModelFavoriteConfig,
  ModelFavoriteItem,
  ModelFavoritePatch,
} from '../../shared/modelPresentationPreferences';
export const __STORAGE_KEY = 'xdt:modelFavorites:v1';
export function listModelFavorites(): readonly ModelFavoriteItem[] {
  return getHostModelPresentationValue().favorites.items;
}
export function getModelFavorite(uid: string): ModelFavoriteItem | undefined {
  return uid ? listModelFavorites().find((item) => item.uid === uid) : undefined;
}
/** 返回 Host 已持久化的 uid；持久化失败不得返回乐观锚点。 */
export async function addModelFavorite(config: ModelFavoriteConfig): Promise<string> {
  const normalized = normalizeModelFavoriteConfig(config);
  if (!normalized) return '';
  return (
    (await commitHostModelPresentation({ kind: 'favorite-add', config: normalized }))
      ?.favoriteUid ?? ''
  );
}
export async function seedDefaultFavorite(config: ModelFavoriteConfig): Promise<boolean> {
  const normalized = normalizeModelFavoriteConfig(config);
  if (!normalized) return false;
  return !!(await commitHostModelPresentation({ kind: 'favorite-seed', config: normalized }));
}
export async function updateModelFavorite(
  uid: string,
  patch: ModelFavoritePatch,
): Promise<boolean> {
  if (!uid || (patch.agent !== undefined && !isModelPresentationEngine(patch.agent))) return false;
  // 保留原生 UI 的非法 effort 清除语义，IPC 自身严格校验。
  const normalized = { ...patch };
  if ('effort' in patch && !(EFFORT_VALUES as readonly unknown[]).includes(patch.effort))
    normalized.effort = null;
  if ('fast' in patch && patch.fast !== undefined) normalized.fast = patch.fast === true;
  return !!(await commitHostModelPresentation({ kind: 'favorite-update', uid, patch: normalized }));
}
export async function removeModelFavorite(uid: string): Promise<boolean> {
  return !!uid && !!(await commitHostModelPresentation({ kind: 'favorite-remove', uid }));
}
export const subscribeModelFavorites = subscribeHostModelPresentation;
export function useModelFavorites(): readonly ModelFavoriteItem[] {
  return useSyncExternalStore(
    subscribeHostModelPresentation,
    listModelFavorites,
    listModelFavorites,
  );
}
export function setModelFavoritesOwner(_ownerId: string | null): void {
  invalidateHostModelPresentationOwner();
}
export function __resetForTest(): void {
  __resetHostModelPresentationForTest();
}
