export type PreferenceVendor = 'cc' | 'codex' | 'pi';
export interface PreferenceVendorHistory {
  model: string;
  effort: string;
  providerId: string | null;
  /** Existing native UI intent, never writable by settings tools. */
  permissionMode?: string;
  planMode?: boolean;
}
export interface ProviderPreferenceHistory {
  lastModel: string;
  effortByModel: Record<string, string>;
  fastByModel: Record<string, boolean>;
  thinkingByModel: Record<string, boolean>;
}
export interface NewTaskPreferenceHistory {
  vendor: PreferenceVendor;
  lastByVendor: Partial<Record<PreferenceVendor, PreferenceVendorHistory>>;
  modelChosenByVendor: Partial<Record<PreferenceVendor, boolean>>;
  defaultTupleCustomized: boolean;
  defaultTupleSelectionCustomized: boolean;
  effortByModel: Record<string, string>;
  fastModeByModel: Record<string, boolean>;
  worktreeEnabled: boolean;
  worktreePreferenceCustomized: boolean;
  providerModelMemory: Record<string, ProviderPreferenceHistory>;
}
const vendors = ['cc', 'codex', 'pi'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 256 && !/[\x00-\x1f]/.test(v);
function fields(v: Record<string, unknown>, keys: string[]) { if (Object.keys(v).some(k => !keys.includes(k))) throw new Error('INVALID_PREFERENCE_HISTORY'); }
function dictionary(v: unknown, boolean: boolean): void {
  if (!object(v) || Object.keys(v).length > 512) throw new Error('INVALID_PREFERENCE_HISTORY');
  for (const [k, value] of Object.entries(v)) if (!text(k) || (boolean ? typeof value !== 'boolean' : !text(value))) throw new Error('INVALID_PREFERENCE_HISTORY');
}
/** No task text, paths, attachments, device ids or writable directories cross this boundary. */
export function validateNewTaskPreferenceHistory(raw: unknown): asserts raw is NewTaskPreferenceHistory {
  if (!object(raw)) throw new Error('INVALID_PREFERENCE_HISTORY');
  fields(raw, ['vendor', 'lastByVendor', 'modelChosenByVendor', 'defaultTupleCustomized', 'defaultTupleSelectionCustomized', 'effortByModel', 'fastModeByModel', 'worktreeEnabled', 'worktreePreferenceCustomized', 'providerModelMemory']);
  if (typeof raw.vendor !== 'string' || !vendors.includes(raw.vendor)) throw new Error('INVALID_PREFERENCE_HISTORY');
  for (const key of ['defaultTupleCustomized', 'defaultTupleSelectionCustomized', 'worktreeEnabled', 'worktreePreferenceCustomized']) if (typeof raw[key] !== 'boolean') throw new Error('INVALID_PREFERENCE_HISTORY');
  if (!object(raw.lastByVendor) || !object(raw.modelChosenByVendor)) throw new Error('INVALID_PREFERENCE_HISTORY');
  fields(raw.lastByVendor, vendors); fields(raw.modelChosenByVendor, vendors);
  for (const pref of Object.values(raw.lastByVendor)) {
    if (!object(pref)) throw new Error('INVALID_PREFERENCE_HISTORY');
    fields(pref, ['model', 'effort', 'providerId', 'permissionMode', 'planMode']);
    if (!text(pref.model) || !text(pref.effort) || (pref.providerId !== null && !text(pref.providerId))) throw new Error('INVALID_PREFERENCE_HISTORY');
    if (pref.permissionMode !== undefined && !['ask', 'auto', 'bypassPermissions', 'plan', 'default', 'acceptEdits'].includes(String(pref.permissionMode))) throw new Error('INVALID_PREFERENCE_HISTORY');
    if (pref.permissionMode !== undefined && typeof pref.permissionMode !== 'string') throw new Error('INVALID_PREFERENCE_HISTORY');
    if (pref.planMode !== undefined && typeof pref.planMode !== 'boolean') throw new Error('INVALID_PREFERENCE_HISTORY');
  }
  if (Object.values(raw.modelChosenByVendor).some(v => typeof v !== 'boolean')) throw new Error('INVALID_PREFERENCE_HISTORY');
  dictionary(raw.effortByModel, false); dictionary(raw.fastModeByModel, true);
  if (!object(raw.providerModelMemory) || Object.keys(raw.providerModelMemory).length > 128) throw new Error('INVALID_PREFERENCE_HISTORY');
  for (const [key, memory] of Object.entries(raw.providerModelMemory)) {
    if (!text(key) || !/^(claude-code|codex|pi):.+$/.test(key) || !object(memory)) throw new Error('INVALID_PREFERENCE_HISTORY');
    fields(memory, ['lastModel', 'effortByModel', 'fastByModel', 'thinkingByModel']);
    if (!text(memory.lastModel)) throw new Error('INVALID_PREFERENCE_HISTORY');
    dictionary(memory.effortByModel, false); dictionary(memory.fastByModel, true); dictionary(memory.thinkingByModel, true);
  }
}
