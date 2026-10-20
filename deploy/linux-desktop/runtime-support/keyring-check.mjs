#!/usr/bin/env node
import fs from "node:fs";
import { readPreflightContext } from "./profile-runtime-wire.mjs";

try {
  const file = process.env.CINDY_POD_KEYRING_PASSWORD_FILE;
  const preflight = file === '/preflight/run/key';
  if (preflight) readPreflightContext();
  if (
    (!preflight && file !== "/run/secrets/credential-store-key") ||
    (!(preflight && ["/preflight/run/home-a", "/preflight/run/home-b"].includes(process.env.HOME)) && process.env.HOME !== "/home/cindy" &&
      !(
        process.env.HOME === "/var/lib/cindy/maintenance/home" &&
        ["prepare", "verify"].includes(process.env.CINDY_PROFILE_STAGE)
      )) ||
    process.getuid() !== 10001
  )
    throw new Error();
  const realFile = fs.realpathSync(file);
  if (!(preflight ? realFile === "/preflight/run/key" : realFile.startsWith("/run/secrets/"))) throw new Error();
  const descriptor = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size < 43 ||
      stat.size > 44 ||
      (stat.mode & 0o007) !== 0 ||
      (stat.mode & 0o022) !== 0 ||
      ![0, process.getuid()].includes(stat.uid)
    )
      throw new Error();
    if (!/^[A-Za-z0-9_-]{43}\n?$/.test(fs.readFileSync(descriptor, "utf8")))
      throw new Error();
  } finally {
    fs.closeSync(descriptor);
  }
} catch {
  process.stderr.write("INSTANCE_KEYRING_SECRET_REJECTED\n");
  process.exitCode = 1;
}
