import { managementCommandSchema, managementResultSchema } from './settingsManagement.js';
import { z } from 'zod';
import { ADDITIONAL_SETTINGS_DOMAINS, additionalSettingsSchemas, normalizeAdditionalSettingsChange, settingsEditableValueSchema } from './settingsEditableCatalog.js';

/** Separate from the public read-only snapshot. These values belong to the signed-in owner. */
export const settingsWebDomainSchema = z.enum(['newTaskDefaults', 'personalization', 'databaseWarning', 'appearance', ...ADDITIONAL_SETTINGS_DOMAINS]);
export const SETTINGS_WEB_MAX_BYTES = 64 * 1024;
/** Catalog routes include every supported engine; saved override limits remain separate. */
export const SETTINGS_WEB_MAX_CHOICES = 512;
export const SETTINGS_WEB_COMMAND_TTL_MS = 30_000;
export const SETTINGS_WEB_RUNTIME_TTL_MS = 15_000;
export const SETTINGS_WEB_RETENTION_MS = 10 * 60_000;
const id = z.string().uuid();
const revision = z.string().min(1).max(128);
const routeId = z.string().trim().min(1).max(256).regex(/^[^\x00-\x1f]+$/u);
const effort = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const newTask = z.object({ harness: z.enum(['claude-code', 'codex', 'pi']), providerId: routeId.nullable(), modelId: routeId.nullable(), effort: effort.nullable(), fast: z.boolean(), thinking: z.boolean(), worktree: z.boolean(), planMode: z.boolean() }).strict();
const appearance = z.object({ uiFamily: z.string().trim().max(256), codeFamily: z.string().trim().max(256), uiSize: z.number().int().min(12).max(24), codeSize: z.number().int().min(10).max(24), windowZoom: z.number().min(0.5).max(3).refine(v => Math.abs(v * 10 - Math.round(v * 10)) < 1e-8) }).strict();
const database = z.object({ thresholdGiB: z.number().min(1).max(1024), disabled: z.boolean() }).strict();
const personalization = z.object({ userPrompt: z.string().max(8000) }).strict();
const fields = {
  newTaskDefaults: newTask.keyof().options,
  personalization: personalization.keyof().options,
  databaseWarning: database.keyof().options,
  appearance: appearance.keyof().options,
};
const updateBase = { expectedRevision: revision, operationId: id, clear: z.array(z.string()).max(8).optional() };
const nativeSettingsWebUpdateSchema = z.discriminatedUnion('domain', [
  z.object({ ...updateBase, domain: z.literal('newTaskDefaults'), set: newTask.extend({ providerId: routeId, modelId: routeId }).partial().optional() }).strict(),
  z.object({ ...updateBase, domain: z.literal('personalization'), set: personalization.partial().optional() }).strict(),
  z.object({ ...updateBase, domain: z.literal('databaseWarning'), set: database.partial().optional() }).strict(),
  z.object({ ...updateBase, domain: z.literal('appearance'), set: appearance.partial().optional() }).strict(),
]).superRefine((value, ctx) => {
  const set = Object.keys(value.set ?? {});
  const clear = value.clear ?? [];
  if (!set.length && !clear.length || clear.some(key => !(fields[value.domain] as string[]).includes(key) || set.includes(key))
    || new Set(clear).size !== clear.length) ctx.addIssue({ code: 'custom', message: 'invalid settings change' });
});
const additionalDomain = z.enum(ADDITIONAL_SETTINGS_DOMAINS as [typeof ADDITIONAL_SETTINGS_DOMAINS[number], ...typeof ADDITIONAL_SETTINGS_DOMAINS[number][]]);
const workspaceId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const additionalUpdate = z.object({ ...updateBase, domain: additionalDomain, workspaceId: workspaceId.optional(), set: z.record(z.string(), z.unknown()).optional(), clear: z.array(z.string()).max(16).optional() }).strict()
  .superRefine((value, ctx) => { try { normalizeAdditionalSettingsChange(value.domain, value.set, value.clear); }
    catch { ctx.addIssue({ code: 'custom', message: 'invalid settings change' }); }
    if ((value.domain === 'workspaceTools') !== (value.workspaceId !== undefined)) ctx.addIssue({ code: 'custom', message: 'invalid workspace scope' }); });
export const settingsWebUpdateSchema = z.union([nativeSettingsWebUpdateSchema, additionalUpdate]);
const batchDomains = z.array(settingsWebDomainSchema).min(1).max(64).refine(domains => new Set(domains).size === domains.length);
export const settingsWebCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manage'), command: managementCommandSchema }).strict(),
  z.object({ kind: z.literal('readBatch'), domains: batchDomains }).strict(),
  z.object({ kind: z.literal('read'), domain: settingsWebDomainSchema, workspaceId: workspaceId.optional() }).strict(),
  z.object({ kind: z.literal('update'), change: settingsWebUpdateSchema }).strict(),
  z.object({ kind: z.literal('receipt'), operationId: id }).strict(),
]).refine(value => value.kind !== 'read' || value.workspaceId === undefined || value.domain === 'workspaceTools', 'invalid workspace scope');
export type SettingsWebCommand = z.infer<typeof settingsWebCommandSchema>;
export const settingsWebSubmitSchema = z.object({ requestId: id, runtimeId: id, command: settingsWebCommandSchema }).strict();
export const settingsWebPollSchema = z.object({ runtimeId: id }).strict();
export const settingsWebConnectSchema = z.object({ runtimeId: id, domains: batchDomains, readBatch: z.literal(true).optional(), managementV1: z.literal(true).optional() }).strict();
const modelOption = z.object({ harness: newTask.shape.harness, providerId: routeId, providerName: z.string().min(1).max(256), modelId: routeId, modelName: z.string().min(1).max(256), efforts: z.array(effort).max(7), supportsFast: z.boolean(), supportsThinkingToggle: z.boolean() }).strict();
const readyBase = { status: z.literal('ready'), revision, operationId: id, customizedKeys: z.array(z.string().max(32)).max(8), isCustomized: z.boolean() };
const promptState = z.object({ isCustomized: z.boolean() }).strict();
const nativeReady = z.discriminatedUnion('domain', [
  z.object({ ...readyBase, domain: z.literal('newTaskDefaults'), value: newTask, defaults: newTask, models: z.array(modelOption).max(256) }).strict(),
  z.object({ ...readyBase, domain: z.literal('personalization'), value: promptState, defaults: promptState }).strict(),
  z.object({ ...readyBase, domain: z.literal('databaseWarning'), value: database, defaults: database }).strict(),
  z.object({ ...readyBase, domain: z.literal('appearance'), value: appearance, defaults: appearance }).strict(),
]).refine(value => new Set(value.customizedKeys).size === value.customizedKeys.length
  && value.customizedKeys.every(key => (fields[value.domain] as string[]).includes(key))
  && value.isCustomized === (value.customizedKeys.length > 0), 'invalid override state');
const additionalReady = z.object({ ...readyBase, domain: additionalDomain,
  workspaceId: workspaceId.optional(), workspaceLabel: z.string().min(1).max(512).optional(),
  value: z.record(z.string(), settingsEditableValueSchema),
  defaults: z.record(z.string(), settingsEditableValueSchema),
  customizedKeys: z.array(z.string().max(64)).max(16),
  choices: z.record(z.string(), z.array(z.object({ value: settingsEditableValueSchema, label: z.string().min(1).max(512), efforts: z.array(z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])).max(7).optional(), supportsFast: z.boolean().optional() }).strict()).max(SETTINGS_WEB_MAX_CHOICES)).optional(),
}).strict().superRefine((value, ctx) => {
  const schema = additionalSettingsSchemas[value.domain];
  if ((value.domain === 'workspaceTools') !== (value.workspaceId !== undefined && value.workspaceLabel !== undefined)
    || value.domain !== 'workspaceTools' && (value.workspaceId !== undefined || value.workspaceLabel !== undefined)
    || !schema.safeParse(value.value).success || !schema.safeParse(value.defaults).success
    || new Set(value.customizedKeys).size !== value.customizedKeys.length
    || value.customizedKeys.some(key => !Object.hasOwn(schema.shape, key))
    || value.isCustomized !== (value.customizedKeys.length > 0)) ctx.addIssue({ code: 'custom', message: 'invalid settings state' });
});
const ready = z.union([nativeReady, additionalReady]);
const receipt = z.union([
  z.object({ status: z.enum(['pending', 'unknown']) }).strict(),
  z.object({ status: z.enum(['saved', 'rejected', 'unknown']), operationId: id, domain: settingsWebDomainSchema, saved: z.boolean(), application: z.enum(['next_task', 'next_agent_start', 'applied', 'failed', 'not_applied']), revision: revision.optional(), code: z.string().regex(/^[A-Z_]{1,64}$/u).optional() }).strict()
    .refine(value => value.saved === (value.status === 'saved') && value.saved === (value.application !== 'not_applied'), 'inconsistent receipt'),
]);
const failed = z.object({ ok: z.literal(false), code: z.string().regex(/^[A-Z_]{1,64}$/u) }).strict();
export const settingsWebReadResultSchema = z.union([
  z.object({ ok: z.literal(true), settings: ready }).strict(),
  z.object({ ok: z.literal(true), settings: z.object({ domain: settingsWebDomainSchema, status: z.enum(['unavailable', 'unreadable']), revision: z.null() }).strict() }).strict(),
  failed,
]);
export type SettingsWebReadResult = z.infer<typeof settingsWebReadResultSchema>;
export const settingsWebBatchResultSchema = z.object({
  ok: z.literal(true),
  entries: z.array(z.object({ domain: settingsWebDomainSchema, result: settingsWebReadResultSchema }).strict()).min(1).max(64),
  remainingDomains: z.array(settingsWebDomainSchema).max(63),
}).strict().superRefine((value, ctx) => {
  const domains = [...value.entries.map(entry => entry.domain), ...value.remainingDomains];
  if (domains.length > 64 || new Set(domains).size !== domains.length
    || value.entries.some(entry => entry.result.ok && entry.result.settings.domain !== entry.domain)) {
    ctx.addIssue({ code: 'custom', message: 'invalid settings batch' });
  }
});
export const settingsWebResultSchema = z.union([
  z.object({ ok: z.literal(true), management: managementResultSchema }).strict(),
  settingsWebReadResultSchema,
  settingsWebBatchResultSchema,
  z.object({ ok: z.literal(true), receipt }).strict(),
]).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= SETTINGS_WEB_MAX_BYTES - 512, 'settings response exceeds its budget');
export type SettingsWebResult = z.infer<typeof settingsWebResultSchema>;
export const settingsWebCompleteSchema = z.object({ runtimeId: id, result: settingsWebResultSchema }).strict();
export type SettingsWebEnvelope = { requestId: string; runtimeId: string; sessionKey: string; expiresAtMs: number; command: SettingsWebCommand };

export function parseSettingsWeb<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}
