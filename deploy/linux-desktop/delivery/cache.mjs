#!/usr/bin/env node
// Public records contain no private network IDs. Publish only digest-bound
// status and opaque cache IDs; keep network configuration in Environment secrets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildImageCachePlan, prepareImageCache, callAliyun } from './acs-api.mjs';

const exact = /^([a-z0-9][a-z0-9.-]+(?:\:[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+)(?:\:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?@sha256:[a-f0-9]{64}$/;
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('invalid cache configuration fields');
}
export function plans(manifest, config) {
  keys(config, ['schemaVersion', 'targets']);
  if (config.schemaVersion !== 1 || !Array.isArray(config.targets) || !config.targets.length || config.targets.length > 20) throw new Error('cache targets required');
  if (manifest.channel !== 'candidate' || manifest.releaseApproved !== false
    || manifest.version?.region !== 'cn' || manifest.version?.platform !== 'linux/amd64'
    || !exact.test(manifest.image?.reference ?? '')
    || !manifest.image.reference.endsWith('@' + manifest.image.digest)) throw new Error('invalid candidate manifest');
  const names = new Set();
  return config.targets.map(target => {
    keys(target, ['name', 'regionId', 'vSwitchIds', 'securityGroupId', 'resourceGroupId', 'repositories', 'profiles']);
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(target.name) || names.has(target.name)) throw new Error('invalid or duplicate target');
    names.add(target.name);
    if (!Array.isArray(target.repositories) || !target.repositories.length
      || !Array.isArray(target.profiles) || !target.profiles.length) throw new Error('repositories and actual pod profiles required');
    const images = new Set();
    const profileNames = new Set();
    function resolve(image) {
      const reference = image === '$runtime' ? manifest.image.reference : image;
      const match = typeof reference === 'string' && reference.match(exact);
      if (!match || !target.repositories.includes(match[1])) throw new Error('image is not digest-pinned in an allowed repository');
      images.add(reference);
      return reference;
    }
    const profiles = target.profiles.map(profile => {
      keys(profile, ['name', 'main', 'initContainers']);
      if (!/^[a-z][a-z0-9-]{0,60}$/.test(profile.name) || profileNames.has(profile.name)) throw new Error('invalid or duplicate profile');
      profileNames.add(profile.name);
      if (profile.main !== '$runtime' || !Array.isArray(profile.initContainers)) throw new Error('explicit main and initContainer inventory required');
      const inits = new Set();
      return { name: profile.name, main: resolve(profile.main), initContainers: profile.initContainers.map(init => {
        keys(init, ['name', 'image']);
        if (!/^[a-z][a-z0-9-]{0,62}$/.test(init.name) || inits.has(init.name)) throw new Error('invalid or duplicate initContainer');
        inits.add(init.name);
        return { name: init.name, image: resolve(init.image) };
      }) };
    });
    return { name: target.name, profiles, plans: [...images].sort().map(reference => buildImageCachePlan({
      targets: { cn: { regionId: target.regionId, repository: reference.match(exact)[1],
        vSwitchIds: target.vSwitchIds, securityGroupId: target.securityGroupId,
        ...(target.resourceGroupId ? { resourceGroupId: target.resourceGroupId } : {}) } },
      imageReference: reference, buildRegion: manifest.version.region,
    })) };
  });
}
export async function prepareAll(targets, options, progress = () => {}) {
  const tasks = targets.flatMap(target => target.plans.map(plan => ({ target: target.name, plan })));
  const receipts = [];
  let cursor = 0, failure;
  // Independent image/network plans have distinct idempotency tokens. Bound API
  // pressure; after failure drain in-flight work and never start another plan.
  async function worker() {
    while (!failure && cursor < tasks.length) {
      const { target, plan } = tasks[cursor++];
      try {
        const receipt = await prepareImageCache(plan, options);
        receipts.push({ target, ...receipt });
        progress([...receipts]);
      } catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, worker));
  if (failure) throw failure;
  return receipts;
}
async function main() {
  const [manifestFile, outputFile] = process.argv.slice(2);
  if (!manifestFile || !outputFile || process.argv.length !== 4) throw new Error('usage: cache.mjs candidate.json public-status.json');
  let config;
  try { config = JSON.parse(process.env.CLOUD_IMAGE_CACHE_TARGETS || '{}'); }
  catch { throw new Error('cache configuration is not JSON (content withheld)'); }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const targetPlans = plans(manifest, config);
  const planHash = createHash('sha256').update(JSON.stringify(targetPlans)).digest('hex');
  const summary = { schemaVersion: 1, image: manifest.image.reference, planHash,
    status: 'Preparing', totalCaches: targetPlans.reduce((n,t) => n + t.plans.length, 0),
    targets: targetPlans.map(t => ({ name: t.name, profiles: t.profiles, planHashes: t.plans.map(p => p.planHash) })),
    readyCaches: 0, receipts: [], podMatchVerified: false, releaseApproved: false };
  const save = () => fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
  save();
  try {
    const receipts = await prepareAll(targetPlans, { call: callAliyun }, rows => {
      summary.readyCaches = rows.length;
      summary.receipts = rows.map(r => ({ image: r.imageReference, planHash: r.planHash, imageCacheId: r.imageCacheId, status: r.status }));
      save();
    });
    if (receipts.length !== summary.totalCaches) throw new Error('incomplete image cache set');
    summary.status = 'Ready'; save();
  } catch (error) {
    summary.status = 'Failed'; save();
    // Do not print provider errors, credentials or private network configuration.
    throw new Error('ACS cache preparation failed; inspect private cloud diagnostics', { cause: error });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
