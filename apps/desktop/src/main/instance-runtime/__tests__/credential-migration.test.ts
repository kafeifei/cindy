import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeAuthSessionRecord } from "@cindy/auth-client";
import {
  importLegacyResourceCredential,
  importFrozenLegacyResourceCredential,
  prepareLegacyResourceRollback,
  seedLegacyResourceRecoveryProfile,
  verifyResourceCredentialHandoff,
} from "../credential-migration.js";
import { createInstanceStore, type SecretCodec } from "../store.js";
import { InstanceSession, type InstanceRecord } from "../session.js";

const roots: string[] = [];
const originalToken = "00000000-0000-4000-8000-000000000001";
const latestToken = "00000000-0000-4000-8000-000000000002";
const bootstrapToken = "00000000-0000-4000-8000-000000000000";
const identity = {
  deviceId: "cloud-device-0123456789abcdef01234567",
  membershipId: "test-only-membership",
  authBaseUrl: "https://auth.invalid",
  realm: "cn" as const,
};
const accountKey = JSON.stringify([identity.realm, identity.membershipId]);

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cindy-credential-migration-test-"),
  );
  roots.push(root);
  const source = path.join(root, "original");
  const candidate = path.join(root, "candidate");
  const rollback = path.join(root, "rollback");
  for (const directory of [source, candidate, rollback])
    fs.mkdirSync(directory, { mode: 0o700 });
  const codec: SecretCodec = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value) =>
      Buffer.concat([Buffer.from("v11"), Buffer.from(value).reverse()]),
    decryptString: (value) =>
      Buffer.from(value.subarray(3)).reverse().toString("utf8"),
  };
  const file = (directory: string, key: string) =>
    path.join(directory, "safe-storage", `${key}.enc`);
  const seed = (directory: string, key: string, value: string) => {
    fs.mkdirSync(path.join(directory, "safe-storage"), {
      recursive: true,
      mode: 0o700,
    });
    fs.writeFileSync(
      file(directory, key),
      codec.encryptString(value).toString("base64"),
      { mode: 0o600 },
    );
  };
  const read = (directory: string, key: string) =>
    codec.decryptString(
      Buffer.from(fs.readFileSync(file(directory, key), "utf8"), "base64"),
    );
  seed(
    source,
    "cindy_auth_session_v1",
    serializeAuthSessionRecord(identity.realm, originalToken),
  );
  seed(source, "cindy_pod_resource_refresh_token", originalToken);
  seed(source, "cindy_auth_refresh_token", originalToken);
  seed(source, "cindy_pod_membership_id", identity.membershipId);
  seed(
    source,
    "cindy_auth_accounts_v1",
    JSON.stringify({
      version: 1,
      activeAccountKey: accountKey,
      passports: {},
      resources: {
        [accountKey]: {
          realm: identity.realm,
          refreshToken: originalToken,
          metadata: { membershipId: identity.membershipId },
          lastUsedAt: 1,
        },
      },
    }),
  );
  fs.writeFileSync(path.join(source, "old-task.bin"), "test-only-old-task");
  seed(source, "test-only-plugin-credential", "test-only-plugin-secret");
  fs.cpSync(source, rollback, { recursive: true, preserveTimestamps: true });
  fs.chmodSync(path.join(rollback, "safe-storage"), 0o700);
  const assertSourceStopped = vi.fn();
  const forward = () =>
    importLegacyResourceCredential({
      sourceUserDataDir: source,
      targetUserDataDir: candidate,
      identity,
      bootstrapToken,
      codec,
      assertSourceStopped,
    });
  const backward = () =>
    prepareLegacyResourceRollback({
      originalUserDataDir: source,
      candidateUserDataDir: candidate,
      rollbackUserDataDir: rollback,
      identity,
      codec,
      assertSourceStopped,
    });
  const store = createInstanceStore(candidate, codec);
  const snapshot = (directory: string) =>
    Object.fromEntries(
      fs
        .readdirSync(path.join(directory, "safe-storage"))
        .map((name) => [
          name,
          fs
            .readFileSync(path.join(directory, "safe-storage", name))
            .toString("base64"),
        ]),
    );
  return {
    root,
    source,
    candidate,
    rollback,
    codec,
    file,
    seed,
    read,
    forward,
    backward,
    store,
    assertSourceStopped,
    snapshot,
  };
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("explicit resource credential migration between isolated profiles", () => {
  it("prepares a Cindy-only recovery without copying tasks, vault or plugin credentials", () => {
    const test = fixture();
    const recovery = path.join(test.root, "cindy-only-recovery");
    fs.mkdirSync(recovery, { mode: 0o700 });
    importFrozenLegacyResourceCredential({
      sourceUserDataDir: test.source,
      targetUserDataDir: test.candidate,
      identity,
      codec: test.codec,
      assertSourceStopped: test.assertSourceStopped,
    });
    seedLegacyResourceRecoveryProfile({
      candidateUserDataDir: test.candidate,
      recoveryUserDataDir: recovery,
      identity,
      codec: test.codec,
      assertSourceStopped: test.assertSourceStopped,
    });
    expect(fs.readdirSync(recovery)).toEqual(["safe-storage"]);
    expect(fs.readdirSync(path.join(recovery, "safe-storage"))).toHaveLength(4);
    for (const action of ["prepare-profile", "prepare-recovery"] as const) {
      verifyResourceCredentialHandoff({
        action,
        sourceUserDataDir: test.source,
        candidateUserDataDir: test.candidate,
        targetUserDataDir:
          action === "prepare-profile" ? test.candidate : recovery,
        identity,
        codec: test.codec,
      });
    }
    expect(() =>
      seedLegacyResourceRecoveryProfile({
        candidateUserDataDir: test.candidate,
        recoveryUserDataDir: recovery,
        identity,
        codec: test.codec,
        assertSourceStopped: test.assertSourceStopped,
      }),
    ).toThrow("INSTANCE_MIGRATION_TARGET_NOT_EMPTY");
    test.seed(recovery, "cindy_auth_refresh_token", latestToken);
    expect(() =>
      verifyResourceCredentialHandoff({
        action: "prepare-recovery",
        sourceUserDataDir: test.source,
        candidateUserDataDir: test.candidate,
        targetUserDataDir: recovery,
        identity,
        codec: test.codec,
      }),
    ).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
  });
  it("derives migration bootstrap identity internally from the frozen consistent resource session", () => {
    const test = fixture();
    const before = test.snapshot(test.source);
    importFrozenLegacyResourceCredential({
      sourceUserDataDir: test.source,
      targetUserDataDir: test.candidate,
      identity,
      codec: test.codec,
      assertSourceStopped: test.assertSourceStopped,
    });
    expect(test.store.read()).toMatchObject({
      refreshToken: originalToken,
      bootstrapDigest: createHash("sha256").update(originalToken).digest("hex"),
    });
    expect(test.snapshot(test.source)).toEqual(before);
    expect(test.assertSourceStopped).toHaveBeenCalledTimes(3);
  });

  it("imports only the same Pod's current Cindy credential without consuming bootstrap or copying old data", () => {
    const test = fixture();
    const before = test.snapshot(test.source);
    test.forward();
    expect(test.store.read()).toEqual({
      version: 2,
      protocol: "resource-v1",
      deviceId: identity.deviceId,
      membershipId: identity.membershipId,
      authBaseUrl: identity.authBaseUrl,
      bootstrapDigest: createHash("sha256")
        .update(bootstrapToken)
        .digest("hex"),
      refreshToken: originalToken,
    });
    expect(fs.readdirSync(test.candidate)).toEqual(["instance-credentials"]);
    expect(test.snapshot(test.source)).toEqual(before);
    expect(test.assertSourceStopped).toHaveBeenCalledTimes(2);
  });

  it("returns the latest rotated token to a private old-profile copy and preserves the original and plugin credentials", () => {
    const test = fixture();
    const before = test.snapshot(test.source);
    const plugin = fs.readFileSync(
      test.file(test.rollback, "test-only-plugin-credential"),
    );
    test.forward();
    test.store.write({
      ...(test.store.read() as InstanceRecord),
      refreshToken: latestToken,
    });
    test.backward();
    expect(test.read(test.rollback, "cindy_pod_resource_refresh_token")).toBe(
      latestToken,
    );
    expect(test.read(test.rollback, "cindy_auth_refresh_token")).toBe(
      latestToken,
    );
    expect(
      JSON.parse(test.read(test.rollback, "cindy_auth_session_v1"))
        .refreshToken,
    ).toBe(latestToken);
    expect(
      JSON.parse(test.read(test.rollback, "cindy_auth_accounts_v1")).resources[
        accountKey
      ].refreshToken,
    ).toBe(latestToken);
    expect(test.snapshot(test.source)).toEqual(before);
    expect(
      fs.readFileSync(test.file(test.rollback, "test-only-plugin-credential")),
    ).toEqual(plugin);
    expect(
      fs.readFileSync(path.join(test.rollback, "old-task.bin"), "utf8"),
    ).toBe("test-only-old-task");
    for (const key of [
      "cindy_auth_session_v1",
      "cindy_pod_resource_refresh_token",
      "cindy_auth_accounts_v1",
    ]) {
      expect(fs.statSync(test.file(test.rollback, key)).mode & 0o777).toBe(
        0o600,
      );
      expect(
        fs.readFileSync(test.file(test.rollback, key), "utf8"),
      ).not.toContain(latestToken);
    }
  });

  it("cold-starts from imported current RT rather than the stale mounted B", async () => {
    const test = fixture();
    test.forward();
    const exchange = vi.fn().mockRejectedValue(new Error("test-offline"));
    const session = new InstanceSession({
      config: {
        deviceId: identity.deviceId,
        membershipId: identity.membershipId,
        authProtocol: "resource-v1",
      },
      authBaseUrl: identity.authBaseUrl,
      store: test.store,
      readBootstrap: () => bootstrapToken,
      exchange,
    });
    await expect(session.rotate()).rejects.toThrow("test-offline");
    expect(exchange).toHaveBeenCalledExactlyOnceWith(originalToken);
  });

  it("refuses an existing candidate, including one which has already rotated", () => {
    const test = fixture();
    test.forward();
    test.store.write({
      ...(test.store.read() as InstanceRecord),
      refreshToken: latestToken,
    });
    expect(test.forward).toThrow("INSTANCE_MIGRATION_TARGET_NOT_EMPTY");
    expect((test.store.read() as InstanceRecord).refreshToken).toBe(
      latestToken,
    );
    expect(() =>
      test.store.writeNew({ refreshToken: bootstrapToken }),
    ).toThrow();
    expect((test.store.read() as InstanceRecord).refreshToken).toBe(
      latestToken,
    );
  });

  it.each([1, 2])("checks the stopped-writer fence before step %s", (call) => {
    const test = fixture();
    let count = 0;
    test.assertSourceStopped.mockImplementation(() => {
      if (++count === call) throw new Error("TEST_WRITER_ACTIVE");
    });
    expect(test.forward).toThrow("TEST_WRITER_ACTIVE");
    expect(test.store.read()).toBeNull();
  });

  it("checks the candidate writer fence before changing rollback credentials", () => {
    const test = fixture();
    test.forward();
    const before = test.snapshot(test.rollback);
    test.assertSourceStopped.mockImplementation(() => {
      throw new Error("TEST_WRITER_ACTIVE");
    });
    expect(test.backward).toThrow("TEST_WRITER_ACTIVE");
    expect(test.snapshot(test.rollback)).toEqual(before);
  });

  it("repeats a partially written rollback without refreshing or restoring a predecessor", () => {
    const test = fixture();
    test.forward();
    test.store.write({
      ...(test.store.read() as InstanceRecord),
      refreshToken: latestToken,
    });
    const encrypt = test.codec.encryptString;
    let count = 0;
    test.codec.encryptString = (value) => {
      if (++count === 3) throw new Error("TEST_WRITE_INTERRUPTED");
      return encrypt(value);
    };
    expect(test.backward).toThrow("TEST_WRITE_INTERRUPTED");
    test.codec.encryptString = encrypt;
    test.backward();
    expect(test.read(test.rollback, "cindy_pod_resource_refresh_token")).toBe(
      latestToken,
    );
    expect(test.read(test.rollback, "cindy_auth_refresh_token")).toBe(
      latestToken,
    );
    expect(
      JSON.parse(test.read(test.rollback, "cindy_auth_accounts_v1")).resources[
        accountKey
      ].refreshToken,
    ).toBe(latestToken);
  });

  it.each([
    ["cindy_auth_session_v1", "not-json"],
    [
      "cindy_auth_session_v1",
      serializeAuthSessionRecord("global", originalToken),
    ],
    ["cindy_pod_membership_id", "another-membership"],
    ["cindy_pod_resource_refresh_token", latestToken],
    ["cindy_auth_refresh_token", latestToken],
    ["cindy_auth_account_deletion_receipt", "test-only-pending-deletion"],
    [
      "cindy_auth_account_logout_tombstones_v1",
      JSON.stringify({ version: 1, accountKeys: [accountKey] }),
    ],
    [
      "cindy_auth_accounts_v1",
      JSON.stringify({
        version: 1,
        activeAccountKey: null,
        resources: {},
        passports: {},
        signedOutAt: 1,
      }),
    ],
    [
      "cindy_auth_accounts_v1",
      JSON.stringify({
        version: 1,
        activeAccountKey: null,
        resources: {},
        passports: { other: { accountRefreshToken: "test-only-account" } },
      }),
    ],
  ])(
    "rejects ambiguous, signed-out, wrong-realm or account-scoped source: %s",
    (key, value) => {
      const test = fixture();
      test.seed(test.source, key, value);
      expect(test.forward).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
      expect(test.store.read()).toBeNull();
    },
  );

  it.each([
    "symlink",
    "hardlink",
    "corrupt",
    "oversized",
    "public-write",
    "backup",
  ])("rejects unsafe source files: %s", (kind) => {
    const test = fixture();
    const file = test.file(test.source, "cindy_auth_session_v1");
    if (kind === "symlink") {
      fs.renameSync(file, `${file}.target`);
      fs.symlinkSync(`${file}.target`, file);
    }
    if (kind === "hardlink") fs.linkSync(file, `${file}.linked`);
    if (kind === "corrupt") fs.writeFileSync(file, "not-base64!");
    if (kind === "oversized") fs.writeFileSync(file, Buffer.alloc(1_048_577));
    if (kind === "public-write") fs.chmodSync(file, 0o666);
    if (kind === "backup")
      fs.writeFileSync(
        `${test.file(test.source, "cindy_auth_accounts_v1")}.bak`,
        "test-only-backup",
      );
    expect(test.forward).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
    expect(test.store.read()).toBeNull();
  });

  it.each(["basic_text", "unknown"])(
    "does not migrate using the %s encryption backend",
    (backend) => {
      const test = fixture();
      test.codec.getSelectedStorageBackend = () => backend;
      expect(test.forward).toThrow("INSTANCE_KEYRING_UNAVAILABLE");
    },
  );

  it("does not treat an unavailable keyring or missing Pod binding as absence", () => {
    const test = fixture();
    fs.unlinkSync(test.file(test.source, "cindy_pod_membership_id"));
    expect(test.forward).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
    test.codec.decryptString = () => {
      throw new Error("test-only-secret-never-output");
    };
    expect(test.forward).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
  });

  it("refuses same-directory and nested-directory transfers", () => {
    const test = fixture();
    for (const target of [test.source, path.join(test.source, "child")]) {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      expect(() =>
        importLegacyResourceCredential({
          sourceUserDataDir: test.source,
          targetUserDataDir: target,
          identity,
          bootstrapToken,
          codec: test.codec,
          assertSourceStopped: test.assertSourceStopped,
        }),
      ).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
    }
  });

  it("never writes rollback credentials into the preserved original profile", () => {
    const test = fixture();
    test.forward();
    const before = test.snapshot(test.source);
    expect(() =>
      prepareLegacyResourceRollback({
        originalUserDataDir: test.source,
        candidateUserDataDir: test.candidate,
        rollbackUserDataDir: test.source,
        identity,
        codec: test.codec,
        assertSourceStopped: test.assertSourceStopped,
      }),
    ).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
    expect(test.snapshot(test.source)).toEqual(before);
  });

  it("refuses a non-private rollback directory instead of relaxing its permissions", () => {
    const test = fixture();
    test.forward();
    const before = test.snapshot(test.rollback);
    fs.chmodSync(path.join(test.rollback, "safe-storage"), 0o755);
    expect(test.backward).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
    expect(test.snapshot(test.rollback)).toEqual(before);
  });

  it.each([
    { deviceId: "cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa" },
    { membershipId: "other-membership" },
    { authBaseUrl: "https://other.invalid" },
    { version: 1 },
    { refreshToken: "test-only-account-token" },
    { generation: 1 },
  ])(
    "refuses a mismatched canonical record before modifying rollback data: %j",
    (change) => {
      const test = fixture();
      test.forward();
      const before = test.snapshot(test.rollback);
      test.store.write({ ...(test.store.read() as InstanceRecord), ...change });
      expect(test.backward).toThrow("INSTANCE_MIGRATION_SOURCE_REJECTED");
      expect(test.snapshot(test.rollback)).toEqual(before);
    },
  );
});
