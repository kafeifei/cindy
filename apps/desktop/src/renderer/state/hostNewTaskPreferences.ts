import type { NativeHostSettingsSnapshot } from '../../shared/hostSettings';
import type { NewTaskPreferenceHistory, PreferenceVendor } from '../../shared/newTaskPreferenceHistory';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent, isDataOwnerPushStampCurrent } from '../contexts/dataOwnerGeneration';
import { getDraftForOwnerPreferenceSync, configureHostDraftPersistence, applyHostDraftPreferences, type NewMakerDraft, type VendorPrefs } from './newMakerDraft';
import { snapshotForHost, configureHostProviderMemoryPersistence, applyHostProviderMemory } from './providerModelMemory';
import { toast } from '../lib/toast';
import i18n from '../i18n';

/** 白名单迁移不包含草稿、附件、工作目录、额外授权目录或远端目标。 */
function capture(ownerId: string | null): NewTaskPreferenceHistory | null {
  const draft = getDraftForOwnerPreferenceSync(ownerId);
  const providerModelMemory = snapshotForHost(ownerId);
  if (!draft || !providerModelMemory) return null;
  return structuredClone({
    vendor: draft.vendor === 'orca' ? 'cc' : draft.vendor,
    lastByVendor: Object.fromEntries((['cc', 'codex', 'pi'] as const).map(v => [v, { model: draft.lastByVendor[v].model, effort: draft.lastByVendor[v].effort, providerId: draft.lastByVendor[v].providerId ?? null, permissionMode: draft.lastByVendor[v].permissionMode, planMode: draft.lastByVendor[v].planMode }])),
    modelChosenByVendor: Object.fromEntries((['cc', 'codex', 'pi'] as const).map(v => [v, draft.modelChosenByVendor[v] === true])),
    defaultTupleCustomized: draft.defaultTupleCustomized,
    defaultTupleSelectionCustomized: draft.defaultTupleSelectionCustomized,
    effortByModel: draft.effortByModel, fastModeByModel: draft.fastModeByModel,
    worktreeEnabled: draft.worktreeEnabled, worktreePreferenceCustomized: draft.worktreePreferenceCustomized,
    providerModelMemory,
  });
}
function applyHistory(history: NewTaskPreferenceHistory): void {
  // 缺历史的 Harness 必须为空，不能从未迁移的 localStorage 或 Opus 种子拼出第二真源。
  const empty = (): VendorPrefs => ({ model: '', providerId: null, effort: '' as VendorPrefs['effort'], permissionMode: 'auto', planMode: false });
  const lastByVendor = { cc: empty(), codex: empty(), pi: empty(), orca: empty() };
  for (const key of ['cc', 'codex', 'pi'] as const) if (history.lastByVendor[key]) lastByVendor[key] = { ...lastByVendor[key], ...history.lastByVendor[key] } as VendorPrefs;
  applyHostProviderMemory(history.providerModelMemory as Parameters<typeof applyHostProviderMemory>[0]);
  applyHostDraftPreferences({
    vendor: history.vendor, lastByVendor, modelChosenByVendor: history.modelChosenByVendor,
    defaultTupleSelectionCustomized: history.defaultTupleSelectionCustomized,
    defaultTupleCustomized: history.defaultTupleCustomized,
    worktreeEnabled: history.worktreeEnabled, worktreePreferenceCustomized: history.worktreePreferenceCustomized,
    effortByModel: history.effortByModel as NewMakerDraft['effortByModel'], fastModeByModel: history.fastModeByModel,
  });
}
function apply(snapshot: NativeHostSettingsSnapshot): void {
  if (snapshot.newTaskDefaults.status !== 'ready') return;
  const { value, customizedKeys: customized } = snapshot.newTaskDefaults;
  const history = snapshot.history;
  const vendor: PreferenceVendor = value.harness === 'claude-code' ? 'cc' : value.harness;
  const selection = customized.some(k => ['harness', 'providerId', 'modelId'].includes(k));
  const providerModelMemory = structuredClone(history?.providerModelMemory ?? {});
  if (value.modelId && value.providerId) {
    // 活动型号的 Fast/Thinking 是 Host 当前值；其它型号历史仍原样保留。
    const key = `${value.harness}:${value.providerId}`;
    const memory = providerModelMemory[key] ?? { lastModel: '', effortByModel: {}, fastByModel: {}, thinkingByModel: {} };
    memory.fastByModel[value.modelId] = value.fast; memory.thinkingByModel[value.modelId] = value.thinking;
    providerModelMemory[key] = memory;
  }
  applyHistory({
    vendor,
    lastByVendor: { ...history?.lastByVendor, [vendor]: { ...history?.lastByVendor[vendor], model: value.modelId ?? '', providerId: value.providerId, effort: value.effort ?? '', planMode: value.planMode } },
    modelChosenByVendor: { ...history?.modelChosenByVendor, [vendor]: selection },
    defaultTupleSelectionCustomized: selection,
    defaultTupleCustomized: customized.some(k => ['harness', 'providerId', 'modelId', 'effort', 'fast', 'thinking'].includes(k)),
    worktreeEnabled: value.worktree, worktreePreferenceCustomized: customized.includes('worktree'),
    effortByModel: history?.effortByModel ?? {},
    fastModeByModel: { ...history?.fastModeByModel, ...(value.modelId ? { [value.modelId]: value.fast } : {}) },
    providerModelMemory,
  });
}

/** 仅合并本次等待加载期间用户实际改过的叶子，不重放旧 localStorage 整表。 */
function mergeEdits(before: unknown, after: unknown, target: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return target;
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!record(before) || !record(after)) return after;
  const next = { ...(record(target) ? target : {}) };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (!(key in after)) delete next[key];
    else next[key] = mergeEdits(before[key], after[key], next[key]);
  }
  return next;
}

/** 每个 owner/generation 一条 CAS 写队列；冲突回读，绝不拿新 revision 重放陈旧整表。 */
export function connectHostNewTaskPreferences(): () => void {
  const api = window.electronAPI?.hostSettings;
  if (!api) return () => {};
  const owner = getDataOwnerGeneration();
  if (!owner.dataOwnerId) return () => {};
  const legacy = capture(owner.dataOwnerId);
  let stopped = false;
  let ready = false;
  let initializing = true;
  let recoveryBase: NewTaskPreferenceHistory | null = null;
  let writing = false;
  let scheduled = false;
  let readSequence = 0;
  let dirty = false;
  let pending: NewTaskPreferenceHistory | null = null;
  let snapshot: NativeHostSettingsSnapshot | null = null;
  let baseline = '';
  const current = () => !stopped && isDataOwnerGenerationCurrent(owner);
  const belongs = (next: NativeHostSettingsSnapshot) => current() && isDataOwnerPushStampCurrent(next.ownerStamp);
  const accept = (next: NativeHostSettingsSnapshot, hydrate = true) => {
    if (!belongs(next)) return false;
    snapshot = next;
    ready = next.newTaskDefaults.status === 'ready';
    if (hydrate) { apply(next); baseline = JSON.stringify(capture(owner.dataOwnerId)); }
    if (!ready) { pending = null; recoveryBase = capture(owner.dataOwnerId); }
    return true;
  };
  const invalidate = () => {
    if (!current()) return;
    ready = false; pending = null;
    recoveryBase = capture(owner.dataOwnerId); baseline = JSON.stringify(recoveryBase);
  };
  const reload = async () => {
    const sequence = ++readSequence;
    const recovering = !ready;
    const before = recoveryBase;
    let next: NativeHostSettingsSnapshot;
    try { next = await api.get(); }
    catch (error) { if (sequence === readSequence) invalidate(); throw error; }
    if (sequence !== readSequence || writing || (!recovering && pending) || !current()) return;
    const edits = recovering ? pending : null;
    if (recovering) pending = null;
    if (!accept(next)) return;
    dirty = false;
    // 读取恢复后只叠加失败之后的新编辑；坏文件期间丢弃的整表绝不重放，也不重试迁移。
    if (ready && edits && before) {
      const base = capture(owner.dataOwnerId);
      if (base) { applyHistory(mergeEdits(before, edits, base) as NewTaskPreferenceHistory); write(); }
    }
  };
  const failed = () => { if (current()) toast.error(i18n.t('hostSettings.saveFailed')); };
  const flush = async () => {
    scheduled = false;
    if (writing || !ready || !current() || !pending || !snapshot?.ownerStamp || snapshot.newTaskDefaults.status !== 'ready') return;
    const history = pending; pending = null; writing = true; ++readSequence;
    baseline = JSON.stringify(history);
    try {
      const next = await api.saveHistory({ ownerStamp: snapshot.ownerStamp, expectedRevision: snapshot.newTaskDefaults.revision, history, importOnly: false });
      const edits = pending; pending = null;
      if (accept(next) && edits) {
        // 回执读取可能已经包含另一窗口的新提交；只叠加排队期间的新编辑，不能携旧整表覆盖。
        const base = capture(owner.dataOwnerId);
        if (base) { applyHistory(mergeEdits(history, edits, base) as NewTaskPreferenceHistory); write(); }
      }
    } catch {
      pending = null;
      dirty = true;
      failed();
    } finally {
      writing = false;
      if (pending && current()) void flush();
      else if (dirty && current()) void reload().catch(failed);
    }
  };
  const write = () => {
    if (!current()) return;
    const history = capture(owner.dataOwnerId);
    if (!history) return;
    if (JSON.stringify(history) === baseline) { pending = null; return; }
    pending = history;
    if (!ready && !initializing) { void reload().catch(failed); return; }
    if (ready && !scheduled) { scheduled = true; queueMicrotask(() => { void flush(); }); }
  };
  configureHostDraftPersistence(write);
  configureHostProviderMemoryPersistence(write);
  const off = api.onChanged(stamp => {
    if (!current() || !isDataOwnerPushStampCurrent(stamp)) return;
    dirty = true;
    if (!initializing && !writing && (!ready || !pending)) void reload().catch(failed);
  });
  void (async () => {
    try {
      let next = await api.get();
      if (!belongs(next)) return;
      // history 一旦存在即有 Host 初始化墓碑；不再对每次挂载发重复的迁移写请求。
      if (legacy && !next.history && next.ownerStamp && next.newTaskDefaults.status === 'ready') {
        try {
          next = await api.saveHistory({ ownerStamp: next.ownerStamp, expectedRevision: next.newTaskDefaults.revision, history: legacy, importOnly: true });
        } catch {
          // 另一窗口或 Host 已改/reset：只回读，绝不更换 revision 后再次迁移。
          next = await api.get();
        }
      }
      if (!belongs(next)) return;
      const edits = pending; pending = null;
      accept(next);
      if (edits && legacy && ready) {
        const base = capture(owner.dataOwnerId);
        if (base) {
          const merged = mergeEdits(legacy, edits, base) as NewTaskPreferenceHistory;
          applyHistory(merged); write();
        }
      } else if (dirty && ready) void reload().catch(failed);
    } catch { invalidate(); failed(); }
    finally {
      initializing = false;
      if (dirty && !ready && current()) { dirty = false; void reload().catch(failed); }
    }
  })();
  return () => { stopped = true; ++readSequence; off(); configureHostDraftPersistence(null); configureHostProviderMemoryPersistence(null); };
}
