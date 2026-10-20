#!/usr/bin/env node
import fs from "node:fs";

try {
  const file = process.env.CINDY_CLOUD_STATUS_FILE;
  if (!file) throw new Error();
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const age = Date.now() - value.heartbeatAtMs;
  const components = ["auth", "database", "binaries", "maker", "deviceLink"];
  if (
    value.version !== 1 ||
    value.instanceId !== process.env.CINDY_POD_DEVICE_ID ||
    value.phase !== "ready" ||
    !Number.isSafeInteger(value.heartbeatAtMs) ||
    age < 0 ||
    age > 30_000 ||
    components.some((component) => value.readiness?.[component] !== "ready")
  )
    throw new Error();
} catch {
  process.exitCode = 1;
}
