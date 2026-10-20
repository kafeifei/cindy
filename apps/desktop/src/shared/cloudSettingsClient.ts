import { z } from 'zod';
import {
  settingsWebResultSchema,
  settingsWebUpdateSchema,
  type SettingsWebResult,
} from './settingsWeb';
import { managementCommandSchema, type ManagementCommand } from './settingsManagement';
import { cloudSettingsDomainSchema, type CloudSettingsDomain } from './cloudSettings';

// Local IPC and the proposed CIS native caller envelope. Business commands use
// settingsWeb unchanged. CIS must implement this caller envelope before release.
export const cloudClientCapabilitiesSchema = z.object({
  runtimeId: z.string().uuid(),
  domains: z.array(z.string().min(1).max(128)).max(64),
  readBatch: z.literal(true).optional(),
  managementV1: z.literal(true).optional(),
  resultWait: z.literal(true).optional(),
  resourceCpuCores: z.number().int().positive().max(65536).optional(),
});
export const cloudClientSessionSchema = cloudClientCapabilitiesSchema
  .extend({
    sessionId: z.string().uuid(),
    instanceId: z.string().min(1).max(128),
    deviceId: z.string().min(1).max(160),
  })
  .strict();
export const cloudClientOpenSchema = cloudClientCapabilitiesSchema
  .extend({
    handle: z.string().uuid(),
    instanceId: z.string().min(1).max(128),
    deviceId: z.string().min(1).max(160),
    ownerGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type CloudClientOpen = z.infer<typeof cloudClientOpenSchema>;
export const cloudClientQueueViewSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum(['queued', 'running', 'complete', 'unknown']),
    result: settingsWebResultSchema.optional(),
  })
  .strict()
  .refine((v) => (v.status === 'complete') === (v.result !== undefined));
export const cloudClientHandleSchema = z.object({ handle: z.string().uuid() }).strict();
export const cloudClientReadSchema = cloudClientHandleSchema
  .extend({
    domains: z
      .array(cloudSettingsDomainSchema)
      .min(1)
      .max(32)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const cloudClientSaveSchema = cloudClientHandleSchema
  .extend({ change: settingsWebUpdateSchema })
  .strict();
export const cloudClientReceiptSchema = cloudClientHandleSchema
  .extend({ operationId: z.string().uuid() })
  .strict();
export const cloudClientManageSchema = cloudClientHandleSchema
  .extend({ command: managementCommandSchema })
  .strict();
export interface CloudSettingsRendererApi {
  instanceList(
    input: Record<string, never>,
  ): Promise<import('./cloudInstanceControl').CloudInstanceView[]>;
  instanceClaim(
    input: Record<string, never>,
  ): Promise<import('./cloudInstanceControl').CloudInstanceView[]>;
  instanceInitialize(input: { deviceId: string }): Promise<void>;
  instanceRead(input: {
    deviceId: string;
  }): Promise<import('./cloudInstanceControl').CloudInstanceView>;
  instancePower(input: { deviceId: string; action: 'wake' | 'sleep' }): Promise<void>;
  instancePolicy(input: {
    deviceId: string;
    change: import('./cloudInstanceControl').CloudMaintenanceEdit;
  }): Promise<import('./cloudInstanceControl').CloudMaintenanceView>;
  open(input: { deviceId: string }): Promise<CloudClientOpen>;
  read(input: {
    handle: string;
    domains: readonly CloudSettingsDomain[];
  }): Promise<SettingsWebResult[]>;
  save(input: z.infer<typeof cloudClientSaveSchema>): Promise<SettingsWebResult>;
  receipt(input: { handle: string; operationId: string }): Promise<SettingsWebResult>;
  manage(input: { handle: string; command: ManagementCommand }): Promise<SettingsWebResult>;
  cancelAuthorizations(input: { handle: string }): Promise<void>;
  close(input: { handle: string }): Promise<void>;
}
export const CLOUD_CLIENT_CHANNELS = {
  instanceList: 'cloud-settings-client:instance-list',
  instanceClaim: 'cloud-settings-client:instance-claim',
  instanceInitialize: 'cloud-settings-client:instance-initialize',
  instanceRead: 'cloud-settings-client:instance-read',
  instancePower: 'cloud-settings-client:instance-power',
  instancePolicy: 'cloud-settings-client:instance-policy',
  open: 'cloud-settings-client:open',
  read: 'cloud-settings-client:read',
  save: 'cloud-settings-client:save',
  receipt: 'cloud-settings-client:receipt',
  manage: 'cloud-settings-client:manage',
  cancelAuthorizations: 'cloud-settings-client:cancel-authorizations',
  close: 'cloud-settings-client:close',
} as const;
export { CLOUD_CLIENT_ERRORS, type CloudClientErrorCode } from './cloudSettingsErrors';
