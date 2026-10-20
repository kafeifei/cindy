import {
  parseCloud as parse,
  cloudOwnedInstancesSchema as listSchema,
  projectCloudInstance,
} from './ownedInstances';
import type { z } from 'zod';
import {
  cloudMaintenanceEditSchema,
  cloudMaintenanceViewSchema,
  type CloudMaintenanceEdit,
  type CloudInstanceView,
} from '../../shared/cloudInstanceControl';
import type { CloudClientCaller } from './service';
import { CloudClientError, type CloudClientHttp, type CloudClientIdentity } from './transport';

/** Lifecycle reads stay available while the runtime is asleep. No runtime session,
 * auto-creation, cookie auth, privileged admin endpoint or settings fallback. */
export function createCloudInstanceControl(deps: {
  identity(): CloudClientIdentity | null;
  http: CloudClientHttp;
}) {
  const active = new Map<AbortController, number>();
  const mutations = new Set<string>();
  async function perform<T>(
    caller: CloudClientCaller,
    deviceId: string,
    write: boolean,
    run: (
      call: (path: string, method?: 'GET' | 'POST' | 'PATCH', body?: unknown) => Promise<unknown>,
      target: z.infer<typeof listSchema>['instances'][number],
    ) => Promise<T>,
  ) {
    caller.assertCurrent();
    const identity = deps.identity();
    if (!identity) throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
    const key = JSON.stringify([identity.key, deviceId]);
    if ((write && mutations.has(key)) || active.size >= 32)
      throw new CloudClientError('CLOUD_SETTINGS_BUSY');
    const controller = new AbortController();
    const check = () => {
      caller.assertCurrent();
      if (controller.signal.aborted || deps.identity()?.key !== identity.key)
        throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
    };
    active.set(controller, caller.id);
    if (write) mutations.add(key);
    const call = async (path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) => {
      check();
      const result = await deps.http.request(
        deps.identity()!,
        path,
        method,
        body,
        controller.signal,
        check,
      );
      check();
      return result;
    };
    try {
      const list = parse(listSchema, await call('/instance-login/api/manage/instances'));
      const matches = list.instances.filter((v) => v.deviceId === deviceId);
      if (
        matches.length !== 1 ||
        matches[0]!.status.deviceId !== deviceId ||
        matches[0]!.status.instanceId !== matches[0]!.instanceId ||
        matches[0]!.status.desiredState === 'deleted'
      )
        throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
      return await run(call, matches[0]!);
    } finally {
      active.delete(controller);
      if (write) mutations.delete(key);
    }
  }
  const maintenancePath = (id: string) => `/instances/${encodeURIComponent(id)}/maintenance`;
  return {
    read(caller: CloudClientCaller, deviceId: string): Promise<CloudInstanceView> {
      return perform(caller, deviceId, false, async (call, target) => {
        let maintenance = null;
        try {
          maintenance = parse(
            cloudMaintenanceViewSchema,
            await call(maintenancePath(target.instanceId)),
          );
          if (maintenance.instanceId !== target.instanceId)
            throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
        } catch (error) {
          if (!(error instanceof CloudClientError) || error.code !== 'CLOUD_SETTINGS_UNSUPPORTED')
            throw error;
        }
        return { ...projectCloudInstance(target), maintenance };
      });
    },
    power(caller: CloudClientCaller, deviceId: string, action: 'wake' | 'sleep') {
      return perform(caller, deviceId, true, async (call, target) => {
        // Always send the resolved explicit ID; never create a default instance.
        const desired = action === 'wake' ? 'running' : 'stopped';
        if (target.status.desiredState === desired) return;
        try {
          if (action === 'wake')
            await call('/instance-login/api/manage/instances/wake', 'POST', {
              instanceId: target.instanceId,
            });
          else
            await call(
              `/instance-login/api/manage/instances/${encodeURIComponent(target.instanceId)}/stop`,
              'POST',
              {},
            );
        } catch (error) {
          if (error instanceof CloudClientError && error.code === 'CLOUD_SETTINGS_SCOPE_CHANGED')
            throw error;
          throw new CloudClientError('CLOUD_SETTINGS_SAVE_UNCONFIRMED');
        }
      });
    },
    policy(caller: CloudClientCaller, deviceId: string, raw: CloudMaintenanceEdit) {
      const change = parse(cloudMaintenanceEditSchema, raw);
      return perform(caller, deviceId, true, async (call, target) => {
        const path = maintenancePath(target.instanceId);
        const current = parse(cloudMaintenanceViewSchema, await call(path));
        if (current.instanceId !== target.instanceId)
          throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
        if (
          current.revision !== change.revision ||
          current.defaultsRevision !== change.defaultsRevision
        )
          throw new CloudClientError('CLOUD_SETTINGS_CONFLICT');
        // The client cannot silently alter an existing deferred-task policy.
        if (current.raw.scheduledTaskPolicy !== 'protect')
          throw new CloudClientError('CLOUD_SETTINGS_UNSUPPORTED');
        try {
          const saved = parse(
            cloudMaintenanceViewSchema,
            await call(path, 'PATCH', { ...change, scheduledTaskPolicy: 'protect' }),
          );
          if (saved.instanceId !== target.instanceId)
            throw new CloudClientError('CLOUD_SETTINGS_SCOPE_CHANGED');
          return saved;
        } catch (error) {
          if (
            error instanceof CloudClientError &&
            ['CLOUD_SETTINGS_SCOPE_CHANGED', 'CLOUD_SETTINGS_CONFLICT'].includes(error.code)
          )
            throw error;
          throw new CloudClientError('CLOUD_SETTINGS_SAVE_UNCONFIRMED');
        }
      });
    },
    invalidate(callerId?: number) {
      for (const [controller, id] of active)
        if (callerId === undefined || id === callerId) controller.abort();
    },
  };
}
