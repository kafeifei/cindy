/** 收藏是有序配置副本，不是布尔星标；Host 分配持久单调身份并保存 seed 墓碑。
 * Renderer 仅发布已提交副本；编辑一个 uid 不改引擎偏好或默认调档。
 * 编辑成相同配置的旧锚点仍独立保留。
 */
import { useSyncExternalStore } from 'react';
import { parseModelFavoriteMutation, sameModelFavorite, type ModelFavoriteMutation } from '@cindy/device-link';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '../contexts/dataOwnerGeneration';
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
  ensureHostModelPresentationLoaded,
  getHostModelPresentationSnapshot,
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

/** Compatibility for upstream remote favorites; persistence remains Host-owned. */
export async function accessHostModelFavorites(
  ownerId: string | null,
  mutation?: ModelFavoriteMutation,
  assertCaller: () => void = () => {},
): Promise<readonly ModelFavoriteItem[]> {
  const owner = getDataOwnerGeneration();
  const assertOwner = () => {
    assertCaller();
    if (!ownerId || owner.dataOwnerId !== ownerId || !isDataOwnerGenerationCurrent(owner))
      throw new Error('Favorites owner not ready');
  };
  assertOwner();
  await ensureHostModelPresentationLoaded();
  assertOwner();
  const read = () => {
    const snapshot = getHostModelPresentationSnapshot();
    if (snapshot?.status !== 'ready') throw new Error('Favorites host not ready');
    return snapshot.value.favorites.items;
  };
  if (!mutation) return read();
  const op = parseModelFavoriteMutation(mutation);
  const guard = () => {
    assertOwner();
    if (op.kind !== 'add') {
      const current = read().find(item => item.uid === op.expected.uid);
      if (!current || !sameModelFavorite(current, op.expected))
        throw new Error('Favorite changed; refresh before retrying');
    }
    return true;
  };
  guard();
  const receipt = await commitHostModelPresentation(op.kind === 'add'
    ? { kind: 'favorite-add', config: normalizeModelFavoriteConfig(op.item)! }
    : op.kind === 'remove' ? { kind: 'favorite-remove', uid: op.expected.uid }
    : { kind: 'favorite-update', uid: op.expected.uid, patch: {
      agent: op.item.agent, effort: op.item.effort ?? null, fast: !!op.item.fast,
    } }, guard);
  assertOwner();
  if (!receipt || receipt.snapshot.status !== 'ready') throw new Error('Favorite changed or save failed');
  return receipt.snapshot.value.favorites.items;
}
