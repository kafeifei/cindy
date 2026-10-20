import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("CIS probe requires fresh, matching, complete readiness", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cindy-instance-health-test-"),
  );
  const file = path.join(root, "status.json");
  const script = fileURLToPath(new URL("./healthcheck.mjs", import.meta.url));
  const probe = (value) => {
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    return spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        CINDY_CLOUD_STATUS_FILE: file,
        CINDY_POD_DEVICE_ID: "test-device",
      },
      encoding: "utf8",
    }).status;
  };
  const ready = {
    version: 1,
    instanceId: "test-device",
    phase: "ready",
    heartbeatAtMs: Date.now(),
    readiness: {
      auth: "ready",
      database: "ready",
      binaries: "ready",
      maker: "ready",
      deviceLink: "ready",
    },
  };
  try {
    assert.equal(probe(ready), 0);
    assert.equal(probe({ ...ready, heartbeatAtMs: Date.now() - 31_000 }), 1);
    assert.equal(probe({ ...ready, heartbeatAtMs: Date.now() + 60_000 }), 1);
    assert.equal(probe({ ...ready, heartbeatAtMs: String(Date.now()) }), 1);
    assert.equal(
      probe({ ...ready, instanceId: "control-plane-instance-id" }),
      1,
    );
    assert.equal(probe({ ...ready, phase: "stopping" }), 1);
    for (const component of Object.keys(ready.readiness)) {
      assert.equal(
        probe({
          ...ready,
          readiness: { ...ready.readiness, [component]: "unknown" },
        }),
        1,
      );
    }
    assert.equal(probe({}), 1);
    assert.equal(probe(null), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
