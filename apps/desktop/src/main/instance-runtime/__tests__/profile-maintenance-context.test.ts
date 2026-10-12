import { describe, expect, it } from "vitest";
import {
  assertProfileMounts,
  metadataHash,
  parseProfileMaintenanceContext,
  profileLayout,
  profileLayoutDigest,
} from "../profile-maintenance-context.js";

function fixture() {
  const identity = {
    deviceId: "cloud-device-0123456789abcdef01234567",
    membershipId: "test-membership",
    authBaseUrl: "https://auth.invalid",
    realm: "cn",
  };
  const request = {
    version: 3,
    operationId: "test-operation",
    requestId: "test-request",
    action: "prepare-profile",
    writerId: "test-writer",
    epoch: 1,
    instanceId: "cloud-instance-0123456789abcdef",
    identity,
    statefulSetUid: "test-sts",
    pvcUid: "test-pvc",
    helperPodUid: "test-helper",
    profile: "test-profile",
    authProtocol: "resource-v1",
    accountControl: false,
    executionBindingSha256: "",
  };
  const image = `registry.invalid/test@sha256:${"a".repeat(64)}`;
  const binding = {
    version: 3,
    layoutVersion: 3,
    layout: profileLayout(request.profile),
    cisRequest: {
      version: 3,
      operationId: request.operationId,
      requestId: request.requestId,
      action: request.action,
      writerId: request.writerId,
      epoch: request.epoch,
      instanceId: request.instanceId,
      deviceId: identity.deviceId,
      membershipId: identity.membershipId,
      statefulSetUid: request.statefulSetUid,
      pvcUid: request.pvcUid,
      podUid: "test-source-pod",
      profile: request.profile,
      image,
      sourceImage: image,
      recoveryImage: image,
      maintenanceImage: image,
      realm: identity.realm,
      authBaseUrl: identity.authBaseUrl,
      credentialSnapshot: "latest-durable",
      layoutSha256: profileLayoutDigest(profileLayout(request.profile)),
      keyUid: "test-key",
      bindingUid: "test-key-binding",
      stopped: {
        role: "source",
        statefulSetUid: request.statefulSetUid,
        pvcUid: request.pvcUid,
        podUid: "test-source-pod",
        statefulSetResourceVersion: "stopped-rv",
        generation: 2,
        observedGeneration: 2,
        podsAbsent: true,
      },
      endpointManifestSha256: "b".repeat(64),
      securityContextSha256: "c".repeat(64),
      recoverySecurityContextSha256: "d".repeat(64),
      predecessorReceiptId: null,
      authProtocol: request.authProtocol,
      accountControl: false,
    },
    identity: { ...identity },
    fence: {
      statefulSetUid: request.statefulSetUid,
      resourceVersion: "opaque-rv",
      pvcUid: request.pvcUid,
      pvcResourceVersion: "opaque-pvc-rv",
      helperPodUid: request.helperPodUid,
    },
    key: { keyUid: "test-key", bindingUid: "test-key-binding" },
    helperImage: image,
    helperTemplateSha256: "e".repeat(64),
  };
  const encode = () => {
    const bindingBytes = Buffer.from(JSON.stringify(binding));
    request.executionBindingSha256 = metadataHash(bindingBytes);
    return {
      bindingBytes,
      requestBytes: Buffer.from(JSON.stringify(request)),
      helperPodUid: request.helperPodUid,
    };
  };
  return { request, binding, encode };
}

function mounts(reverse = false): string {
  const entries: Array<[string, string, string]> = [
    ["/config", "/run/cindy-profile/input", "ro"],
    ["/identity", "/run/cindy-profile/identity", "ro"],
    ["/result", "/run/cindy-profile/result", "rw"],
    ["/private", "/var/lib/cindy/maintenance", "rw"],
    ["/home", "/migration/source/home", "ro"],
    ["/user-data", "/migration/source/user-data", "ro"],
    ["/workspaces", "/migration/source/workspaces", "ro"],
  ];
  if (reverse)
    entries.push(
      ["/profiles/test/target/user-data", "/migration/target/user-data", "rw"],
      ["/profiles/test/handoff", "/migration/transaction", "rw"],
      [
        "/profiles/test/candidate/user-data",
        "/migration/candidate/user-data",
        "ro",
      ],
      [
        "/profiles/test/keyrings",
        "/migration/keyring-source-home/.local/share/keyrings",
        "ro",
      ],
    );
  else entries.push(["/profiles/test-profile", "/migration/profile", "rw"]);
  return entries
    .map(
      ([root, destination, options], index) =>
        `${100 + index} 50 8:2 ${root} ${destination} ${options},nosuid,nodev - ext4 /dev/test rw`,
    )
    .join("\n");
}

describe("private CIS maintenance request binding", () => {
  it.each([
    "old-request",
    "old-binding",
    "old-layout",
    "extra-seed",
    "recovery-alias",
    "different-keyrings",
    "different-layout-digest",
  ])("rejects changed recovery scope: %s", (change) => {
    const test = fixture();
    if (change === "old-request") test.request.version = 2;
    if (change === "old-binding") test.binding.version = 2;
    if (change === "old-layout") test.binding.layout.version = 2;
    if (change === "extra-seed")
      test.binding.layout.recoverySeedKeys.push("plugin-token");
    if (change === "recovery-alias")
      test.binding.layout.recovery = test.binding.layout.snapshot;
    if (change === "different-keyrings")
      test.binding.layout.keyrings = "profiles/other/keyrings";
    test.binding.cisRequest.layoutSha256 =
      change === "different-layout-digest"
        ? "f".repeat(64)
        : profileLayoutDigest(test.binding.layout);
    expect(() => parseProfileMaintenanceContext(test.encode())).toThrow(
      "INSTANCE_MIGRATION_BINDING_REJECTED",
    );
  });

  it("binds exact bytes, helper UID and the persistent CIS request without receiving a token", () => {
    const test = fixture();
    const input = test.encode();
    const context = parseProfileMaintenanceContext(input);
    expect(context.requestSha256).toBe(metadataHash(input.requestBytes));
    expect(context.binding.fence.resourceVersion).toBe("opaque-rv");
    expect(() =>
      parseProfileMaintenanceContext({
        ...input,
        bindingBytes: Buffer.concat([input.bindingBytes, Buffer.from("\n")]),
      }),
    ).toThrow("INSTANCE_MIGRATION_BINDING_REJECTED");
    expect(() =>
      parseProfileMaintenanceContext({
        ...input,
        helperPodUid: "same-name-new-pod",
      }),
    ).toThrow("INSTANCE_MIGRATION_BINDING_REJECTED");
  });

  it.each([
    "operationId",
    "requestId",
    "writerId",
    "statefulSetUid",
    "pvcUid",
    "profile",
  ] as const)("rejects divergent %s even with a recomputed digest", (field) => {
    const test = fixture();
    test.binding.cisRequest[field] = "different";
    expect(() => parseProfileMaintenanceContext(test.encode())).toThrow(
      "INSTANCE_MIGRATION_BINDING_REJECTED",
    );
  });

  it.each(["deviceId", "membershipId", "authBaseUrl", "realm"] as const)(
    "rejects divergent identity field %s",
    (field) => {
      const test = fixture();
      test.binding.identity[field] = "different";
      expect(() => parseProfileMaintenanceContext(test.encode())).toThrow(
        "INSTANCE_MIGRATION_BINDING_REJECTED",
      );
    },
  );

  it.each([
    "token",
    "refreshToken",
    "password",
    "command",
    "sourceUserDataDir",
  ])("rejects unrecognized input %s without echoing it", (field) => {
    const test = fixture();
    const input = test.encode();
    input.requestBytes = Buffer.from(
      JSON.stringify({ ...test.request, [field]: "test-only-sensitive" }),
    );
    expect(() => parseProfileMaintenanceContext(input)).toThrow(
      /^INSTANCE_MIGRATION_BINDING_REJECTED$/,
    );
  });

  it("rejects credential-bearing URLs, old protocol, stale layout and an unfrozen helper image", () => {
    for (const change of [
      (test: ReturnType<typeof fixture>) => {
        test.binding.layoutVersion = 1;
      },
      (test: ReturnType<typeof fixture>) => {
        test.request.authProtocol = "account-v1";
      },
      (test: ReturnType<typeof fixture>) => {
        test.binding.helperImage = "registry.invalid/test:latest";
      },
      (test: ReturnType<typeof fixture>) => {
        test.request.identity.authBaseUrl = "https://test:secret@auth.invalid";
        test.binding.identity.authBaseUrl = test.request.identity.authBaseUrl;
      },
    ]) {
      const test = fixture();
      change(test);
      expect(() => parseProfileMaintenanceContext(test.encode())).toThrow(
        "INSTANCE_MIGRATION_BINDING_REJECTED",
      );
    }
  });
});

describe("maintenance container mount boundary", () => {
  it("accepts distinct forward and reverse mounts", () => {
    expect(() =>
      assertProfileMounts(mounts(), "prepare-profile"),
    ).not.toThrow();
    expect(() =>
      assertProfileMounts(mounts(true), "prepare-recovery"),
    ).not.toThrow();
  });
  it("rejects writable originals, hidden aliases, whole-PVC mounts and child overmounts", () => {
    for (const value of [
      mounts().replace(
        "/migration/source/user-data ro,",
        "/migration/source/user-data rw,",
      ),
      `${mounts()}\n200 50 8:2 /user-data /hidden rw - ext4 /dev/test rw`,
      `${mounts()}\n200 50 8:2 / /all-pvc rw - ext4 /dev/test rw`,
      `${mounts()}\n200 50 8:3 / /migration/source/user-data/safe-storage rw - ext4 /dev/test rw`,
      mounts().replace("/run/cindy-profile", "/wrong-metadata"),
    ])
      expect(() => assertProfileMounts(value, "prepare-profile")).toThrow(
        "INSTANCE_MIGRATION_MOUNTS_REJECTED",
      );
  });
  it("rejects a writable alias of reverse key material", () => {
    expect(() =>
      assertProfileMounts(
        `${mounts(true)}\n200 50 8:2 /profiles/test/keyrings /home/cindy/.local/share/keyrings rw - ext4 /dev/test rw`,
        "prepare-recovery",
      ),
    ).toThrow("INSTANCE_MIGRATION_MOUNTS_REJECTED");
  });
});
