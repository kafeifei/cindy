import fs from 'node:fs';
import { preflightBindingSchema,evidenceDigest } from './profile-runtime-contract.js';
export const PREFLIGHT_ROOT='/preflight/run';
export function readPreflightContext() {
 try{
 if(process.getuid?.()!==10001||!['candidate','maintenance','recovery'].includes(process.env.CINDY_PROFILE_PREFLIGHT_ROLE??'')||(process.env.CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE&&!(process.env.CINDY_PROFILE_PREFLIGHT_ROLE==='recovery'&&process.env.CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE==='/preflight/run/inert-bootstrap'))||fs.existsSync('/run/secrets/credential-store-key')||fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token'))throw 0;
 const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').map(l=>l.split(' '));
 for(const target of ['/run/cindy-profile-check/profile-preflight.json','/run/cindy-profile-check/identity']){
 const match=mounts.filter(p=>p[4]===target);if(match.length!==1||!match[0][5].split(',').includes('ro'))throw 0;
 }
 const scratch=mounts.filter(p=>p[4]==='/preflight');if(scratch.length!==1||!scratch[0][5].split(',').includes('rw'))throw 0;
 // CIS additionally verifies this is an independent CSI PVC of the same class.
 // This image never accepts a mounted real profile, key, bootstrap, or SA token.
 if(mounts.some(p=>p[4]==='/var/lib/cindy/user-data'||p[4]?.startsWith('/migration/')))throw 0;
 const input='/run/cindy-profile-check/profile-preflight.json';
 const s=fs.statSync(input);if(!s.isFile()||s.size>4096||s.uid!==0||(s.mode&0o022)!==0)throw 0;
 const binding=preflightBindingSchema.parse(JSON.parse(fs.readFileSync(input,'utf8')));
 const podUid=fs.readFileSync('/run/cindy-profile-check/identity/pod-uid','utf8');if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(podUid))throw 0;
 return {binding,podUid,bindingSha256:evidenceDigest(binding),role:process.env.CINDY_PROFILE_PREFLIGHT_ROLE as 'candidate'|'maintenance'|'recovery'};
 }catch{throw new Error('PROFILE_PREFLIGHT_BINDING_REJECTED');}
}
