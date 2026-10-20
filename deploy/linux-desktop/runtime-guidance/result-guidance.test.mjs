import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cloudSettingsResultGuidance, withCloudSettingsResult } from './result-guidance.mjs';
import { transformCloudSource } from './overlay.mjs';
const sourceRoot=process.env.CINDY_TEST_CLIENT_SOURCE;
assert.ok(sourceRoot && path.isAbsolute(sourceRoot));
const ts=createRequire(path.join(sourceRoot,'package.json'))('typescript');
class HostSettingsError extends Error { constructor(code){super(code);this.code=code;} }
function helper({cloud=true,update=async()=>{},read=async()=>{},operation=()=>{},captureError}={}) {
 const original=fs.readFileSync(path.join(sourceRoot,'apps/desktop/src/main/host-settings/helper.ts'),'utf8');
 const code=transformCloudSource(original,'apps/desktop/src/main/host-settings/helper.ts');
 const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const dependencies={
  'virtual:cindy-cloud-settings-guidance':{withCloudSettingsResult},
  '../instance-runtime/config.js':{getInstanceConfig:()=>cloud?{}:null},
  './index.js':{HostSettingsError,HOST_SETTINGS_CATALOG:[],getHostSettings:read,getHostSettingsOperation:operation,updateHostSettings:update},
  '../../shared/hostSettings.js':{isHostSettingsDomain:d=>['terminal','personalization','imWorkspaces','imWorkspaceProviders','notifications'].includes(d)},
  './catalog.js':{refreshSettingsModelRecommendation:async()=>{}},
 };
 const exports={};new Function('exports','require',js)(exports,n=>{assert.ok(n in dependencies,n);return dependencies[n];});
 const caller={id:'test-owner:task-generation',assertCurrent(){},confirm(){throw Error('decorator must never confirm');}};
 exports.configureHostSettingsCaller(async()=>{if(captureError)throw captureError;return caller;});
 return {call:exports.hostSettingsHelper.call,allowed:exports.hostSettingsHelper.allowed,caller};
}
const receipt=(code)=>({operationId:'original-operation',domain:'terminal',status:'rejected',saved:false,application:'not_applied',code});
test('actual transformed helper keeps original arguments and waits for the real decision; no retry',async()=>{
 let release,calls=0,done=false;
 const h=helper({update:async(c,a)=>{calls++;assert.equal(c,h.caller);assert.deepEqual(a,{domain:'terminal',workspaceId:undefined,operationId:'original-operation',expectedRevision:'revision',set:{defaultShellPref:'bash'},clear:undefined});return new Promise(r=>release=r);}});
 const pending=h.call({},'update_settings',{domain:'terminal',operation_id:'original-operation',expected_revision:'revision',set:{defaultShellPref:'bash'}}).then(v=>{done=true;return v;});
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(done,false);
 release(receipt('CONFIRMATION_REQUIRED'));const v=await pending;
 assert.equal(calls,1);assert.deepEqual(v.receipt,receipt('CONFIRMATION_REQUIRED'));assert.equal(v.ok,false);assert.equal(v.cloudSettingsGuidance.confirmationPending,false);assert.equal(v.cloudSettingsGuidance.originalOperationId,'original-operation');
});
test('actual helper authorisation failure remains a failure and never runs update',async()=>{
 let calls=0;const h=helper({captureError:new HostSettingsError('SETTINGS_NOT_ALLOWED'),update:async()=>calls++});
 assert.equal(await h.allowed({}),false);assert.deepEqual(await h.call({},'update_settings',{domain:'terminal'}),{ok:false,errorCode:'SETTINGS_NOT_ALLOWED'});assert.equal(calls,0);
});
test('non-cloud results retain object identity and contents',async()=>{
 const result={ok:false,receipt:receipt('CONFLICT')};assert.equal(cloudSettingsResultGuidance('update_settings',{},result,false),result);
 const h=helper({cloud:false,update:async()=>result.receipt});assert.deepEqual(await h.call({},'update_settings',{domain:'terminal'}),result);
});
test('conflict remains rejected regardless of current target value and forbids retry promise',async()=>{
 const h=helper({update:async()=>receipt('CONFLICT')});const v=await h.call({},'update_settings',{domain:'terminal'});
 assert.equal(v.receipt.saved,false);assert.equal(v.cloudSettingsGuidance.state,'finished_not_saved');assert.match(v.cloudSettingsGuidance.explanation,/do not resubmit, promise a retry or overwrite/i);assert.match(v.cloudSettingsGuidance.explanation,/does not mean this operation succeeded/);
});
test('disclosure cancellation does not disclose, read again, or fabricate a pending card',async()=>{
 let reads=0;const h=helper({read:async()=>{reads++;throw new HostSettingsError('CONFIRMATION_REQUIRED');}});
 const v=await h.call({},'get_settings',{domain:'personalization',include_user_prompt:true});assert.equal(reads,1);assert.equal(v.errorCode,'CONFIRMATION_REQUIRED');assert.equal(v.settings,undefined);assert.equal(v.cloudSettingsGuidance.bodyReturned,false);assert.equal(v.cloudSettingsGuidance.confirmationPending,false);assert.equal(v.cloudSettingsGuidance.bodyIsEmpty,null);assert.equal(v.cloudSettingsGuidance.bodyLength,null);assert.match(v.cloudSettingsGuidance.responseMeaning,/cannot be determined/);
});
test('metadata describes only the present; body and history stay unknown',async()=>{
 const settings={status:'ready',value:{isCustomized:false},customizedKeys:[],operationId:'next-read-id'};
 const h=helper({read:async()=>settings});const v=await h.call({},'get_settings',{domain:'personalization'});
 assert.equal(v.settings,settings);assert.equal(v.cloudSettingsGuidance.historyKnown,false);assert.equal(v.cloudSettingsGuidance.bodyReturned,false);assert.match(v.cloudSettingsGuidance.explanation,/never configured\/saved/);assert.deepEqual(settings.value,{isCustomized:false});assert.equal(v.cloudSettingsGuidance.bodyIsEmpty,null);assert.equal(v.cloudSettingsGuidance.bodyLength,null);assert.match(v.cloudSettingsGuidance.responseMeaning,/cannot be determined/);
});
test('approved body is not classified as metadata and is never copied into guidance',async()=>{
 const settings={status:'ready',value:{userPrompt:'fixture-secret-body'}};const h=helper({read:async()=>settings});const v=await h.call({},'get_settings',{domain:'personalization',include_user_prompt:true});assert.deepEqual(v,{ok:true,settings});
});
test('saved next-task receipt retains deferred application and original operation',async()=>{
 const saved={operationId:'written-id',domain:'terminal',status:'saved',saved:true,application:'next_task',revision:'new'};
 const h=helper({operation:()=>saved});const v=await h.call({},'get_settings_operation',{operation_id:'written-id'});assert.equal(v.operation,saved);assert.equal(v.cloudSettingsGuidance.originalOperationId,'written-id');assert.equal(v.operation.application,'next_task');
});
test('unknown and pending are not converted into rejected or saved receipts',()=>{
 for(const status of ['unknown','pending']){const original={ok:true,operation:{status}};const v=cloudSettingsResultGuidance('get_settings_operation',{operation_id:'old'},original,true);assert.equal(v.operation,original.operation);assert.equal(v.cloudSettingsGuidance.state,status);assert.equal(v.cloudSettingsGuidance.originalOperationId,'old');assert.equal(v.cloudSettingsGuidance.confirmationPending,undefined);}
});
test('helper anchor drift and duplicate overlay fail the build',()=>{
 const p='apps/desktop/src/main/host-settings/helper.ts',text=fs.readFileSync(path.join(sourceRoot,p),'utf8');assert.throws(()=>transformCloudSource(text.replace('call: async','call: function'),p));assert.throws(()=>transformCloudSource(transformCloudSource(text,p),p));
});
for (const domain of ['imWorkspaces', 'imWorkspaceProviders']) {
 test(`${domain}: unavailable read preserves evidence without inventing its cause or writing`, async()=>{
  const settings=Object.freeze({status:'unavailable',revision:null});let reads=0,writes=0;
  const h=helper({read:async(c,d,includeBody,workspace)=>{reads++;assert.equal(c,h.caller);assert.equal(d,domain);assert.equal(includeBody,false);assert.equal(workspace,undefined);return settings;},update:async()=>{writes++;throw Error('unexpected write');}});
  const v=await h.call({},'get_settings',{domain});
  assert.equal(reads,1);assert.equal(writes,0);assert.equal(v.ok,true);assert.equal(v.settings,settings);
  assert.equal(v.cloudSettingsGuidance.state,'im_preferences_unavailable');
  assert.equal(v.cloudSettingsGuidance.directoryInventoryKnown,false);assert.equal(v.cloudSettingsGuidance.bindingStateKnown,false);assert.equal(v.cloudSettingsGuidance.serviceConfigurationKnown,false);
  assert.match(v.cloudSettingsGuidance.explanation,/cannot create, rename, change a path or remove directories/);
  assert.match(v.cloudSettingsGuidance.next,/Do not infer different machines/);assert.match(v.cloudSettingsGuidance.next,/do not invent name\/path fields/);
 });
 test(`${domain}: ready historical preferences are retained but not called a bound directory inventory`,async()=>{
  const entry=domain==='imWorkspaces'?{workspaceId:'historical-key',harness:'codex',modelId:'example-model',effort:null,permissionMode:null}:{workspaceId:'historical-key',providerId:'example-provider'};
  const settings={status:'ready',revision:'revision',value:{entries:[entry]},choices:{entries:[{value:{workspaceId:'historical-key'},label:'Past workspace · Slack'}]},customizedKeys:['entries'],isCustomized:true};
  const before=structuredClone(settings),h=helper({read:async()=>settings});
  const v=await h.call({},'get_settings',{domain});assert.equal(v.settings,settings);assert.deepEqual(settings,before);
  assert.equal(v.cloudSettingsGuidance.state,'im_preferences_only');assert.equal(v.cloudSettingsGuidance.bindingStateKnown,false);assert.equal(v.cloudSettingsGuidance.directoryInventoryKnown,false);
  assert.match(v.cloudSettingsGuidance.explanation,/choices can include historical entries/);
  assert.match(v.cloudSettingsGuidance.next,/exact channel\/team\/workspace identity/);
 });
 test(`${domain}: no cloud guidance on non-cloud instances or failed authorization`,async()=>{
  const settings={status:'unavailable',revision:null};
  assert.deepEqual(await helper({cloud:false,read:async()=>settings}).call({},'get_settings',{domain}),{ok:true,settings});
  let reads=0;const h=helper({captureError:new HostSettingsError('SETTINGS_NOT_ALLOWED'),read:async()=>reads++});
  assert.deepEqual(await h.call({},'get_settings',{domain}),{ok:false,errorCode:'SETTINGS_NOT_ALLOWED'});assert.equal(reads,0);
 });
}
test('unavailable generic domain is not a diagnosis; malformed and unrelated results are unchanged',async()=>{
 const settings={status:'unavailable',revision:null};const h=helper({read:async()=>settings});
 const v=await h.call({},'get_settings',{domain:'notifications'});assert.equal(v.settings,settings);assert.equal(v.cloudSettingsGuidance.causeKnown,false);
 for(const result of [null,[],{ok:false,errorCode:'SETTINGS_FAILED'},{ok:true,settings:{status:'invalid'}}]){
  assert.equal(cloudSettingsResultGuidance('get_settings',{domain:'imWorkspaces'},result,true),result);
 }
 const catalog={ok:true,catalog:[]};assert.equal(cloudSettingsResultGuidance('list_settings',{},catalog,true),catalog);
});
