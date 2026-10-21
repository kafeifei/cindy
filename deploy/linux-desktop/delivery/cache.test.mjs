import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plans, prepareAll } from './cache.mjs';
import { prepareImageCache } from './acs-api.mjs';
const exampleConfig = JSON.parse(fs.readFileSync(new URL('./acs-targets.example.json', import.meta.url)));
// Existing drift still needs complete inventory; it is not a recommended target.
const config = structuredClone(exampleConfig);
config.targets[0].profiles.push({ name:'observed-init-drift', main:'$runtime',
  initContainers:[{ name:'initialize-persistent-volume',
    image:`registry.example.com/cindy/cloud-runtime-cn:legacy@sha256:${'a'.repeat(64)}` }] });
const manifest = { channel:'candidate', releaseApproved:false, version:{region:'cn',platform:'linux/amd64'},
  image:{reference:`registry.example.com/cindy/cloud-runtime-cn:0.1.108-cloud.1-cn-amd64@sha256:${'b'.repeat(64)}`,digest:`sha256:${'b'.repeat(64)}`} };
const list = () => plans(manifest, structuredClone(config));
function ready(p) { return {ImageCacheId:'imc-example',ImageCacheName:p.request.ImageCacheName,Status:'Ready',Images:[p.imageReference],
  RegionId:p.request.RegionId,Platform:p.request.Platform,NetworkConfig:p.request.NetworkConfig}; }

test('default new-claim and verified templates share one runtime for main and init', () => {
  const [target] = plans(manifest, exampleConfig);
  assert.equal(target.profiles.length,2);
  assert.equal(target.plans.length,1);
  for (const profile of target.profiles) {
    assert.equal(profile.main,manifest.image.reference);
    assert.equal(profile.initContainers.length,1);
    assert.equal(profile.initContainers[0].image,manifest.image.reference);
  }
});
test('explicit observed init drift remains covered without rewriting the inventory', () => {
  const [target] = list();
  assert.equal(target.profiles.length,3);
  assert.equal(target.plans.length,2);
  assert.equal(target.profiles[0].main,manifest.image.reference);
  assert.equal(target.profiles[0].initContainers[0].image,manifest.image.reference);
  assert.match(target.profiles[2].initContainers[0].image,/:legacy@sha256/);
});
test('fails closed on omitted init inventory, floating tag, unknown repo or secrets', () => {
  for (const modify of [c=>delete c.targets[0].profiles[0].initContainers,
    c=>c.targets[0].profiles[2].initContainers[0].image='example:latest',
    c=>c.targets[0].repositories=[], c=>c.targets[0].password='invalid-test-fixture',
    c=>c.targets[0].profiles[1].name='new-claims']) {
    const c=structuredClone(config);modify(c);assert.throws(()=>plans(manifest,c));
  }
});
test('exact spelling and network participate in stable retry token', () => {
  const p=list()[0].plans[0];
  assert.equal(p.planHash,list()[0].plans[0].planHash);
  const c=structuredClone(config);c.targets[0].vSwitchIds=['vsw-other'];
  assert.notEqual(p.planHash,plans(manifest,c)[0].plans[0].planHash);
});
test('Ready does not mean Pod hit or promotion; identical retries resume without create', async () => {
  const p=list()[0].plans[0];const calls=[];
  const receipt=await prepareImageCache(p,{call:async(op)=>{calls.push(op);return op==='ListImageCaches'?{ImageCaches:[ready(p)]}:ready(p);}});
  assert.deepEqual(calls,['ListImageCaches','GetImageCache']);
  assert.equal(receipt.status,'Ready');assert.equal(receipt.podMatchVerified,false);assert.equal(receipt.releaseApproved,false);
});
test('ready cache with wrong network, digest, region or platform is rejected', async () => {
  const p=list()[0].plans[0];
  for (const change of [{Images:[manifest.image.reference+'x']},{Platform:'linux/arm64'},{RegionId:'ap-southeast-1'},{NetworkConfig:{}}]) {
    await assert.rejects(prepareImageCache(p,{call:async(op)=>op==='ListImageCaches'?{ImageCaches:[ready(p)]}:{...ready(p),...change}}));
  }
});
test('partial discovery failure never creates cache; pagination cycles fail closed', async () => {
  const p=list()[0].plans[0];const calls=[];
  await assert.rejects(prepareImageCache(p,{call:async(op)=>{calls.push(op);return {ImageCaches:[],NextToken:'again'};}}),/pagination/);
  assert.deepEqual(calls,['ListImageCaches','ListImageCaches']);
});
test('timeout leaves existing work intact and reports pending instead of Ready', async () => {
  const p=list()[0].plans[0];let time=0;const calls=[];
  await assert.rejects(prepareImageCache(p,{now:()=>time,timeoutMs:5,pollMs:2,sleep:async n=>{time+=n;},
    call:async op=>{calls.push(op);return op==='ListImageCaches'?{ImageCaches:[]} : {ImageCacheId:'imc-example',Status:'Creating'};}}),/timeout/);
  assert.equal(calls.filter(x=>x==='CreateImageCache').length,1);
  assert.ok(!calls.some(x=>x.startsWith('Delete')));
});
test('partial image set failure stops subsequent caches', async () => {
  const targets=list();let creations=0;
  await assert.rejects(prepareAll(targets,{call:async op=> {
    if(op==='ListImageCaches')return {ImageCaches:[]};
    if(op==='CreateImageCache'){creations++;return {ImageCacheId:'imc-example'};}
    return {ImageCacheId:'imc-example',Status:'Failed'};
  }}),/Failed/);
  assert.equal(creations,1);
});

test('provider-assigned default resource group is allowed; explicit groups must match', async () => {
  const p=list()[0].plans[0];
  const call=async op=>op==='ListImageCaches'?{ImageCaches:[ready(p)]}:{...ready(p),ResourceGroupId:'rg-default'};
  assert.equal((await prepareImageCache(p,{call})).status,'Ready');
  const c=structuredClone(config);c.targets[0].resourceGroupId='rg-explicit';
  await assert.rejects(prepareImageCache(plans(manifest,c)[0].plans[0],{call}),/resource group mismatch/);
});
