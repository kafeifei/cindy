import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  parseAuthSessionRecord,
  serializeAuthSessionRecord,
  type AuthRegion,
} from "@cindy/auth-client";
import {
  assertSecretService,
  atomicPrivateWrite,
  createInstanceStore,
  isResourceRefreshToken,
  type SecretCodec,
} from "./store.js";
import type { InstanceRecord } from "./session.js";

const keys = {
  session: "cindy_auth_session_v1",
  pod: "cindy_pod_resource_refresh_token",
  membership: "cindy_pod_membership_id",
  mirror: "cindy_auth_refresh_token",
  vault: "cindy_auth_accounts_v1",
  logout: "cindy_auth_account_logout_tombstones_v1",
  deletion: "cindy_auth_account_deletion_receipt",
} as const;

export interface CredentialMigrationIdentity {
  deviceId: string;
  membershipId: string;
  authBaseUrl: string;
  realm: AuthRegion;
}

type Vault = Record<string, unknown> & {
  resources: Record<string, Record<string, unknown>>;
};

function reject(): never {
  throw new Error("INSTANCE_MIGRATION_SOURCE_REJECTED");
}

function assertIdentity(identity: CredentialMigrationIdentity): void {
  const url = new URL(identity.authBaseUrl);
  if (
    !/^cloud-device-[a-f0-9]{24}$/.test(identity.deviceId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(identity.membershipId) ||
    !["cn", "global"].includes(identity.realm) ||
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
    reject();
}

function privateDirectory(directory: string, writable: boolean): string {
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & (writable ? 0o077 : 0o022)) !== 0
  )
    reject();
  return fs.realpathSync(directory);
}

function separateDirectories(source: string, target: string): void {
  const sourceRoot = privateDirectory(source, false);
  const targetRoot = privateDirectory(target, true);
  const sourceStat = fs.statSync(sourceRoot);
  const targetStat = fs.statSync(targetRoot);
  if (
    (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) ||
    sourceRoot === targetRoot ||
    sourceRoot.startsWith(`${targetRoot}${path.sep}`) ||
    targetRoot.startsWith(`${sourceRoot}${path.sep}`)
  )
    reject();
}

function legacyStore(userDataDir: string, codec: SecretCodec) {
  assertSecretService(codec);
  privateDirectory(userDataDir, false);
  const directory = path.join(userDataDir, "safe-storage");
  privateDirectory(directory, false);
  const read = (key: string): string | null => {
    const file = path.join(directory, `${key}.enc`);
    let descriptor: number;
    try {
      descriptor = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return reject();
    }
    try {
      const stat = fs.fstatSync(descriptor);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.size > 1_048_576 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o022) !== 0
      )
        reject();
      const encoded = fs.readFileSync(descriptor, "utf8");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length === 0 || bytes.toString("base64") !== encoded) reject();
      return codec.decryptString(bytes);
    } catch {
      return reject();
    } finally {
      fs.closeSync(descriptor);
    }
  };
  return { read, directory };
}

function legacyState(
  userDataDir: string,
  codec: SecretCodec,
  identity: CredentialMigrationIdentity,
  requireConsistent: boolean,
) {
  const store = legacyStore(userDataDir, codec);
  const session = parseAuthSessionRecord(store.read(keys.session));
  const pod = store.read(keys.pod);
  const mirror = store.read(keys.mirror);
  if (
    !session ||
    session.realm !== identity.realm ||
    !isResourceRefreshToken(session.refreshToken) ||
    !pod ||
    !isResourceRefreshToken(pod) ||
    (mirror !== null && !isResourceRefreshToken(mirror)) ||
    store.read(keys.membership) !== identity.membershipId ||
    store.read(keys.deletion) !== null ||
    (requireConsistent &&
      (pod !== session.refreshToken ||
        (mirror !== null && mirror !== session.refreshToken)))
  )
    reject();
  const accountKey = JSON.stringify([identity.realm, identity.membershipId]);
  let vault: Vault | null = null;
  try {
    const logoutRaw = store.read(keys.logout);
    if (logoutRaw !== null) {
      const logout = JSON.parse(logoutRaw);
      if (
        logout?.version !== 1 ||
        !Array.isArray(logout.accountKeys) ||
        logout.accountKeys.length !== 0
      )
        reject();
    }
    const raw = store.read(keys.vault);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        ![1, 2].includes(parsed.version) ||
        parsed.signedOutAt !== undefined ||
        !parsed.resources ||
        typeof parsed.resources !== "object" ||
        Array.isArray(parsed.resources) ||
        !parsed.passports ||
        typeof parsed.passports !== "object" ||
        Array.isArray(parsed.passports) ||
        Object.keys(parsed.passports).length !== 0 ||
        (parsed.loggedOutAccountKeys !== undefined &&
          (!Array.isArray(parsed.loggedOutAccountKeys) ||
            parsed.loggedOutAccountKeys.length !== 0)) ||
        (parsed.activeAccountKey !== null &&
          parsed.activeAccountKey !== accountKey) ||
        Object.keys(parsed.resources).some((key) => key !== accountKey)
      )
        reject();
      const resource = parsed.resources[accountKey];
      if (
        (parsed.activeAccountKey !== null && !resource) ||
        (resource &&
          (resource.realm !== identity.realm ||
            resource.metadata?.membershipId !== identity.membershipId ||
            !isResourceRefreshToken(resource.refreshToken) ||
            (requireConsistent &&
              resource.refreshToken !== session.refreshToken)))
      )
        reject();
      vault = parsed;
    }
    for (const key of [keys.vault, keys.logout]) {
      const backup = path.join(store.directory, `${key}.enc.bak`);
      try {
        fs.lstatSync(backup);
        reject();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  } catch {
    return reject();
  }
  return { store, session, vault, accountKey };
}

export function importLegacyResourceCredential(input: {
  sourceUserDataDir: string;
  targetUserDataDir: string;
  identity: CredentialMigrationIdentity;
  bootstrapToken: string;
  codec: SecretCodec;
  assertSourceStopped(): void;
}): void {
  assertIdentity(input.identity);
  if (!isResourceRefreshToken(input.bootstrapToken)) reject();
  input.assertSourceStopped();
  separateDirectories(input.sourceUserDataDir, input.targetUserDataDir);
  if (fs.readdirSync(input.targetUserDataDir).length !== 0)
    throw new Error("INSTANCE_MIGRATION_TARGET_NOT_EMPTY");
  const source = legacyState(
    input.sourceUserDataDir,
    input.codec,
    input.identity,
    true,
  );
  const store = createInstanceStore(input.targetUserDataDir, input.codec);
  store.preflight();
  input.assertSourceStopped();
  const record: InstanceRecord = {
    version: 2,
    protocol: "resource-v1",
    deviceId: input.identity.deviceId,
    membershipId: input.identity.membershipId,
    authBaseUrl: input.identity.authBaseUrl,
    bootstrapDigest: createHash("sha256")
      .update(input.bootstrapToken)
      .digest("hex"),
    refreshToken: source.session.refreshToken,
  };
  store.writeNew(record);
}

export function importFrozenLegacyResourceCredential(
  input: Omit<
    Parameters<typeof importLegacyResourceCredential>[0],
    "bootstrapToken"
  >,
): void {
  assertIdentity(input.identity);
  input.assertSourceStopped();
  const source = legacyState(
    input.sourceUserDataDir,
    input.codec,
    input.identity,
    true,
  );
  importLegacyResourceCredential({
    ...input,
    bootstrapToken: source.session.refreshToken,
  });
}

function readBoundResourceRecord(
  userDataDir: string,
  identity: CredentialMigrationIdentity,
  codec: SecretCodec,
): InstanceRecord {
  assertIdentity(identity);
  const store = createInstanceStore(userDataDir, codec);
  const record = store.read() as InstanceRecord | null;
  if (
    !record ||
    record.version !== 2 ||
    record.protocol !== "resource-v1" ||
    "instanceId" in record ||
    "generation" in record ||
    record.deviceId !== identity.deviceId ||
    record.membershipId !== identity.membershipId ||
    record.authBaseUrl !== identity.authBaseUrl ||
    !/^[a-f0-9]{64}$/.test(record.bootstrapDigest) ||
    !isResourceRefreshToken(record.refreshToken)
  )
    reject();
  return record;
}

export function verifyResourceCredentialHandoff(input: {
  action: "prepare-profile" | "prepare-recovery";
  sourceUserDataDir: string;
  candidateUserDataDir: string;
  targetUserDataDir: string;
  identity: CredentialMigrationIdentity;
  codec: SecretCodec;
}): void {
  const forward = input.action === "prepare-profile";
  separateDirectories(input.sourceUserDataDir, input.targetUserDataDir);
  const record = readBoundResourceRecord(
    forward ? input.targetUserDataDir : input.candidateUserDataDir,
    input.identity,
    input.codec,
  );
  const legacy = legacyState(
    forward ? input.sourceUserDataDir : input.targetUserDataDir,
    input.codec,
    input.identity,
    true,
  );
  if (record.refreshToken !== legacy.session.refreshToken) reject();
  if (
    forward &&
    record.bootstrapDigest !==
      createHash("sha256").update(legacy.session.refreshToken).digest("hex")
  )
    reject();
}

export function seedLegacyResourceRecoveryProfile(input: {
  candidateUserDataDir: string;
  recoveryUserDataDir: string;
  identity: CredentialMigrationIdentity;
  codec: SecretCodec;
  assertSourceStopped(): void;
}): void {
  input.assertSourceStopped();
  separateDirectories(input.candidateUserDataDir, input.recoveryUserDataDir);
  if (fs.readdirSync(input.recoveryUserDataDir).length !== 0)
    throw new Error("INSTANCE_MIGRATION_TARGET_NOT_EMPTY");
  const record = readBoundResourceRecord(
    input.candidateUserDataDir,
    input.identity,
    input.codec,
  );
  input.assertSourceStopped();
  const values: Array<[string, string]> = [
    [
      keys.session,
      serializeAuthSessionRecord(input.identity.realm, record.refreshToken),
    ],
    [keys.pod, record.refreshToken],
    [keys.mirror, record.refreshToken],
    [keys.membership, input.identity.membershipId],
  ];
  for (const [key, value] of values) {
    atomicPrivateWrite(
      path.join(input.recoveryUserDataDir, "safe-storage", `${key}.enc`),
      Buffer.from(input.codec.encryptString(value).toString("base64")),
      false,
    );
  }
  const verified = legacyState(
    input.recoveryUserDataDir,
    input.codec,
    input.identity,
    true,
  );
  if (verified.session.refreshToken !== record.refreshToken) reject();
}

export function prepareLegacyResourceRollback(input: {
  originalUserDataDir: string;
  candidateUserDataDir: string;
  rollbackUserDataDir: string;
  identity: CredentialMigrationIdentity;
  codec: SecretCodec;
  assertSourceStopped(): void;
}): void {
  assertIdentity(input.identity);
  input.assertSourceStopped();
  separateDirectories(input.candidateUserDataDir, input.rollbackUserDataDir);
  separateDirectories(input.originalUserDataDir, input.rollbackUserDataDir);
  const record = readBoundResourceRecord(
    input.candidateUserDataDir,
    input.identity,
    input.codec,
  );
  const target = legacyState(
    input.rollbackUserDataDir,
    input.codec,
    input.identity,
    false,
  );
  privateDirectory(target.store.directory, true);
  const values: Array<[string, string]> = [
    [
      keys.session,
      serializeAuthSessionRecord(input.identity.realm, record.refreshToken),
    ],
    [keys.pod, record.refreshToken],
    [keys.mirror, record.refreshToken],
    [keys.membership, input.identity.membershipId],
  ];
  if (target.vault) {
    const resource = target.vault.resources[target.accountKey];
    if (resource) resource.refreshToken = record.refreshToken;
    values.push([keys.vault, JSON.stringify(target.vault)]);
  }
  input.assertSourceStopped();
  for (const [key, value] of values) {
    const ciphertext = input.codec.encryptString(value);
    atomicPrivateWrite(
      path.join(target.store.directory, `${key}.enc`),
      Buffer.from(ciphertext.toString("base64")),
    );
  }
  const verified = legacyState(
    input.rollbackUserDataDir,
    input.codec,
    input.identity,
    true,
  );
  if (verified.session.refreshToken !== record.refreshToken) reject();
}
