import { z } from 'zod';
import {
  cloudInstanceTargetSchema,
  cloudInstancePowerSchema,
  cloudInstancePolicySchema,
  cloudInstanceUpgradeSchema,
} from '../../shared/cloudInstanceControl';
import {
  cloudClientHandleSchema,
  cloudClientReadSchema,
  cloudClientSaveSchema,
  cloudClientReceiptSchema,
  cloudClientManageSchema,
} from '../../shared/cloudSettingsClient';
import { throwIpcError } from '../utils/ipcValidate';
import { CloudClientError } from './transport';
import type { CloudClientCaller, createCloudSettingsService } from './service';

/** Thin, injectable IPC handlers; the Electron adapter supplies the trusted caller. */
export function cloudSettingsClientHandlers(
  service: ReturnType<typeof createCloudSettingsService>,
) {
  function handler<T, R>(
    schema: z.ZodType<T>,
    run: (caller: CloudClientCaller, input: T) => Promise<R>,
  ) {
    return async (caller: CloudClientCaller, raw: unknown): Promise<R> => {
      caller.assertCurrent();
      const input = schema.safeParse(raw);
      if (!input.success) throwIpcError('INVALID_PARAMS', 'Invalid cloud settings request');
      try {
        return await run(caller, input.data);
      } catch (error) {
        if (error instanceof CloudClientError) throwIpcError(error.code, error.code);
        throwIpcError('CLOUD_SETTINGS_UNAVAILABLE', 'Cloud settings request failed');
      }
    };
  }
  return {
    instanceList: handler(z.object({}).strict(), (c) => service.instanceList(c)),
    instanceClaim: handler(z.object({}).strict(), (c) => service.instanceClaim(c)),
    instanceInitialize: handler(cloudInstanceTargetSchema, (c, v) =>
      service.instanceInitialize(c, v.deviceId),
    ),
    instanceRead: handler(cloudInstanceTargetSchema, (c, v) => service.instanceRead(c, v.deviceId)),
    instanceUpgrade: handler(cloudInstanceUpgradeSchema, (c, v) =>
      service.instanceUpgrade(c, v.deviceId, v.requestId),
    ),
    instancePower: handler(cloudInstancePowerSchema, (c, v) =>
      service.instancePower(c, v.deviceId, v.action),
    ),
    instancePolicy: handler(cloudInstancePolicySchema, (c, v) =>
      service.instancePolicy(c, v.deviceId, v.change),
    ),
    open: handler(z.object({ deviceId: z.string().min(1).max(160) }).strict(), (c, v) =>
      service.open(c, v.deviceId),
    ),
    read: handler(cloudClientReadSchema, (c, v) => service.read(c, v.handle, v.domains)),
    save: handler(cloudClientSaveSchema, (c, v) => service.save(c, v.handle, v.change)),
    receipt: handler(cloudClientReceiptSchema, (c, v) =>
      service.receipt(c, v.handle, v.operationId),
    ),
    manage: handler(cloudClientManageSchema, (c, v) => service.manage(c, v.handle, v.command)),
    cancelAuthorizations: handler(cloudClientHandleSchema, (c, v) =>
      service.cancelAuthorizations(c, v.handle),
    ),
    close: handler(cloudClientHandleSchema, (c, v) => service.close(c, v.handle)),
  };
}
