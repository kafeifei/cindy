import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export const CLOUD_PILOT_DESCRIPTOR = 'cloud-pilot-distribution.json';
const profileName = 'CindyCloudPilot-cn-20260915-r2';
let active = false;
let managedHome: string | null = null;
/** Only Cindy-managed state uses this root; never replace the OS user's HOME. */
export function cindyManagedHomeDir(): string { return managedHome ?? os.homedir(); }
export function cloudPilotKeychainService(normal: string): string {
  return active ? `CindyCloudPilot-cn-r2:${normal}` : normal;
}
export function isCloudPilotDistribution(): boolean { return active; }

function reject(): never { throw new Error('CLOUD_PILOT_PROFILE_INVALID'); }
function readJson(file: string): unknown {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) reject();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** An optional signed package resource; no runtime flag can activate this mode.
 * All persisted identity belongs to the isolated pilot profile. No existing
 * Cindy profile, login, device id or keychain identity is adopted. */
export function resolveCloudPilotDistribution(input: {
  resourcesPath: string; appData: string; packaged: boolean; region: string; version: string;
}): { userData: string; deviceId: string; appName: string; managedHome: string } | null {
  if (!input.packaged) return null;
  let descriptor: unknown;
  try { descriptor = readJson(path.join(input.resourcesPath, CLOUD_PILOT_DESCRIPTOR)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (JSON.stringify(descriptor) !== JSON.stringify({ version: 1, profile: profileName, region: 'cn' })
    || input.region !== 'cn' || input.version !== '0.0.0') reject();
  const userData = path.join(input.appData, profileName);
  try { fs.mkdirSync(userData, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(userData);
  if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
  if (process.platform !== 'win32' && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)) reject();
  const identityFile = path.join(userData, 'pilot-identity.json');
  if (!fs.existsSync(identityFile)) {
    if (fs.readdirSync(userData).some(name => !/^\.pilot-identity-[a-f0-9]{24}$/u.test(name))) reject();
    const identity = { version: 1, profile: profileName, deviceId: `pilot-${randomBytes(12).toString('hex')}` };
    const temporary = path.join(userData, `.pilot-identity-${randomBytes(12).toString('hex')}`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(identity)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(temporary, identityFile); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    finally { fs.unlinkSync(temporary); }
  }
  const identity = readJson(identityFile) as Record<string, unknown>;
  const identityStat = fs.lstatSync(identityFile);
  if (process.platform !== 'win32' && (identityStat.uid !== process.getuid!() || (identityStat.mode & 0o077) !== 0)) reject();
  if (Object.keys(identity).sort().join(',') !== 'deviceId,profile,version' || identity.version !== 1
    || identity.profile !== profileName || typeof identity.deviceId !== 'string'
    || !/^pilot-[a-f0-9]{24}$/u.test(identity.deviceId)) reject();
  const privateHome = path.join(userData, 'managed-home');
  try { fs.mkdirSync(privateHome, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const homeStat = fs.lstatSync(privateHome);
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink()
    || process.platform !== 'win32' && (homeStat.uid !== process.getuid!() || (homeStat.mode & 0o077) !== 0)) reject();
  managedHome = privateHome;
  active = true;
  return { userData, deviceId: identity.deviceId, managedHome: privateHome, appName: 'CindyCloudPilot-cn-r2' };
}
