import { z } from 'zod';
import { settingsWebReadResultSchema } from './settingsWeb.js';

/** Cloud execution settings, deliberately independent of the local settings menu.
 * New domains require an explicit review of the consumer and the native control.
 * The scalar catalog excludes credentials, desktop preferences and CIS lifecycle
 * operations. Authorization uses existing settingsManagement actions. */
// UI projection only. Remote commands use settingsWeb/settingsManagement.
export const CLOUD_SETTINGS_GROUPS = {
  general: ['collaboration', 'agentResource', 'gitSafety', 'lsp'],
  personalization: [
    'personalization',
    'memory',
    'claudeCompaction',
    'piCompaction',
    'contacts',
    'contactsSync',
    'chatEmbedding',
    'silentEncryptedRetry',
    'terminal',
  ],
  providers: [],
  'im-bot': [],
  ghosts: [],
  'builtin-tools': ['builtinTools'],
  'computer-use': ['browserTools', 'computerTools'],
  storage: ['databaseWarning'],
  about: ['diagnostics'],
} as const;
export type CloudSettingsTab = keyof typeof CLOUD_SETTINGS_GROUPS;
export const CLOUD_SETTINGS_DOMAINS = Object.values(CLOUD_SETTINGS_GROUPS).flat();
export type CloudSettingsDomain = (typeof CLOUD_SETTINGS_DOMAINS)[number];
export const cloudSettingsDomainSchema = z.enum(
  CLOUD_SETTINGS_DOMAINS as [CloudSettingsDomain, ...CloudSettingsDomain[]],
);
/** Local presentation flags, projected from existing capabilities; never a Host protocol. */
export interface CloudSettingsCapabilities {
  version: 1;
  deviceId: string;
  runtimeId: string;
  ownerGeneration: number;
  providerAuthorization?: 1;
  botAuthorization?: 1;
  pluginAuthorization?: 1;
  mcpAuthorization?: 1;
  cpuCount?: number;
  domains: CloudSettingsDomain[];
}
const values = z.record(
  z.string(),
  z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]),
);
export const cloudSettingsStateSchema = z
  .object({
    domain: cloudSettingsDomainSchema,
    status: z.enum(['ready', 'unavailable', 'unreadable']),
    revision: z.string().min(1).max(128).nullable(),
    operationId: z.string().uuid().optional(),
    value: values.optional(),
    defaults: values.optional(),
    customizedKeys: z.array(z.string()).max(16).optional(),
    isCustomized: z.boolean().optional(),
    choices: z
      .record(
        z.string(),
        z.array(z.object({ value: z.string(), label: z.string().max(512) }).strict()).max(64),
      )
      .optional(),
  })
  .strict()
  .superRefine((state, ctx) => {
    // Reuse the existing business validator for every real cloud state. Only the
    // in-memory preview has a prompt body; it is never accepted by Main.
    if (state.domain !== 'personalization') {
      if (!settingsWebReadResultSchema.safeParse({ ok: true, settings: state }).success)
        ctx.addIssue({ code: 'custom', message: 'invalid cloud settings state' });
      return;
    }
    if (state.status !== 'ready') {
      if (state.revision !== null || state.value || state.defaults || state.operationId)
        ctx.addIssue({ code: 'custom', message: 'invalid unavailable state' });
      return;
    }
    const schema = z.object({ userPrompt: z.string().max(8000) }).strict();
    if (
      !state.revision ||
      !state.operationId ||
      !schema.safeParse(state.value).success ||
      !schema.safeParse(state.defaults).success ||
      !state.customizedKeys ||
      state.customizedKeys.some((key) => !Object.hasOwn(schema.shape, key)) ||
      new Set(state.customizedKeys).size !== state.customizedKeys.length ||
      state.isCustomized !== state.customizedKeys.length > 0
    )
      ctx.addIssue({ code: 'custom', message: 'invalid cloud settings state' });
  });
export type CloudSettingsState = z.infer<typeof cloudSettingsStateSchema>;
