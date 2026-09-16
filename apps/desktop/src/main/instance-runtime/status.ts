import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { InstanceConfig } from "./config.js";
import type { PluginOauthPublicIdentity } from '@cindy/device-link';

export type InstanceReadiness = Record<
  "auth" | "database" | "binaries" | "maker" | "deviceLink",
  boolean
>;

export function buildInstanceStatus(
  config: Pick<InstanceConfig, "deviceId">,
  readiness: InstanceReadiness,
  now: number,
  stopping = false,
  oauthIdentity?: PluginOauthPublicIdentity,
) {
  const ready = Object.values(readiness).every(Boolean);
  return {
    version: 1,
    instanceId: config.deviceId,
    phase: stopping ? "stopping" : ready ? "ready" : "starting",
    heartbeatAtMs: now,
    ...(ready && !stopping && oauthIdentity ? {oauthIdentity} : {}),
    readiness: Object.fromEntries(
      Object.entries(readiness).map(([component, passed]) => [
        component,
        passed ? "ready" : "not-ready",
      ]),
    ),
    idle: {
      maySuspend: false,
      blockers: ["activity-unknown"],
      lastBusyAtMs: now,
      nextWakeAtMs: null,
    },
  };
}

export function startInstanceStatus(
  config: InstanceConfig,
  read: () => InstanceReadiness,
  onFailure: () => void,
  readOauthIdentity: () => PluginOauthPublicIdentity | undefined = () => undefined,
): () => void {
  const write = (stopping = false): void => {
    const temporary = `${config.statusFile}.${randomUUID()}`;
    try {
      fs.mkdirSync(path.dirname(config.statusFile), {
        recursive: true,
        mode: 0o700,
      });
      fs.writeFileSync(
        temporary,
        JSON.stringify(
          buildInstanceStatus(config, read(), Date.now(), stopping, readOauthIdentity()),
        ),
        { flag: "wx", mode: 0o600 },
      );
      fs.renameSync(temporary, config.statusFile);
    } catch {
      onFailure();
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  write();
  const timer = setInterval(write, 5_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    write(true);
  };
}
