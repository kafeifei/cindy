import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { transformMaintenanceSource, cloudMaintenancePlugin, targets } from './overlay.mjs';
import { transformCloudActivitySource } from '../runtime-activity/overlay.mjs';
test('unrecognized/missing/duplicate ingress cannot silently qualify a build',()=>{
  assert.equal(transformMaintenanceSource('x','unrelated.ts'),null);
  for(const t of targets) assert.throws(()=>transformMaintenanceSource('',t));
  assert.throws(()=>cloudMaintenancePlugin({sourceRoot:'/test'}).buildEnd(null),/Missing/);
});
const source=process.env.CINDY_ACTIVITY_TEST_SOURCE;
test('cloud build rejects omitted or mismatched deployment regions before packaging',()=>{
  const config = region => ({define:{'import.meta.env.VITE_CINDY_AUTH_REGION':JSON.stringify(region)}});
  assert.throws(()=>cloudMaintenancePlugin({sourceRoot:'/test'}).configResolved(config('global')),/explicitly/);
  const plugin=cloudMaintenancePlugin({sourceRoot:'/test',expectedRegion:'cn'});
  assert.throws(()=>plugin.configResolved(config('global')),/must match/);
  assert.throws(()=>plugin.configResolved({define:{}}),/must match/);
  plugin.configResolved(config('cn'));
  cloudMaintenancePlugin({sourceRoot:'/test',expectedRegion:'global'}).configResolved(config('global'));
});
test('every actual cloud ingress transforms and compiles without editing client sources',{skip:!source},()=>{
  const require=createRequire(path.join(source,'package.json')),esbuild=require('esbuild');
  const plugin=cloudMaintenancePlugin({sourceRoot:source});
  for(const target of targets){
    const file=path.join(source,target),original=fs.readFileSync(file,'utf8');
    const activity=transformCloudActivitySource(original,target)??original;
    const result=plugin.transform(activity,file).code;
    esbuild.transformSync(result,{loader:'ts',format:'cjs'});
    assert.equal(fs.readFileSync(file,'utf8'),original);
    assert.throws(()=>transformMaintenanceSource(result,target),/twice/);
    if(target.endsWith('agent-input-coordinator.ts')){
      // Control steering bypasses steer(); it must pass the same new-input gate.
      const body=result.slice(result.indexOf('async steerControlInput('));
      assert.match(body.slice(0,body.indexOf('{',body.indexOf(')'))+80),/cloudMaintenance\.run\('agent-input', async \(\) => \{/);
    }
  }
  plugin.buildEnd(null);
});

test('quit chain faults and completion are wired exactly, and drift fails the build',()=>{
  const lifecycle='apps/desktop/src/main/lifecycle.ts';
  const excerpt=['log.warn(`sync disposer "${d.name}" returned a promise — not awaited`);','log.error(`sync disposer "${d.name}" threw`, err);',
    'log.error(`async disposer "${d.name}" threw`, err);','log.warn(`async disposers timed out after ${timeoutMs}ms — proceeding to post-async`);',
    'log.error(`post-async disposer "${d.name}" threw`, err),','log.error(`post-async disposer "${d.name}" threw`, err);',
    'log.warn(`post-async disposer "${d.name}" timed out after ${timeoutMs}ms — continuing`);',"log.error('runQuitDisposers threw', err);",
    "      log.info('runQuitDisposers completed');\n      noteQuitDisposersCompleted();\n"].join('\n');
  const out=transformMaintenanceSource(excerpt,lifecycle);
  assert.equal(out.split('cloudMaintenanceQuit.fault()').length-1,8);
  assert.equal(out.split('cloudMaintenanceQuit.completed(reason);').length-1,1);
  assert.ok(out.indexOf('cloudMaintenanceQuit.completed')>out.indexOf('noteQuitDisposersCompleted();'));
  assert.throws(()=>transformMaintenanceSource(excerpt.replace('— continuing','- continuing'),lifecycle),/quit integration changed/);
  assert.throws(()=>transformMaintenanceSource(excerpt.replace('noteQuitDisposersCompleted();',''),lifecycle),/completion changed/);
  assert.throws(()=>transformMaintenanceSource(out,lifecycle),/twice/);
});
