#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const CACHE_ID = /^imc-[a-zA-Z0-9]+$/;
const OPERATIONS = new Set(['ListImageCaches', 'CreateImageCache', 'GetImageCache']);
const TARGET_KEYS = new Set(['regionId', 'repository', 'vSwitchIds', 'securityGroupId', 'resourceGroupId']);

function requireString(value, pattern, name) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`invalid ${name}`);
  return value;
}

// This file plans/prepares one existing registry image. A cache being Ready is
// neither a signature check nor permission to publish a tag or upgrade a user.
export function buildImageCachePlan({ targets, imageReference, buildRegion = 'global' }) {
  if (!['global', 'cn'].includes(buildRegion)) throw new Error('buildRegion must be global or cn');
  const target = targets?.[buildRegion];
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('an explicit image cache target is required for the build region');
  }
  if (Object.keys(target).some((key) => !TARGET_KEYS.has(key))) {
    throw new Error('unsupported target field; credentials must not be part of the configuration');
  }
  const regionId = requireString(target.regionId, /^[a-z]{2}-[a-z0-9-]+$/, 'regionId');
  const repository = requireString(
    target.repository,
    /^[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/,
    'repository (registry host and path only)',
  );
  if (targets?.global?.repository && targets?.global?.repository === targets?.cn?.repository) {
    throw new Error('global and cn must use separate image repositories');
  }
  if (typeof imageReference !== 'string' || imageReference.length > 512) {
    throw new Error('an immutable registry image reference is required');
  }
  const match = imageReference.match(/^(.+)@sha256:([a-f0-9]{64})$/);
  if (!match) throw new Error('image reference must include a registry sha256 digest');
  const name = match[1];
  const suffix = name.slice(repository.length);
  if (name !== repository && !(name.startsWith(`${repository}:`) && /^:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(suffix))) {
    throw new Error('image reference must match the configured repository exactly');
  }
  const securityGroupId = requireString(target.securityGroupId, /^sg-[a-zA-Z0-9]+$/, 'securityGroupId');
  if (!Array.isArray(target.vSwitchIds) || target.vSwitchIds.length < 1 || target.vSwitchIds.length > 10) {
    throw new Error('vSwitchIds must contain between 1 and 10 switch IDs');
  }
  const vSwitchIds = [...new Set(target.vSwitchIds.map((id) => requireString(id, /^vsw-[a-zA-Z0-9]+$/, 'vSwitchId')))].sort();
  const resourceGroupId = target.resourceGroupId === undefined
    ? undefined : requireString(target.resourceGroupId, /^rg-[a-zA-Z0-9]+$/, 'resourceGroupId');
  const networkConfig = { VSwitchIds: vSwitchIds, SecurityGroupId: securityGroupId };
  const planHash = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1, buildRegion, imageReference, regionId, networkConfig, resourceGroupId,
  })).digest('hex');
  const cacheName = `cloud-runtime${buildRegion === 'cn' ? '-cn' : ''}-${planHash.slice(0, 32)}`;
  return {
    schemaVersion: 1,
    buildRegion,
    planHash,
    imageReference,
    registryDigest: `sha256:${match[2]}`,
    request: {
      RegionId: regionId,
      ImageCacheName: cacheName,
      Images: [imageReference],
      Platform: 'linux/amd64',
      ClientToken: planHash,
      NetworkConfig: networkConfig,
      ...(resourceGroupId ? { ResourceGroupId: resourceGroupId } : {}),
    },
    podAnnotations: { 'image.alibabacloud.com/enable-image-cache': 'true' },
    matchEvidenceAnnotation: 'image.alibabacloud.com/matched-image-caches',
    status: 'Planned',
    podMatchVerified: false,
    releaseApproved: false,
  };
}

function exactImage(cache, reference) {
  return Array.isArray(cache.Images) && cache.Images.length === 1 && cache.Images[0] === reference;
}

function cacheId(value) {
  return requireString(value, CACHE_ID, 'ACS image cache ID');
}

export async function prepareImageCache(plan, {
  call,
  now = Date.now,
  sleep = delay,
  timeoutMs = 15 * 60_000,
  pollMs = 10_000,
  onProgress = () => {},
} = {}) {
  if (typeof call !== 'function') throw new Error('an ACS API adapter is required');
  const deadline = now() + timeoutMs;
  const query = { RegionId: plan.request.RegionId, ImageCacheName: plan.request.ImageCacheName, MaxResults: 100 };
  let nextToken;
  const seenTokens = new Set();
  const matches = [];
  // Even filtered results can be paginated. Bound both pages and wall time,
  // and never create another cache after a failed/partial discovery.
  for (let page = 0; ; page += 1) {
    if (page >= 100 || now() >= deadline) throw new Error('image cache discovery exceeded its limit');
    const result = await call('ListImageCaches', { ...query, ...(nextToken ? { NextToken: nextToken } : {}) });
    if (!Array.isArray(result.ImageCaches)) throw new Error('invalid ListImageCaches response');
    matches.push(...result.ImageCaches.filter((cache) => cache.ImageCacheName === query.ImageCacheName
      && exactImage(cache, plan.imageReference)));
    nextToken = result.NextToken;
    if (!nextToken) break;
    if (typeof nextToken !== 'string' || seenTokens.has(nextToken)) throw new Error('invalid image cache pagination');
    seenTokens.add(nextToken);
  }
  // Prefer a ready copy; otherwise resume a previous creation. Failed caches
  // need an explicit operator decision, not an automatic delete/recreate loop.
  const existing = matches.find((cache) => cache.Status === 'Ready') ?? matches[0];
  let imageCacheId;
  if (existing) {
    imageCacheId = cacheId(existing.ImageCacheId);
  } else {
    if (now() >= deadline) throw new Error('image cache preparation timed out before creation');
    const created = await call('CreateImageCache', plan.request);
    imageCacheId = cacheId(created.ImageCacheId);
  }
  onProgress({ ...plan, imageCacheId, reused: Boolean(existing), status: 'Waiting' });
  while (now() < deadline) {
    const cache = await call('GetImageCache', { RegionId: plan.request.RegionId, ImageCacheId: imageCacheId });
    if (cache.ImageCacheId !== imageCacheId) throw new Error('GetImageCache returned a different cache ID');
    if (cache.Status === 'Ready') {
      if (!exactImage(cache, plan.imageReference)) throw new Error('Ready cache does not match the exact image reference');
      if (cache.RegionId !== plan.request.RegionId || cache.Platform !== plan.request.Platform
        || cache.NetworkConfig?.SecurityGroupId !== plan.request.NetworkConfig.SecurityGroupId
        || JSON.stringify([...(cache.NetworkConfig?.VSwitchIds ?? [])].sort()) !== JSON.stringify(plan.request.NetworkConfig.VSwitchIds)
        || (plan.request.ResourceGroupId && cache.ResourceGroupId !== plan.request.ResourceGroupId)) {
        throw new Error('Ready cache network, platform or resource group mismatch');
      }
      const receipt = {
        ...plan,
        imageCacheId,
        reused: Boolean(existing),
        status: 'Ready',
        sizeGiB: cache.Size,
        readyTime: cache.ReadyTime,
      };
      onProgress(receipt);
      return receipt;
    }
    if (['Failed', 'Deleting', 'Deleted', 'Expired'].includes(cache.Status)) {
      throw new Error(`image cache ${imageCacheId} is ${cache.Status}; no resources were deleted`);
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw new Error(`image cache ${imageCacheId} did not become Ready before timeout; creation may still be running`);
}

// Use the vendor CLI for STS signing. RPC parameter shapes follow the official
// acc/2024-04-02 SDK: Images is repeated, NetworkConfig is a JSON string. --force
// selects that API version without depending on the CLI's bundled API catalog.
export function callAliyun(operation, request) {
  if (!OPERATIONS.has(operation)) throw new Error('unsupported ACS operation');
  for (const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN']) {
    if (!process.env[key]) throw new Error('apply requires explicit short-lived Alibaba Cloud STS credentials');
  }
  const args = ['acc', operation, '--force', '--version', '2024-04-02',
    '--endpoint', `acc.${request.RegionId}.aliyuncs.com`, '--region', request.RegionId,
    '--mode', 'StsToken', '--method', 'POST', '--secure'];
  for (const [key, value] of Object.entries(request)) {
    if (Array.isArray(value)) value.forEach((item, i) => args.push(`--${key}.${i + 1}`, String(item)));
    else args.push(`--${key}`, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const result = spawnSync(process.platform === 'win32' ? 'aliyun.exe' : 'aliyun', args, {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, shell: false,
    // CLI 3.5.0 otherwise prefers saved profile credentials to environment
    // credentials. Override only this child process; never reconfigure ~/.aliyun.
    env: { ...process.env, ALIBABA_CLOUD_IGNORE_PROFILE: 'TRUE', ALIBABACLOUD_IGNORE_PROFILE: 'TRUE' },
  });
  // Do not echo the vendor's raw output: authentication errors may contain
  // request details. Cloud-side diagnostics are available in ActionTrail.
  if (result.error || result.status !== 0) throw new Error(`${operation} failed; inspect Alibaba Cloud diagnostics (CLI output withheld)`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}
