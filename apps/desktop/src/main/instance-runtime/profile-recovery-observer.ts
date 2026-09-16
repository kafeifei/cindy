import fs from 'node:fs';
import path from 'node:path';
import {app} from 'electron';
import {parseAuthSessionRecord,type AuthTokenPair,type AuthRegion} from '@cindy/auth-client';
import {profileMount} from './profile-runtime-io.js';
import {startProfileTelemetry,type DurableObservation} from './profile-telemetry.js';
let durable:DurableObservation|null=null,sequence=0,started=false;
let readiness:{at:number;values:Record<string,string>}|null=null;
let currentToken:(()=>string|null)|null=null;
export function noteRecoveryReadiness(status:{heartbeatAtMs:number;readiness:Record<string,string>}):void {
 if(profileMount()?.role==='recovery')readiness={at:status.heartbeatAtMs,values:status.readiness};
}
export function noteRecoveryRefresh(input:{pair:AuthTokenPair;requestedRefreshToken:string;realm:AuthRegion;authBaseUrl:string;deviceId:string;
 readSecret(key:string):string|null;readAccessToken():string|null;onFailure():void}):void {
 if(profileMount()?.role!=='recovery')return;
 try{
 const {pair}=input;
 if(pair.refreshToken===input.requestedRefreshToken)throw new Error();
 const names=['cindy_auth_session_v1','cindy_pod_resource_refresh_token','cindy_pod_membership_id','cindy_auth_refresh_token'];
 const session=parseAuthSessionRecord(input.readSecret(names[0]));
 if(session?.realm!==input.realm||session.refreshToken!==pair.refreshToken||input.readSecret(names[1])!==pair.refreshToken||input.readSecret(names[2])!==pair.membership.id||input.readSecret(names[3])!==pair.refreshToken)throw new Error();
 const dir=path.join(app.getPath('userData'),'safe-storage');
 const ds=fs.lstatSync(dir);if(!ds.isDirectory()||ds.isSymbolicLink()||ds.uid!==10001||(ds.mode&0o077)!==0)throw new Error();
 for(const name of names){
 const fd=fs.openSync(path.join(dir,name+'.enc'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==10001||(s.mode&0o077)!==0||s.size>1048576)throw new Error();
 const bytes=Buffer.from(fs.readFileSync(fd,'utf8'),'base64');if(bytes.subarray(0,3).toString()!=='v11')throw new Error();fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 }
 const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 durable={accessToken:pair.accessToken,authBaseUrl:input.authBaseUrl,durableRefreshSequence:++sequence,durableAtMs:Date.now()};
 currentToken=input.readAccessToken;
 if(!started){
 const stop=startProfileTelemetry({deviceId:input.deviceId,membershipId:pair.membership.id,realm:()=>input.realm,
 read:()=>{const healthy=!!readiness&&Date.now()-readiness.at<15000;const ready=(k:string)=>healthy&&readiness!.values[k]==='ready';
 return{auth:ready('auth'),database:ready('database'),binaries:ready('binaries'),maker:ready('maker'),deviceLink:ready('deviceLink')};},
 readAuth:()=>durable&&currentToken?.()===durable.accessToken?durable:null,onFailure:input.onFailure});
 started=true;app.once('will-quit',stop);
 }
 }catch{durable=null;input.onFailure();}
}
