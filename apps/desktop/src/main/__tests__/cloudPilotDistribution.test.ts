import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { CLOUD_PILOT_DESCRIPTOR, resolveCloudPilotDistribution } from '../cloudPilotDistribution.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-distribution-')); roots.push(root);
  const resourcesPath = path.join(root, 'resources'), appData = path.join(root, 'appData');
  fs.mkdirSync(resourcesPath); fs.mkdirSync(appData);
  if (enabled) fs.writeFileSync(path.join(resourcesPath, CLOUD_PILOT_DESCRIPTOR), JSON.stringify({ version: 1, profile: 'CindyCloudPilot-cn-20260915-r2', region: 'cn' }));
  return { resourcesPath, appData, packaged: true, region: 'cn', version: '0.0.0' };
}
it('leaves normal packages and development profiles untouched', () => {
  const f = fixture(false); expect(resolveCloudPilotDistribution(f)).toBeNull();
  expect(fs.readdirSync(f.appData)).toEqual([]);
  expect(resolveCloudPilotDistribution({ ...fixture(), packaged: false })).toBeNull();
});
it('isolates and retains device/profile identity across repeated launches without reading the regular profile', () => {
  const f = fixture(); fs.mkdirSync(path.join(f.appData, 'Cindy'));
  fs.writeFileSync(path.join(f.appData, 'Cindy', 'user-data-sentinel'), 'keep');
  const first = resolveCloudPilotDistribution(f)!;
  expect(resolveCloudPilotDistribution(f)).toEqual(first);
  expect(first.deviceId).toMatch(/^pilot-[a-f0-9]{24}$/);
  expect(first.userData).not.toBe(path.join(f.appData, 'Cindy'));
  expect(fs.readFileSync(path.join(f.appData, 'Cindy', 'user-data-sentinel'), 'utf8')).toBe('keep');
});
it('refuses released/updating versions, a wrong region, corrupted metadata and preexisting unowned data', () => {
  const f = fixture();
  expect(() => resolveCloudPilotDistribution({ ...f, version: '1.0.0' })).toThrow();
  expect(() => resolveCloudPilotDistribution({ ...f, region: 'global' })).toThrow();
  const profile = path.join(f.appData, 'CindyCloudPilot-cn-20260915-r2');
  fs.mkdirSync(profile, { mode: 0o700 }); fs.writeFileSync(path.join(profile, 'existing.db'), 'preserve');
  expect(() => resolveCloudPilotDistribution(f)).toThrow();
  expect(fs.readFileSync(path.join(profile, 'existing.db'), 'utf8')).toBe('preserve');
});
it('rejects a symlink to another profile', () => {
  const f = fixture(), target = path.join(f.appData, 'Cindy'); fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(f.appData, 'CindyCloudPilot-cn-20260915-r2'), 'dir');
  expect(() => resolveCloudPilotDistribution(f)).toThrow();
  expect(fs.readdirSync(target)).toEqual([]);
});

function devFixture(version = '0.1.108-dev.cloud.20261016.1') {
  const f = { ...fixture(false), version };
  fs.writeFileSync(path.join(f.resourcesPath, CLOUD_PILOT_DESCRIPTOR), JSON.stringify({
    version: 2, profile: 'CindyCloudDev-cn', region: 'cn', appVersion: version,
  }));
  fs.writeFileSync(path.join(f.resourcesPath, 'cloud-dev-endpoints.json'), '{}');
  return f;
}
it('versioned Dev retains an independent identity across build upgrades', () => {
  const f = devFixture();
  const first = resolveCloudPilotDistribution(f)!;
  expect(first.userData).toBe(path.join(f.appData, 'CindyCloudDev-cn'));
  expect(first.appData).toBe(path.join(first.userData, 'app-data'));
  expect(first.appName).toBe('CindyCloudDev-cn');
  const nextVersion = '0.1.109-dev.cloud.20261017.2';
  fs.writeFileSync(path.join(f.resourcesPath, CLOUD_PILOT_DESCRIPTOR), JSON.stringify({
    version: 2, profile: 'CindyCloudDev-cn', region: 'cn', appVersion: nextVersion,
  }));
  expect(resolveCloudPilotDistribution({ ...f, version: nextVersion })).toEqual(first);
  expect(fs.existsSync(path.join(f.appData, 'Cindy'))).toBe(false);
});
it('rejects mismatched or release versions and missing private endpoint resources', () => {
  const f = devFixture();
  expect(() => resolveCloudPilotDistribution({ ...f, version: '0.1.108-dev.cloud.20261016.2' })).toThrow();
  expect(() => resolveCloudPilotDistribution(devFixture('0.1.108'))).toThrow();
  fs.unlinkSync(path.join(f.resourcesPath, 'cloud-dev-endpoints.json'));
  expect(() => resolveCloudPilotDistribution(f)).toThrow();
  expect(fs.readdirSync(f.appData)).toEqual([]);
});
it('rejects a replaced shared-data directory instead of following it into Release', () => {
  const f = devFixture(), first = resolveCloudPilotDistribution(f)!;
  fs.rmdirSync(first.appData);
  const formal = path.join(f.appData, 'Cindy'); fs.mkdirSync(formal);
  fs.symlinkSync(formal, first.appData, 'dir');
  expect(() => resolveCloudPilotDistribution(f)).toThrow();
  expect(fs.readdirSync(formal)).toEqual([]);
});
