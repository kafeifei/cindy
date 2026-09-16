import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, net, safeStorage } from 'electron';
import { SANDBOX_PAGE_URL, telemetrySchema } from './profile-runtime-contract.js';
import { createResourceClaimVerifier, processObservation, profileMount } from './profile-runtime-io.js';
import type { InstanceReadiness } from './status.js';

// Image-owned parent pipe only. No debug listener, IPC handler or token-bearing status file.
export function createSandboxWitness():Promise<BrowserWindow> {
 const w=new BrowserWindow({show:false,width:32,height:32,webPreferences:{partition:`profile-witness-${randomUUID()}`,
 sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,nodeIntegrationInWorker:false,
 webSecurity:true,allowRunningInsecureContent:false,experimentalFeatures:false,plugins:false,navigateOnDragDrop:false}});
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 w.webContents.on('will-navigate',e=>e.preventDefault());
 w.webContents.session.setPermissionRequestHandler((_w,_p,done)=>done(false));
 w.webContents.session.setPermissionCheckHandler(()=>false);
 w.webContents.session.on('will-download',e=>e.preventDefault());
 return w.loadURL(SANDBOX_PAGE_URL).then(()=>w,()=>{w.destroy();throw new Error('PROFILE_WITNESS_FAILED');});
}
export type DurableObservation={accessToken:string;authBaseUrl:string;durableRefreshSequence:number;durableAtMs:number};
export function startProfileTelemetry(input:{deviceId:string;membershipId:string;realm(): 'cn'|'global'|null;
 read():InstanceReadiness; readAuth():DurableObservation|null; onFailure():void}):()=>void {
 const mounted=profileMount();if(!mounted)return()=>{};
 if(process.getuid?.()!==10001)throw new Error('PROFILE_TELEMETRY_IDENTITY_REJECTED');
 const fd=fs.fstatSync(5);if(!fd.isFIFO()&&!fd.isSocket())throw new Error('PROFILE_TELEMETRY_PIPE_REQUIRED');
 const sessionId=randomUUID();let stopped=false;let flight=false;let witness:BrowserWindow|null=null;
 const verify=createResourceClaimVerifier((url,init)=>net.fetch(url,{...init,redirect:'error'}));
 const unavailable=()=>{try{fs.writeSync(5,'{"unavailable":true}\n');}catch{input.onFailure();}};
 const ready=()=>Object.values(input.read()).every(v=>v===true);
 const tick=async()=>{
 if(stopped||flight)return;flight=true;
 try{
 const auth=input.readAuth();const realm=input.realm();
 if(!auth||!realm||!ready()||safeStorage.getSelectedStorageBackend()!=='gnome_libsecret')throw new Error();
 if(!witness||witness.isDestroyed())witness=await createSandboxWitness();
 const claims=await verify(auth.accessToken,{...input,authBaseUrl:auth.authBaseUrl});
 const latest=input.readAuth();
 if(stopped||!ready()||!latest||latest.accessToken!==auth.accessToken||latest.durableRefreshSequence!==auth.durableRefreshSequence)throw new Error();
 const proc=processObservation(process.pid);
 const message=telemetrySchema.parse({version:1,...mounted,deviceId:input.deviceId,membershipId:input.membershipId,
 realm,authBaseUrl:auth.authBaseUrl,heartbeatAtMs:Date.now(),process:{pid:proc.pid,startTicks:proc.startTicks},
 canonical:{source:mounted.role==='candidate'?'canonical':'legacy-cindy-four-keys',backend:'gnome-libsecret',sessionId,
 durableRefreshSequence:auth.durableRefreshSequence,durableAtMs:auth.durableAtMs,...claims},
 readiness:{auth:'ready',database:'ready',binaries:'ready',maker:'ready',deviceLink:'ready'}});
 fs.writeSync(5,JSON.stringify(message)+'\n');
 }catch{unavailable();}finally{flight=false;}
 };
 const timer=setInterval(()=>void tick(),5000);timer.unref();void tick();
 return()=>{stopped=true;clearInterval(timer);unavailable();witness?.destroy();};
}
