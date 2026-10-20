import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createActivityReader, taskProbes, nextScheduleWake, inputActivityBlockers } from './activity.mjs';
import { startCloudStatus } from './publisher.mjs';

function setup(overrides = {}) {
  const state = { now: 1_000_000, owner: 'owner-a:epoch-1', ready: true, invoke: false };
  const sources = Object.fromEntries(Object.keys(taskProbes).map(k => [k, () => k === 'listClaudeBackgroundSessions' ? [] : false]));
  sources.anySchedulerRunRunning = async () => false;
  const inputs = { active: 0, queued: 0, interactions: 0, settling: 0 };
  const schedule = { inFlight: 0, waiting: 0, schedules: [] };
  const deps = { resolveSources: () => sources, readContext: () => state,
    readInput: () => inputs, readScheduler: async () => schedule, remoteInvokeBusy: () => state.invoke,
    now: () => state.now, quietMs: 0, ...overrides };
  return { state, sources, inputs, schedule, reader: createActivityReader(deps), deps };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('valid live sources can report idle without enabling automatic suspension', async () => {
  const {reader} = setup(); const r = await reader.read();
  assert.equal(r.cloudActivity.state, 'idle'); assert.deepEqual(r.idle.blockers, []);
  assert.equal(r.idle.maySuspend, false); assert.equal(r.isCurrent(), true);
});
for (const [method, label] of Object.entries(taskProbes)) {
  test(`${label} blocks an upgrade even without an active foreground turn`, async () => {
    const {reader,sources} = setup(); sources[method] = () => method === 'listClaudeBackgroundSessions' ? ['private-id'] : true;
    const result = await reader.read();
    assert.equal(result.cloudActivity.state, 'busy'); assert.ok(result.idle.blockers.includes(label));
    assert.ok(!JSON.stringify(result).includes('private-id'));
  });
  test(`${label} failure and missing method remain unknown`, async () => {
    const {reader,sources} = setup(); sources[method] = () => {throw new Error('secret');};
    const r = await reader.read(); assert.equal(r.cloudActivity.state, 'unknown');
    assert.ok(r.idle.blockers.includes(`${label}-unknown`)); assert.ok(!JSON.stringify(r).includes('secret'));
    delete sources[method]; assert.ok((await reader.read()).idle.blockers.includes('activity-unknown'));
  });
}
test('false-like or async sync-probe returns are not accepted as idle', async () => {
  for (const value of [undefined,null,0,'false',Promise.resolve(false)]) {
    const {reader,sources} = setup(); sources.anySessionInTurn = () => value;
    assert.equal((await reader.read()).cloudActivity.state, 'unknown');
  }
});
for (const key of ['active','queued','interactions','settling']) {
  test(`input ${key} and invalid counts block`, async () => {
    const {reader,inputs} = setup(); inputs[key] = 1;
    assert.equal((await reader.read()).cloudActivity.state, 'busy');
    for (const invalid of [null,undefined,-1,NaN,1.5]) {
      inputs[key] = invalid; assert.equal((await reader.read()).cloudActivity.state, 'unknown');
    }
  });
}
test('an absent input subsystem is unknown, not an empty queue', () => {
  assert.equal(inputActivityBlockers(null).length, 4);
});
test('scheduler running, waiting, imminent wake, and read failures block', async () => {
  const s = setup();
  s.sources.anySchedulerRunRunning = async () => true;
  assert.ok((await s.reader.read()).idle.blockers.includes('scheduler-running'));
  s.sources.anySchedulerRunRunning = async () => false;
  for (const field of ['inFlight','waiting']) {
    s.schedule[field]=1; assert.equal((await s.reader.read()).cloudActivity.state,'busy'); s.schedule[field]=0;
  }
  s.schedule.schedules=[{status:'active',manual:false,nextFireAt:s.state.now+120_000}];
  assert.ok((await s.reader.read()).idle.blockers.includes('scheduler-next-wake'));
  s.schedule.schedules[0].nextFireAt=s.state.now+120_001;
  assert.equal((await s.reader.read()).cloudActivity.state,'idle');
  s.sources.anySchedulerRunRunning=async()=>{throw new Error('db unavailable');};
  assert.ok((await s.reader.read()).idle.blockers.includes('scheduler-unknown'));
});
test('missing future schedule time is not silently discarded', () => {
  assert.throws(()=>nextScheduleWake([{status:'active',manual:false}]));
  assert.throws(()=>nextScheduleWake([{status:'active',manual:false,nextFireAt:NaN}]));
  assert.equal(nextScheduleWake([{status:'paused',manual:false},{status:'active',manual:true}]),null);
  assert.equal(nextScheduleWake([{status:'active',manual:false,nextFireAt:10},{status:'active',manual:false,nextFireAt:20}]),10);
});
test('new work during async reads is captured by the second synchronous sample', async () => {
  const gate=deferred(); const s=setup();
  s.sources.anySchedulerRunRunning=()=>gate.promise;
  const pending=s.reader.read(); s.inputs.queued=1; gate.resolve(false);
  assert.ok((await pending).idle.blockers.includes('pending-input'));
});
test('owner changes during reads and immediately before publication invalidate idle', async () => {
  const gate=deferred(); const s=setup(); s.sources.anySchedulerRunRunning=()=>gate.promise;
  const pending=s.reader.read(); s.state.owner='owner-b:epoch-2'; gate.resolve(false);
  assert.ok((await pending).idle.blockers.includes('owner-changed-unknown'));
  s.sources.anySchedulerRunRunning=async()=>false;
  const r=await s.reader.read(); assert.equal(r.isCurrent(),true);
  s.state.owner='owner-a:epoch-3'; assert.equal(r.isCurrent(),false);
});
test('health or owner unavailability is explicitly unknown', async () => {
  const s=setup(); s.state.ready=false;
  assert.equal((await s.reader.read()).cloudActivity.state,'unknown');
});
test('timeout does not launch duplicate scans and late completion cannot claim idle', async () => {
  const gate=deferred(); const s=setup({timeoutMs:5}); let calls=0;
  s.sources.anySchedulerRunRunning=()=>{calls++;return gate.promise;};
  assert.ok((await s.reader.read()).idle.blockers.includes('collector-timeout-unknown'));
  assert.ok((await s.reader.read()).idle.blockers.includes('collector-pending-unknown'));
  assert.equal(calls,1); gate.resolve(false); await new Promise(r=>setImmediate(r));
  s.sources.anySchedulerRunRunning=async()=>false;
  assert.equal((await s.reader.read()).cloudActivity.state,'idle');
});
test('stopping invalidates outstanding and previous observations', async () => {
  const s=setup(); const previous=await s.reader.read();
  const gate=deferred(); s.sources.anySchedulerRunRunning=()=>gate.promise;
  const pending=s.reader.read(); s.reader.stop(); gate.resolve(false);
  assert.equal(previous.isCurrent(),false);
  assert.equal((await pending).cloudActivity.state,'unknown');
});
test('quiet window restarts on work and on owner replacement', async () => {
  const s=setup({quietMs:10_000});
  assert.ok((await s.reader.read()).idle.blockers.includes('idle-grace'));
  s.state.now+=10_000; assert.equal((await s.reader.read()).cloudActivity.state,'idle');
  s.state.invoke=true; assert.ok((await s.reader.read()).idle.blockers.includes('remote-invoke'));
  s.state.invoke=false; assert.ok((await s.reader.read()).idle.blockers.includes('idle-grace'));
  s.state.now+=10_000; assert.equal((await s.reader.read()).cloudActivity.state,'idle');
  s.state.owner='new-epoch'; assert.ok((await s.reader.read()).idle.blockers.includes('idle-grace'));
});
test('clock reversal and elapsed scans fail closed', async () => {
  for (const delta of [-1,1001]) {
    const s=setup(); s.sources.anySchedulerRunRunning=async()=>{s.state.now+=delta;return false;};
    assert.ok((await s.reader.read()).idle.blockers.includes('collector-stale-unknown'));
  }
});

const build = (config,ready,now,stopping,oauthIdentity) => ({version:1,instanceId:config.deviceId,
  phase:stopping?'stopping':ready.auth?'ready':'starting',heartbeatAtMs:now,readiness:ready,oauthIdentity,
  idle:{maySuspend:false,blockers:['activity-unknown'],lastBusyAtMs:now,nextWakeAtMs:null}});
test('atomic writer keeps health/OAuth contract, private permissions and stopped state', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-activity-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'status.json'); const gate=deferred(); let collect=()=>setup().reader.read(); let failures=0;
  const stop=startCloudStatus({config:{deviceId:'test-device',statusFile:file},read:()=>({auth:true}),
    readOauthIdentity:()=>({public:'unchanged'}),build,onFailure:()=>failures++,collect:()=>collect(),intervalMs:15});
  t.after(stop);
  await new Promise(r=>setTimeout(r,5));
  const first=JSON.parse(fs.readFileSync(file));
  assert.equal(first.phase,'ready'); assert.equal(first.cloudActivity.state,'idle');
  assert.deepEqual(first.oauthIdentity,{public:'unchanged'}); assert.equal(fs.statSync(file).mode & 0o777,0o600);
  collect=()=>gate.promise; await new Promise(r=>setTimeout(r,20)); stop();
  gate.resolve(await setup().reader.read()); await new Promise(r=>setImmediate(r));
  assert.equal(JSON.parse(fs.readFileSync(file)).phase,'stopping'); assert.equal(failures,0);
  assert.deepEqual(fs.readdirSync(root),['status.json']);
});
test('not-ready health and invalidated owners cannot publish an idle result', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-activity-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for (const [ready,current] of [[false,true],[true,false]]) {
    const file=path.join(root,`${ready}-${current}.json`); const s=setup(); const activity=await s.reader.read();
    if(!current)s.state.owner='replaced';
    const stop=startCloudStatus({config:{deviceId:'test',statusFile:file},read:()=>({auth:ready}),
      readOauthIdentity:()=>undefined,build,onFailure:()=>{},collect:async()=>activity});
    await new Promise(r=>setImmediate(r));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).idle.blockers,['activity-unknown']); stop();
  }
});
test('async OAuth evidence is awaited once; shutdown cannot be overwritten by its late result', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-activity-oauth-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'status.json'),pending=deferred();let calls=0;
  const stop=startCloudStatus({config:{deviceId:'test',statusFile:file},read:()=>({auth:true}),
    readOauthIdentity:()=>{calls++;return pending.promise;},build,onFailure:()=>{},
    collect:()=>setup().reader.read(),intervalMs:2});
  await new Promise(r=>setTimeout(r,15));assert.equal(calls,1);assert.equal(fs.existsSync(file),false);
  stop();pending.resolve({public:'late'});await new Promise(r=>setImmediate(r));
  assert.equal(JSON.parse(fs.readFileSync(file)).phase,'stopping');assert.equal(calls,1);
});
