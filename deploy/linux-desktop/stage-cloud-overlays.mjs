import { transformCloudUpdateSource, targets as updateTargets } from './runtime-updates/overlay.mjs';
import { cloudAppVersion } from './build-version.mjs';
// Applies the four cloud runtime overlays to the frozen client source before packaging.
// Order matches the main-process Vite plugin order already qualified for cloud.5/6:
// guidance -> window controls -> task activity -> maintenance.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { transformCloudSource, cloudSettingsGuidancePlugin } from './runtime-guidance/overlay.mjs';
import { transformCloudWindowSource, targets as windowTargets } from './runtime-window-controls/overlay.mjs';
import { transformCloudActivitySource, targets as activityTargets } from './runtime-activity/overlay.mjs';
import { transformMaintenanceSource, cloudMaintenancePlugin, targets as maintenanceTargets } from './runtime-maintenance/overlay.mjs';

const root = path.resolve(process.argv[2] || '/workspace/source'), recipe = path.resolve(process.argv[3] || '/workspace/recipe'), records = [];
const freeze = JSON.parse(fs.readFileSync(recipe + '/source-freeze.json'));
if (freeze.packagingAllowed !== true || freeze.upstream !== `v${process.env.CINDY_UPSTREAM_VERSION}`) throw Error('SOURCE_NOT_QUALIFIED');
const APP_VERSION = cloudAppVersion(process.env.APP_VERSION, process.env.CINDY_UPSTREAM_VERSION);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const guidanceTargets = [
  'apps/desktop/src/main/maker-host/runtime-configs.ts',
  'apps/desktop/src/main/maker-host/pi-host.ts',
  'apps/desktop/src/main/host-settings/helper.ts',
];

const guidance = cloudSettingsGuidancePlugin({ sourceRoot: root });
fs.writeFileSync(recipe + '/guidance-runtime.mjs', guidance.load(guidance.resolveId('virtual:cindy-cloud-settings-guidance')));
const maintenance = cloudMaintenancePlugin({ sourceRoot: root, expectedRegion: 'cn' });
maintenance.configResolved({ define: { 'import.meta.env.VITE_CINDY_AUTH_REGION': JSON.stringify(process.env.VITE_CINDY_AUTH_REGION) } });
fs.writeFileSync(recipe + '/maintenance-runtime.mjs', maintenance.load('\0virtual:cindy-cloud-maintenance'));

const virtuals = [
  ['virtual:cindy-cloud-settings-guidance', recipe + '/guidance-runtime.mjs'],
  ['virtual:cindy-cloud-main-window-controls', recipe + '/runtime-window-controls/policy.mjs'],
  ['virtual:cindy-cloud-task-activity', recipe + '/runtime-activity/publisher.mjs'],
  ['virtual:cindy-cloud-maintenance', recipe + '/maintenance-runtime.mjs'],
];
const transforms = [
  ['guidance', guidanceTargets, transformCloudSource],
  ['window', windowTargets, transformCloudWindowSource],
  ['updates', updateTargets, transformCloudUpdateSource],
  ['activity', activityTargets, transformCloudActivitySource],
  ['maintenance', maintenanceTargets, transformMaintenanceSource],
];
for (const [overlay, targets, transform] of transforms) {
  for (const relative of targets) {
    const file = path.join(root, relative), before = fs.readFileSync(file, 'utf8');
    let after = transform(before, relative);
    if (!after) throw Error(`overlay ${overlay} missing for ${relative}`);
    for (const [id, target] of virtuals) after = after.replaceAll(`'${id}'`, JSON.stringify(target));
    if (after.includes("'virtual:cindy-cloud")) throw Error(`unresolved virtual import in ${relative}`);
    fs.writeFileSync(file, after);
    records.push({ overlay, file: relative, beforeSha256: sha(before), afterSha256: sha(after) });
  }
}

const forge = root + '/apps/desktop/forge.config.ts', forgeBefore = fs.readFileSync(forge, 'utf8');
const commit = JSON.parse(fs.readFileSync(recipe + '/source-freeze.json')).commit;
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('invalid commit');
let forgeAfter = forgeBefore.replace("execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim()", JSON.stringify(commit));
if (forgeAfter === forgeBefore) throw Error('source metadata anchor changed');
for (const [a, b] of [['concurrent: isDev ? false : true,', 'concurrent: false,'], ['packagerConfig: {', "packagerConfig: {\n    electronZipDir: '/workspace',"]]) {
  if (forgeAfter.split(a).length !== 2) throw Error(`forge anchor changed: ${a}`);
  forgeAfter = forgeAfter.replace(a, b);
}
fs.writeFileSync(forge, forgeAfter);
records.push({ overlay: 'build-metadata-and-memory-budget', file: 'apps/desktop/forge.config.ts', beforeSha256: sha(forgeBefore), afterSha256: sha(forgeAfter) });

const pkg = root + '/apps/desktop/package.json', pkgBefore = fs.readFileSync(pkg, 'utf8'), pkgJson = JSON.parse(pkgBefore);
if (pkgJson.version !== '0.0.0') throw Error('Unexpected package version input');
pkgJson.version = APP_VERSION;
const pkgAfter = JSON.stringify(pkgJson, null, 2) + '\n';
fs.writeFileSync(pkg, pkgAfter);
records.push({ overlay: 'package-version', file: 'apps/desktop/package.json', beforeSha256: sha(pkgBefore), afterSha256: sha(pkgAfter) });

fs.writeFileSync(recipe + '/overlay-application.json', JSON.stringify(records, null, 2));
console.log('Cloud overlays staged:', records.length);
