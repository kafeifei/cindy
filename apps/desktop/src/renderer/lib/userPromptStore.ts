/** 个性化正文只由 Host 持久化；Renderer 仅保留 owner/generation 绑定的显示缓存。 */
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent, isDataOwnerPushStampCurrent } from '../contexts/dataOwnerGeneration';
import type { NativeHostSettingsSnapshot, HostSettingsUpdate } from '../../shared/hostSettings';
import { USER_PROMPT_MAX_LENGTH } from './userPrompt.constants';

export interface UserPromptView {
  value: string;
  ready: boolean;
  unavailable: boolean;
  customized: boolean;
  revision: string | null;
  ownerKey: string;
}
const STORAGE_KEY_PREFIX = 'userPrompt.value';
let activeOwnerId: string | null = null;
let ownerKey = '';
let epoch = 0;
let requestVersion = 0;
let snapshot: NativeHostSettingsSnapshot | null = null;
let view: UserPromptView = { value: '', ready: false, unavailable: false, customized: false, revision: null, ownerKey };
let loading: Promise<void> = Promise.resolve();
let off: (() => void) | null = null;
const subscribers = new Set<(value: string) => void>();
const publish = () => subscribers.forEach(cb => cb(view.value));
function accept(next: NativeHostSettingsSnapshot): void {
  if (!next.ownerStamp || !isDataOwnerPushStampCurrent(next.ownerStamp) || next.ownerStamp.dataOwnerId !== activeOwnerId) return;
  snapshot = next;
  const state = next.userPrompt;
  view = state.status === 'ready'
    ? { value: state.value.userPrompt, ready: true, unavailable: false, customized: state.isCustomized, revision: state.revision, ownerKey }
    : { ...view, ready: false, unavailable: true, revision: null };
  publish();
}
async function load(importLegacy: boolean): Promise<void> {
  const owner = getDataOwnerGeneration();
  const ownerEpoch = epoch;
  const version = ++requestVersion;
  const current = () => ownerEpoch === epoch && version === requestVersion && isDataOwnerGenerationCurrent(owner);
  const api = window.electronAPI?.hostSettings;
  if (!api || !activeOwnerId || activeOwnerId !== owner.dataOwnerId) return;
  try {
    let next = await api.get();
    if (!current() || !next.ownerStamp || !isDataOwnerPushStampCurrent(next.ownerStamp)) return;
    if (importLegacy && next.userPrompt.status === 'ready') {
      let legacy: string | null = null;
      try {
        legacy = localStorage.getItem(`${STORAGE_KEY_PREFIX}.${activeOwnerId}`);
        const claimed = localStorage.getItem('userPrompt.hostMigrationOwner');
        if (legacy === null && (!claimed || claimed === activeOwnerId)) legacy = localStorage.getItem(STORAGE_KEY_PREFIX);
      } catch { /* 本地旧值不可读时不伪造迁移数据。 */ }
      if (legacy !== null) {
        next = await api.importPrompt({ ownerStamp: next.ownerStamp, expectedRevision: next.userPrompt.revision, userPrompt: legacy });
        if (ownerEpoch !== epoch || !isDataOwnerGenerationCurrent(owner)) return;
        // 保留旧正文供冲突恢复；只登记首位 owner，防止其他账号再次认领无作用域的旧值。
        try { if (!localStorage.getItem('userPrompt.hostMigrationOwner')) localStorage.setItem('userPrompt.hostMigrationOwner', activeOwnerId); } catch {}
      }
    }
    if (current()) accept(next);
  } catch (error) {
    if (current()) {
      snapshot = null;
      view = { ...view, ready: false, unavailable: true, revision: null };
      publish();
    }
    throw error;
  }
}
export function setUserPromptOwner(ownerId: string | null): void {
  const key = JSON.stringify([ownerId, getDataOwnerGeneration().generation]);
  if (ownerKey === key) return;
  epoch += 1;
  requestVersion += 1;
  activeOwnerId = ownerId;
  ownerKey = key;
  snapshot = null;
  view = { value: '', ready: false, unavailable: false, customized: false, revision: null, ownerKey };
  publish();
  off?.();
  off = ownerId ? window.electronAPI?.hostSettings?.onChanged(stamp => {
    if (!stamp || !isDataOwnerPushStampCurrent(stamp)) return;
    loading = load(false).catch(() => {});
  }) ?? null : null;
  loading = load(true).catch(() => {});
}
export function getUserPrompt(): string { return view.value; }
export function getUserPromptView(): UserPromptView { return view; }
/** 重新打开设置时回读；先完成当前导入，避免查询抢跑使一次性迁移被跳过。 */
export function refreshUserPrompt(): Promise<void> {
  loading = loading.then(() => load(false)).catch(() => {});
  return loading;
}

/** 成功回执之前不更新缓存；回读失败也不能把已确认保存说成未保存。 */
async function save(change: Pick<HostSettingsUpdate, 'set' | 'clear'>, expectedRevision?: string): Promise<void> {
  const owner = getDataOwnerGeneration();
  const ownerEpoch = epoch;
  await loading;
  if (ownerEpoch !== epoch || !isDataOwnerGenerationCurrent(owner)) throw new Error('OWNER_CHANGED');
  const current = snapshot;
  const api = window.electronAPI?.hostSettings;
  if (!api || !current?.ownerStamp || current.userPrompt.status !== 'ready' || !isDataOwnerPushStampCurrent(current.ownerStamp)) throw new Error('SETTINGS_NOT_READY');
  if (expectedRevision !== undefined && expectedRevision !== current.userPrompt.revision) throw new Error('CONFLICT');
  const operationId = current.operationIds.personalization;
  if (!operationId) throw new Error('SETTINGS_NOT_READY');
  const receipt = await api.update({ domain: 'personalization', ownerStamp: current.ownerStamp, operationId, expectedRevision: current.userPrompt.revision, ...change });
  if (ownerEpoch !== epoch || !isDataOwnerGenerationCurrent(owner)) throw new Error('OWNER_CHANGED');
  if (!receipt.saved) {
    loading = load(false).catch(() => {});
    throw new Error(receipt.code ?? 'SAVE_FAILED');
  }
  requestVersion += 1;
  const customized = !change.clear;
  const value = customized ? change.set!.userPrompt as string : '';
  // 这里只投影 Host 明确确认的本次写入，不乐观更新，也不复用已经消费的 operationId。
  snapshot = null;
  view = { value, customized, ready: false, unavailable: false, revision: receipt.revision ?? null, ownerKey };
  publish();
  loading = load(false).catch(() => {});
}
export async function setUserPrompt(next: string, expectedRevision?: string): Promise<void> {
  if (typeof next !== 'string' || next.length > USER_PROMPT_MAX_LENGTH) throw new Error('INVALID_PARAMS');
  await save({ set: { userPrompt: next } }, expectedRevision);
}
export async function resetUserPrompt(expectedRevision?: string): Promise<void> {
  await save({ clear: ['userPrompt'] }, expectedRevision);
}
export function subscribeUserPrompt(cb: (value: string) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
