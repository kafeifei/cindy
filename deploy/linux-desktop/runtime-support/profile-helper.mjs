#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  profileMounts,
  readProfileMaintenanceContext,
} from "/usr/local/lib/cindy/profile-maintenance-context.mjs";

process.umask(0o077);

function syncFile(target) {
  const descriptor = fs.openSync(
    target,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncTree(directory) {
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== 10001 ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error();
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const child = fs.lstatSync(file);
    if (child.isDirectory() && !child.isSymbolicLink()) syncTree(file);
    else if (
      child.isFile() &&
      child.nlink === 1 &&
      child.uid === 10001 &&
      (child.mode & 0o077) === 0
    )
      syncFile(file);
    else throw new Error();
  }
  syncFile(directory);
}

function copyPrivateKeyrings(source, destination) {
  if (fs.readdirSync(source).length === 0) throw new Error();
  if (fs.existsSync(destination)) {
    if (destination !== profileMounts.keyrings) throw new Error();
    syncTree(destination);
    fs.rmSync(destination, { recursive: true });
  }
  const copy = (from, to) => {
    const stat = fs.lstatSync(from);
    if (
      stat.uid !== 10001 ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error();
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { mode: 0o700 });
      for (const name of fs.readdirSync(from))
        copy(path.join(from, name), path.join(to, name));
    } else if (stat.isFile() && stat.nlink === 1 && stat.size <= 1_048_576) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, 0o600);
    } else throw new Error();
  };
  fs.mkdirSync(path.dirname(destination), {
    recursive: true,
    mode: 0o700,
  });
  copy(source, destination);
  syncTree(destination);
  syncFile(path.dirname(destination));
}

function privateDirectories(root, relative) {
  let current = root;
  for (const name of relative.split("/")) {
    current = path.join(current, name);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== 10001 ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error();
    syncFile(current);
    syncFile(path.dirname(current));
  }
}

function persistReceipt(file, value) {
  const encoded = JSON.stringify(value);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== 10001 ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 4096 ||
      fs.readFileSync(file, "utf8") !== encoded
    )
      throw new Error();
    return;
  }
  const temporary = `${file}.pending`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, encoded);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.linkSync(temporary, file);
  fs.unlinkSync(temporary);
  syncFile(path.dirname(file));
}

async function runStage(stage) {
  const child = spawn(
    "/usr/local/bin/cindy-linux-desktop",
    ["/opt/cindy/Cindy", "--cloud-credential-maintenance"],
    {
      env: { ...process.env, CINDY_PROFILE_STAGE: stage },
      stdio: "ignore",
    },
  );
  let timedOut = false;
  let forceStop;
  const cancel = () => {
    timedOut = true;
    child.kill("SIGTERM");
    forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000);
  };
  const timeout = setTimeout(cancel, 60_000);
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0 && !signal && !timedOut ? resolve() : reject(new Error()),
      );
    });
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceStop);
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}

try {
  const args = [
    "--request-file",
    profileMounts.request,
    "--binding-file",
    profileMounts.binding,
    "--pod-uid-file",
    profileMounts.podUid,
    "--receipt-file",
    profileMounts.receipt,
  ];
  if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(args))
    throw new Error();
  const sandbox = spawnSync(
    "/usr/bin/unshare",
    ["--propagation=unchanged", "-Urmpfn", "true"],
    { stdio: "ignore", timeout: 5_000 },
  );
  if (sandbox.error || sandbox.status !== 0 || sandbox.signal)
    throw new Error();
  const context = readProfileMaintenanceContext();
  const paths = context.paths;
  const forward = context.request.action === "prepare-profile";
  if (forward) {
    const parent = fs.lstatSync(profileMounts.profile);
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      ![0, 10001].includes(parent.uid) ||
      parent.gid !== 10001 ||
      (parent.mode & 0o002) !== 0
    )
      throw new Error();
  }
  privateDirectories("/var/lib/cindy/maintenance", "home");
  const transactionRoot = forward
    ? profileMounts.profile
    : profileMounts.transaction;
  privateDirectories(
    transactionRoot,
    `${forward ? "handoff/" : ""}${context.request.operationId}/${context.request.requestId}`,
  );
  const expected = {
    version: 3,
    operationId: context.request.operationId,
    requestId: context.request.requestId,
    helperPodUid: context.request.helperPodUid,
    requestSha256: context.requestSha256,
    action: context.request.action,
    outcome: "prepared",
    durable: true,
    proof:
      context.request.action === "prepare-profile"
        ? "source-preserved-and-cindy-only-profiles"
        : "latest-resource-reverse-import-compatible",
  };
  const transaction = fs.lstatSync(paths.transaction);
  if (
    !transaction.isDirectory() ||
    transaction.isSymbolicLink() ||
    transaction.uid !== 10001 ||
    (transaction.mode & 0o077) !== 0
  )
    throw new Error();
  if (fs.existsSync(paths.receipt)) {
    const stat = fs.lstatSync(paths.receipt);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== 10001 ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 16_384
    )
      throw new Error();
    if (
      JSON.stringify(JSON.parse(fs.readFileSync(paths.receipt, "utf8"))) !==
      JSON.stringify(expected)
    )
      throw new Error();
  } else {
    fs.mkdirSync(path.join(paths.transaction, "execution.lock"), {
      mode: 0o700,
    });
    syncFile(paths.transaction);
    if (forward) {
      if (
        fs.readdirSync(profileMounts.profile).some((name) => name !== "handoff")
      )
        throw new Error();
      for (const target of ["candidate", "recovery"]) {
        for (const directory of ["home", "user-data", "workspaces"])
          privateDirectories(profileMounts.profile, `${target}/${directory}`);
      }
    }
    for (const stage of ["prepare", "verify"]) {
      if (
        readProfileMaintenanceContext().requestSha256 !== context.requestSha256
      )
        throw new Error();
      if (!forward || stage === "verify")
        copyPrivateKeyrings(paths.persistentKeyrings, profileMounts.keyrings);
      await runStage(stage);
      syncTree(profileMounts.keyrings);
      syncTree(paths.target);
      if (forward && stage === "prepare") {
        copyPrivateKeyrings(profileMounts.keyrings, paths.persistentKeyrings);
        syncTree(paths.recovery);
      }
    }
    if (readProfileMaintenanceContext().requestSha256 !== context.requestSha256)
      throw new Error();
    persistReceipt(paths.receipt, expected);
  }
  persistReceipt(profileMounts.receipt, expected);
  process.stdout.write("INSTANCE_MIGRATION_PREPARED\n");
} catch {
  process.stderr.write("INSTANCE_MIGRATION_RESULT_UNKNOWN\n");
  process.exitCode = 1;
}
