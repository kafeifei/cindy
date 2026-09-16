import fs from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z
  .string()
  .max(512)
  .regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/);
const action = z.enum(["prepare-profile", "prepare-recovery"]);
const profile = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const identity = z
  .object({
    deviceId: z.string().regex(/^cloud-device-[a-f0-9]{24}$/),
    membershipId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    authBaseUrl: z.string().max(512).url(),
    realm: z.enum(["cn", "global"]),
  })
  .strict();
export function profileLayout(profileName: string) {
  const root = `profiles/${profile.parse(profileName)}`;
  const directories = (prefix: string) => ({
    home: `${prefix}/home`,
    userData: `${prefix}/user-data`,
    workspaces: `${prefix}/workspaces`,
  });
  return {
    version: 3,
    profile: profileName,
    recoveryScope: "image-and-cindy-resource",
    snapshotUsage: "preservation-only",
    recoverySeedKeys: [
      "cindy_auth_session_v1",
      "cindy_pod_resource_refresh_token",
      "cindy_pod_membership_id",
      "cindy_auth_refresh_token",
    ],
    source: { home: "home", userData: "user-data", workspaces: "workspaces" },
    snapshot: directories(`${root}/snapshot`),
    candidate: directories(`${root}/candidate`),
    recovery: directories(`${root}/recovery`),
    root,
    keyrings: `${root}/keyrings`,
    handoff: `${root}/handoff`,
  };
}

export function profileLayoutDigest(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

const relativePath = z
  .string()
  .regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/)
  .max(256);
const layoutDirectories = z
  .object({
    home: relativePath,
    userData: relativePath,
    workspaces: relativePath,
  })
  .strict();
const layoutSchema = z
  .object({
    version: z.literal(3),
    profile,
    recoveryScope: z.literal("image-and-cindy-resource"),
    snapshotUsage: z.literal("preservation-only"),
    recoverySeedKeys: z.tuple([
      z.literal("cindy_auth_session_v1"),
      z.literal("cindy_pod_resource_refresh_token"),
      z.literal("cindy_pod_membership_id"),
      z.literal("cindy_auth_refresh_token"),
    ]),
    source: layoutDirectories,
    snapshot: layoutDirectories,
    candidate: layoutDirectories,
    recovery: layoutDirectories,
    root: relativePath,
    keyrings: relativePath,
    handoff: relativePath,
  })
  .strict();
const requestSchema = z
  .object({
    version: z.literal(3),
    operationId: id,
    requestId: id,
    action,
    writerId: id,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    instanceId: z.string().regex(/^cloud-instance-[a-f0-9]{16}$/),
    identity,
    statefulSetUid: id,
    pvcUid: id,
    helperPodUid: id,
    profile,
    authProtocol: z.literal("resource-v1"),
    accountControl: z.literal(false),
    executionBindingSha256: digest,
  })
  .strict();
const cisRequestSchema = z
  .object({
    version: z.literal(3),
    operationId: id,
    requestId: id,
    action,
    writerId: id,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    instanceId: id,
    deviceId: id,
    membershipId: id,
    statefulSetUid: id,
    pvcUid: id,
    podUid: id.nullable(),
    profile,
    image,
    sourceImage: image,
    recoveryImage: image,
    maintenanceImage: image,
    realm: z.enum(["cn", "global"]),
    authBaseUrl: z.string().max(512).url(),
    credentialSnapshot: z.literal("latest-durable"),
    layoutSha256: digest,
    stopped: z
      .object({
        role: z.enum(["source", "candidate"]),
        statefulSetUid: id,
        pvcUid: id,
        podUid: id.nullable(),
        statefulSetResourceVersion: z.string().min(1).max(128),
        generation: z.number().int().positive(),
        observedGeneration: z.number().int().positive(),
        podsAbsent: z.literal(true),
      })
      .strict(),
    keyUid: id,
    bindingUid: id,
    endpointManifestSha256: digest,
    securityContextSha256: digest,
    recoverySecurityContextSha256: digest,
    predecessorReceiptId: id.nullable(),
    authProtocol: z.literal("resource-v1"),
    accountControl: z.literal(false),
  })
  .strict();
const bindingSchema = z
  .object({
    version: z.literal(3),
    layoutVersion: z.literal(3),
    layout: layoutSchema,
    cisRequest: cisRequestSchema,
    identity,
    fence: z
      .object({
        statefulSetUid: id,
        resourceVersion: z.string().min(1).max(128),
        pvcUid: id,
        pvcResourceVersion: z.string().min(1).max(128),
        helperPodUid: id,
      })
      .strict(),
    key: z.object({ keyUid: id, bindingUid: id }).strict(),
    helperImage: image,
    helperTemplateSha256: digest,
  })
  .strict();

export const profileMounts = {
  request: "/run/cindy-profile/input/request.json",
  binding: "/run/cindy-profile/input/binding.json",
  podUid: "/run/cindy-profile/identity/pod-uid",
  profile: "/migration/profile",
  source: "/migration/source/user-data",
  candidate: "/migration/candidate/user-data",
  target: "/migration/target/user-data",
  recovery: "/migration/profile/recovery/user-data",
  transaction: "/migration/transaction",
  keyringSource: "/migration/keyring-source-home/.local/share/keyrings",
  home: "/var/lib/cindy/maintenance/home",
  keyrings: "/var/lib/cindy/maintenance/home/.local/share/keyrings",
  receipt: "/run/cindy-profile/result/receipt.json",
} as const;

export const metadataHash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function parseProfileMaintenanceContext(input: {
  requestBytes: Buffer;
  bindingBytes: Buffer;
  helperPodUid: string | undefined;
}) {
  try {
    if (
      input.requestBytes.length > 16_384 ||
      input.bindingBytes.length > 32_768
    )
      throw new Error();
    const request = requestSchema.parse(
      JSON.parse(input.requestBytes.toString("utf8")),
    );
    const binding = bindingSchema.parse(
      JSON.parse(input.bindingBytes.toString("utf8")),
    );
    if (
      request.executionBindingSha256 !== metadataHash(input.bindingBytes) ||
      request.helperPodUid !== input.helperPodUid ||
      request.helperPodUid !== binding.fence.helperPodUid ||
      request.statefulSetUid !== binding.fence.statefulSetUid ||
      request.pvcUid !== binding.fence.pvcUid
    )
      throw new Error();
    for (const field of [
      "operationId",
      "requestId",
      "action",
      "writerId",
      "epoch",
      "instanceId",
      "statefulSetUid",
      "pvcUid",
      "profile",
      "authProtocol",
      "accountControl",
    ] as const) {
      if (request[field] !== binding.cisRequest[field]) throw new Error();
    }
    for (const field of [
      "deviceId",
      "membershipId",
      "authBaseUrl",
      "realm",
    ] as const) {
      if (request.identity[field] !== binding.identity[field])
        throw new Error();
    }
    if (
      request.identity.deviceId !== binding.cisRequest.deviceId ||
      request.identity.membershipId !== binding.cisRequest.membershipId ||
      request.identity.realm !== binding.cisRequest.realm ||
      request.identity.authBaseUrl !== binding.cisRequest.authBaseUrl ||
      binding.key.keyUid !== binding.cisRequest.keyUid ||
      binding.key.bindingUid !== binding.cisRequest.bindingUid ||
      binding.helperImage !== binding.cisRequest.maintenanceImage ||
      profileLayoutDigest(binding.layout) !== binding.cisRequest.layoutSha256 ||
      profileLayoutDigest(binding.layout) !==
        profileLayoutDigest(profileLayout(request.profile)) ||
      binding.cisRequest.stopped.statefulSetUid !== request.statefulSetUid ||
      binding.cisRequest.stopped.pvcUid !== request.pvcUid ||
      binding.cisRequest.stopped.podUid !== binding.cisRequest.podUid ||
      binding.cisRequest.stopped.observedGeneration <
        binding.cisRequest.stopped.generation ||
      binding.cisRequest.stopped.role !==
        (request.action === "prepare-profile" ? "source" : "candidate")
    )
      throw new Error();
    const url = new URL(request.identity.authBaseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
        ))
    )
      throw new Error();
    return {
      request,
      binding,
      requestSha256: metadataHash(input.requestBytes),
    };
  } catch {
    throw new Error("INSTANCE_MIGRATION_BINDING_REJECTED");
  }
}

function readMetadata(file: string): Buffer {
  const resolved = fs.realpathSync(file);
  if (!resolved.startsWith("/run/cindy-profile/"))
    throw new Error("INSTANCE_MIGRATION_BINDING_REJECTED");
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size > 32_768 ||
      stat.uid !== 0 ||
      (stat.mode & 0o022) !== 0
    )
      throw new Error("INSTANCE_MIGRATION_BINDING_REJECTED");
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function assertProfileMounts(
  mountinfo: string,
  operation: z.infer<typeof action>,
  expectedProfile?: string,
): void {
  const entries = mountinfo
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.split(" ");
      return {
        device: fields[2],
        root: fields[3],
        destination: fields[4],
        options: fields[5]?.split(",") ?? [],
      };
    });
  const required: Array<[string, boolean]> = [
    ["/run/cindy-profile/input", true],
    ["/run/cindy-profile/identity", true],
    ["/run/cindy-profile/result", false],
    ["/var/lib/cindy/maintenance", false],
    ["/migration/source/home", true],
    [profileMounts.source, true],
    ["/migration/source/workspaces", true],
  ];
  if (operation === "prepare-recovery") {
    required.push(
      [profileMounts.candidate, true],
      [profileMounts.target, false],
      [profileMounts.transaction, false],
      [profileMounts.keyringSource, true],
    );
  } else required.push([profileMounts.profile, false]);
  for (const [destination, readonly] of required) {
    const matches = entries.filter(
      (entry) => entry.destination === destination,
    );
    const entry = matches[0];
    if (
      matches.length !== 1 ||
      !entry.options.includes(readonly ? "ro" : "rw") ||
      entries.some((other) => other.destination.startsWith(`${destination}/`))
    )
      throw new Error("INSTANCE_MIGRATION_MOUNTS_REJECTED");
    if (
      destination === profileMounts.profile &&
      expectedProfile &&
      !entry.root.endsWith(`/profiles/${expectedProfile}`)
    )
      throw new Error("INSTANCE_MIGRATION_MOUNTS_REJECTED");
    if (readonly && destination.startsWith("/migration/")) {
      const overlaps = (left: string, right: string) =>
        left === right ||
        left === "/" ||
        right === "/" ||
        left.startsWith(`${right}/`) ||
        right.startsWith(`${left}/`);
      if (
        entries.some(
          (other) =>
            other !== entry &&
            other.device === entry.device &&
            other.options.includes("rw") &&
            overlaps(other.root, entry.root),
        )
      )
        throw new Error("INSTANCE_MIGRATION_MOUNTS_REJECTED");
    }
  }
}

export function readProfileMaintenanceContext() {
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== 10001 ||
    process.env.HOME !== profileMounts.home ||
    process.env.CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE !== undefined ||
    process.env.CINDY_POD_KEYRING_PASSWORD_FILE !==
      "/run/secrets/credential-store-key"
  )
    throw new Error("INSTANCE_MIGRATION_BINDING_REJECTED");
  const context = parseProfileMaintenanceContext({
    requestBytes: readMetadata(profileMounts.request),
    bindingBytes: readMetadata(profileMounts.binding),
    helperPodUid: readMetadata(profileMounts.podUid).toString("utf8").trim(),
  });
  assertProfileMounts(
    fs.readFileSync("/proc/self/mountinfo", "utf8"),
    context.request.action,
    context.request.profile,
  );
  const forward = context.request.action === "prepare-profile";
  const transaction = `${forward ? "/migration/profile/handoff" : profileMounts.transaction}/${context.request.operationId}/${context.request.requestId}`;
  return {
    ...context,
    paths: {
      source: profileMounts.source,
      candidate: profileMounts.candidate,
      target: forward
        ? "/migration/profile/candidate/user-data"
        : profileMounts.target,
      recovery: profileMounts.recovery,
      persistentKeyrings: forward
        ? "/migration/profile/keyrings"
        : profileMounts.keyringSource,
      transaction,
      receipt: `${transaction}/receipt.json`,
    },
  };
}
