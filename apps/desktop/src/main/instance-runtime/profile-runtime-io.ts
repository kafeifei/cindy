import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { atomicPrivateWrite } from './store.js';
import { runtimeEvidenceSchema, sandboxSchema } from './profile-runtime-contract.js';
export const PROFILE_STATUS='/var/lib/cindy/status/profile-verification.json';
export function processObservation(pid:number) {
 if(!Number.isSafeInteger(pid)||pid<1)throw new Error('PROFILE_PROCESS_REJECTED');
 const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
 const startTicks=Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]);
 const values=Object.fromEntries(fs.readFileSync(`/proc/${pid}/status`,'utf8').split('\n').filter(l=>l.includes(':')).map(l=>{
 const i=l.indexOf(':');return[l.slice(0,i),l.slice(i+1).trim()];}));
 return {pid,startTicks,seccomp:Number(values.Seccomp),filters:Number(values.Seccomp_filters),noNewPrivs:Number(values.NoNewPrivs),capEff:values.CapEff};
}
export function profileMount(mountinfo?:string):{profile:string;role:'candidate'|'recovery'}|null {
 if(mountinfo===undefined&&process.platform!=='linux')return null;
 mountinfo??=fs.readFileSync('/proc/self/mountinfo','utf8');
 const lines=mountinfo.split('\n').map(l=>l.split(' ')).filter(p=>p[4]==='/var/lib/cindy/user-data');
 if(lines.length===0)return null;
 if(lines.length!==1)throw new Error('PROFILE_MOUNT_REJECTED');
 const p=lines[0];if(!p[3].includes('/profiles/'))return null;
 const match=/\/profiles\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/(candidate|recovery)\/user-data$/.exec(p[3]);
 if(!match||!p[5].split(',').includes('rw'))throw new Error('PROFILE_MOUNT_REJECTED');
 return {profile:match[1],role:match[2] as 'candidate'|'recovery'};
}
export function removeRuntimeEvidence(file=PROFILE_STATUS):void {
 try {fs.unlinkSync(file);const fd=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('PROFILE_STATUS_REMOVE_FAILED');}
}
export function publishRuntimeEvidence(value:unknown,file=PROFILE_STATUS):void {
 const parsed=runtimeEvidenceSchema.parse(value);
 if(parsed.canonical.durableRefreshSequence<1||parsed.canonical.durableAtMs>parsed.heartbeatAtMs||parsed.canonical.expiresAtMs<=Date.now()
 ||parsed.canonical.sub!==parsed.membershipId||parsed.canonical.deviceId!==parsed.deviceId||parsed.process.pid!==parsed.sandbox.browser.pid
 ||parsed.process.startTicks!==parsed.sandbox.browser.startTicks)throw new Error('PROFILE_EVIDENCE_REJECTED');
 const bytes=Buffer.from(JSON.stringify(parsed));if(bytes.length>16384)throw new Error('PROFILE_EVIDENCE_REJECTED');
 atomicPrivateWrite(file,bytes);
}
export async function observeSandbox(invoke:(method:string,params?:Record<string,unknown>,sessionId?:string)=>Promise<any>,expectedPid?:number){
 const {processInfo}=await invoke('SystemInfo.getProcessInfo');
 const browsers=processInfo.filter((p:any)=>p.type==='browser');
 if(browsers.length!==1||(expectedPid!==undefined&&browsers[0].id!==expectedPid))throw new Error('PROFILE_BROWSER_REJECTED');
 const {targetInfos}=await invoke('Target.getTargets');
 const {SANDBOX_PAGE_URL,SANDBOX_PAGE_TEXT}=sandboxPage; // fixed page, never inspect a user's page
 const pages=targetInfos.filter((p:any)=>p.type==='page'&&p.url===SANDBOX_PAGE_URL);
 if(pages.length!==1)throw new Error('PROFILE_PAGE_REJECTED');
 const {sessionId}=await invoke('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true});
 try {
 const result=await invoke('Runtime.evaluate',{expression:'document.body.textContent',returnByValue:true},sessionId);
 if(result.exceptionDetails||result.result?.value!==SANDBOX_PAGE_TEXT)throw new Error('PROFILE_PAGE_REJECTED');
 } finally {await invoke('Target.detachFromTarget',{sessionId});}
 const renderers=processInfo.filter((p:any)=>p.type==='renderer').map((p:any)=>processObservation(p.id));
 return sandboxSchema.parse({browser:processObservation(browsers[0].id),renderers,rendererDiscovery:'cdp-system-info',pageReadback:'exact'});
}
import * as sandboxPage from './profile-runtime-contract.js';
export function createResourceClaimVerifier(fetcher:(url:string,init?:RequestInit)=>Promise<Response>=fetch,now=Date.now) {
 let cache:{at:number;issuer:string;keys:any[]}|null=null;
 return async(token:string,identity:{authBaseUrl:string;membershipId:string;deviceId:string})=>{
 try {
 const base=new URL(identity.authBaseUrl);
 if(base.username||base.password||base.search||base.hash||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','[::1]'].includes(base.hostname))))throw 0;
 const parts=token.split('.');if(token.length>16384||parts.length!==3||parts.some(p=>!/^[A-Za-z0-9_-]+$/.test(p)))throw 0;
 const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());
 if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>128||header.crit||header.jku||header.jwk||header.x5u)throw 0;
 const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
 if(claims.typ!=='access'||claims.aud!=='cindy'||claims.iss!==identity.authBaseUrl.replace(/\/$/,'')||claims.sub!==identity.membershipId||claims.device!==identity.deviceId||claims.accountControl!==false||claims.instance!==undefined||claims.generation!==undefined||!Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||claims.iat>now()/1000+30||claims.exp<=now()/1000||claims.exp<=claims.iat||(claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now()/1000)))throw 0;
 if(!cache||cache.issuer!==identity.authBaseUrl||now()-cache.at>300000||!cache.keys.some(k=>k.kid===header.kid)){
 const response=await fetcher(new URL('.well-known/jwks.json',identity.authBaseUrl.replace(/\/$/,'')+'/').href,{redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok||!response.body)throw 0;
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536)throw 0;chunks.push(value);}}finally{await reader.cancel();}
 const doc=JSON.parse(Buffer.concat(chunks).toString());if(!Array.isArray(doc.keys)||doc.keys.length<1||doc.keys.length>32)throw 0;
 cache={at:now(),issuer:identity.authBaseUrl,keys:doc.keys};
 }
 const keys=cache.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(k.alg===undefined||k.alg==='RS256')&&(k.use===undefined||k.use==='sig'));
 if(keys.length!==1||typeof keys[0].n!=='string'||Buffer.from(keys[0].n,'base64url').length<256)throw 0;
 const key=createPublicKey({key:keys[0],format:'jwk'});
 if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))throw 0;
 return {typ:'access' as const,aud:'cindy' as const,sub:identity.membershipId,deviceId:identity.deviceId,accountControl:false as const,expiresAtMs:claims.exp*1000};
 }catch{throw new Error('PROFILE_ACCESS_VERIFICATION_FAILED');}
 };
}
