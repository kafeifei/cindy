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
