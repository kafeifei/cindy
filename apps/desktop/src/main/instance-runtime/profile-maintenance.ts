import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  importFrozenLegacyResourceCredential,
  prepareLegacyResourceRollback,
  seedLegacyResourceRecoveryProfile,
  verifyResourceCredentialHandoff,
} from "./credential-migration.js";
import { readProfileMaintenanceContext } from "./profile-maintenance-context.js";

export function initializeProfileMaintenance(): boolean {
  if (!process.argv.includes("--cloud-credential-maintenance")) return false;
  try {
    if (
      process.argv.includes("--cloud-instance") ||
      process.argv.includes("--no-sandbox") ||
      process.env.ELECTRON_DISABLE_SANDBOX ||
      process.env.XDT_ISOLATED ||
      !["prepare", "verify"].includes(process.env.CINDY_PROFILE_STAGE ?? "")
    )
      throw new Error();
    readProfileMaintenanceContext();
    const runtimeDir = process.env.XDG_RUNTIME_DIR;
    if (!runtimeDir || !/^\/tmp\/cindy-runtime-[a-zA-Z0-9]+$/.test(runtimeDir))
      throw new Error();
    const directory = fs.mkdtempSync(path.join(runtimeDir, "profile-"));
    app.setPath("userData", directory);
    process.env.XDT_USER_DATA_DIR = directory;
    app.commandLine.appendSwitch("password-store", "gnome-libsecret");
    return true;
  } catch {
    throw new Error("INSTANCE_MIGRATION_BINDING_REJECTED");
  }
}

export async function runProfileMaintenance(): Promise<void> {
  try {
    const context = readProfileMaintenanceContext();
    const paths = context.paths;
    const assertSourceStopped = () => {
      const current = readProfileMaintenanceContext();
      if (current.requestSha256 !== context.requestSha256)
        throw new Error("INSTANCE_MIGRATION_FENCE_REJECTED");
    };
    await app.whenReady();
    assertSourceStopped();
    const input = {
      identity: context.request.identity,
      codec: safeStorage,
      assertSourceStopped,
    };
    if (process.env.CINDY_PROFILE_STAGE === "verify") {
      verifyResourceCredentialHandoff({
        ...input,
        action: context.request.action,
        sourceUserDataDir: paths.source,
        candidateUserDataDir: paths.candidate,
        targetUserDataDir: paths.target,
      });
      if (context.request.action === "prepare-profile") {
        verifyResourceCredentialHandoff({
          ...input,
          action: "prepare-recovery",
          sourceUserDataDir: paths.source,
          candidateUserDataDir: paths.target,
          targetUserDataDir: paths.recovery,
        });
      }
    } else if (process.env.CINDY_PROFILE_STAGE === "prepare") {
      if (context.request.action === "prepare-profile") {
        for (const directory of [
          "/migration/profile/recovery/home",
          "/migration/profile/recovery/workspaces",
        ])
          if (fs.readdirSync(directory).length !== 0) throw new Error();
        importFrozenLegacyResourceCredential({
          ...input,
          sourceUserDataDir: paths.source,
          targetUserDataDir: paths.target,
        });
        seedLegacyResourceRecoveryProfile({
          ...input,
          candidateUserDataDir: paths.target,
          recoveryUserDataDir: paths.recovery,
        });
      } else {
        prepareLegacyResourceRollback({
          ...input,
          originalUserDataDir: paths.source,
          candidateUserDataDir: paths.candidate,
          rollbackUserDataDir: paths.target,
        });
      }
    } else throw new Error();
    assertSourceStopped();
    app.quit();
  } catch {
    throw new Error("INSTANCE_MIGRATION_RESULT_UNKNOWN");
  }
}
