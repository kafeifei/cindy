#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { cdpPipe } from './cdp-pipe.mjs';
import { profileMount, observeSandbox, publishRuntimeEvidence, removeRuntimeEvidence, processObservation,
 telemetrySchema, profileObservationDiagnostic } from './profile-runtime-wire.mjs';
if(process.argv.length!==2||process.getuid()!==10001)process.exit(1);
let child,closing=false,buffer='',serial=0,lastInput=0,flight=false,lastFailure=null;
// Image-owned supervisor diagnostics contain fixed codes only. Failure still
// removes the proof; it never downgrades sandbox checks or writes a substitute.
const fail=(error,stage='lifecycle')=>{
 const diagnostic=profileObservationDiagnostic(error,stage);
 if(lastFailure!==diagnostic.code){process.stderr.write(JSON.stringify(diagnostic)+'\n');lastFailure=diagnostic.code;}
 try{removeRuntimeEvidence();}catch{child?.kill('SIGTERM');}
};
try{
 const mounted=profileMount();
 if(!mounted)throw new Error('PROFILE_MOUNT_REQUIRED');
 const candidate=mounted.role==='candidate';
 if(process.env.XDT_DEV_SAFE_STORAGE_BASIC==='1'||process.env.ELECTRON_DISABLE_SANDBOX)throw new Error('PROFILE_STORAGE_POLICY_REJECTED');
 if(!candidate){
   if(process.env.CINDY_POD_CREDENTIAL_SOURCE!=='canonical'||process.env.CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE||process.env.CINDY_POD_RESOURCE_REFRESH_TOKEN)throw new Error('PROFILE_RECOVERY_SOURCE_REJECTED');
   for(const key of ['cindy_auth_session_v1','cindy_pod_resource_refresh_token','cindy_pod_membership_id','cindy_auth_refresh_token']){
     const file='/var/lib/cindy/user-data/safe-storage/'+key+'.enc',st=fs.lstatSync(file);
     if(!st.isFile()||st.isSymbolicLink()||st.uid!==10001||st.nlink!==1||(st.mode&0o077)!==0)throw new Error('PROFILE_RECOVERY_SOURCE_REJECTED');
   }
 }
 child=spawn(candidate?'/opt/cindy/Cindy':'/opt/cindy-rollback/Cindy',
 candidate?['--cloud-instance','--password-store=gnome-libsecret','--remote-debugging-pipe']:
 ['--headless','--cloud-ui','--password-store=gnome-libsecret','--remote-debugging-pipe'],
 {env:candidate?process.env:{...process.env,
 CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE:'/run/cindy-profile/bootstrap-disabled',
 XDT_USER_DATA_DIR:'/var/lib/cindy/user-data',CINDY_CLOUD_STATUS_FILE:'/var/lib/cindy/status/status.json',
 CINDY_POD_WORKSPACES_DIR:'/var/lib/cindy/workspaces',XDT_ENDPOINT_MANIFEST_FILE:'/run/config/endpoint.json'},
 stdio:['ignore','inherit','inherit','pipe','pipe','pipe']});
 const bornAt=Date.now(),invoke=cdpPipe(child);fail();
 const watchdog=setInterval(()=>{if(Date.now()-lastInput>15000&&lastFailure===null)fail(undefined,'watchdog');},1000);
 const accept=async(raw,observedSerial)=>{
 if(flight)return;flight=true;let stage='telemetry';
 try{
 const value=telemetrySchema.parse(JSON.parse(raw));stage='binding';
 if(value.process.pid!==child.pid||value.profile!==mounted.profile||value.role!==mounted.role
 ||value.canonical.source!==(candidate?'canonical':'legacy-cindy-four-keys')||value.canonical.durableAtMs<bornAt
 ||value.heartbeatAtMs>Date.now()+1000||Date.now()-value.heartbeatAtMs>10000)throw 0;
 const proc=processObservation(child.pid);if(proc.startTicks!==value.process.startTicks)throw 0;
 stage='sandbox';const sandbox=await observeSandbox(invoke,child.pid);
 if(closing||serial!==observedSerial)throw 0;
 stage='publish';publishRuntimeEvidence({...value,sandbox});lastInput=Date.now();lastFailure=null;
 }catch(error){fail(error,stage);}finally{flight=false;}
 };
 child.stdio[5].on('data',chunk=>{
 buffer+=chunk.toString();if(Buffer.byteLength(buffer)>32768){fail();child.kill('SIGTERM');return;}
 let end;while((end=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);const version=++serial;
 if(raw==='{"unavailable":true}'){fail(undefined,'telemetry');continue;}void accept(raw,version);}
 });
 child.stdio[5].on('error',fail);child.stdio[5].on('end',fail);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closing=true;fail();child.kill(signal);});
 child.on('error',()=>{closing=true;clearInterval(watchdog);fail();process.exitCode=1;});
 child.on('exit',(code)=>{closing=true;clearInterval(watchdog);fail();process.exitCode=code===0?0:1;});
}catch{fail();process.exitCode=1;}
