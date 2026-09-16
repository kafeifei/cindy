import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,pbkdf2Sync} from 'node:crypto';
import { app,safeStorage,net } from 'electron';
import {CindyAuthClient,serializeAuthSessionRecord,parseAuthSessionRecord} from '@cindy/auth-client';
import {createInstanceStore,atomicPrivateWrite,assertSecretService} from './store.js';
import {InstanceSession,type InstanceRecord} from './session.js';
import {importFrozenLegacyResourceCredential,seedLegacyResourceRecoveryProfile,prepareLegacyResourceRollback,verifyResourceCredentialHandoff} from './credential-migration.js';
import {createResourceClaimVerifier} from './profile-runtime-io.js';
import {createSandboxWitness} from './profile-telemetry.js';
import {readPreflightContext,PREFLIGHT_ROOT} from './profile-preflight-context.js';
const stages=['prepare','canonical','reverse','cold','recovery-cold','sandbox'] as const;
export function initializeProfilePreflight():boolean {
 if(!process.argv.includes('--cloud-profile-preflight-stage'))return false;
 readPreflightContext();
 if(process.argv.includes('--cloud-instance')||process.argv.includes('--no-sandbox')||process.env.ELECTRON_DISABLE_SANDBOX||process.env.CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE)throw new Error('PROFILE_PREFLIGHT_REJECTED');
 const userData=path.join(process.env.HOME!,'electron');fs.mkdirSync(userData,{recursive:true,mode:0o700});
 app.setPath('userData',userData);
 app.commandLine.appendSwitch('password-store','gnome-libsecret');app.commandLine.appendSwitch('disable-gpu');return true;
}
const digestTree=(directory:string):string=>{
 const walk=(d:string):unknown=>fs.readdirSync(d).sort().map(name=>{const f=path.join(d,name),s=fs.lstatSync(f);if(s.isSymbolicLink())throw new Error();return [name,s.mode&0o777,s.isDirectory()?walk(f):createHash('sha256').update(fs.readFileSync(f)).digest('hex')];});
 return createHash('sha256').update(JSON.stringify(walk(directory))).digest('hex');
};
const v10=(s:string)=>{const c=createCipheriv('aes-128-cbc',pbkdf2Sync('peanuts','saltysalt',1,16,'sha1'),Buffer.alloc(16,32));return Buffer.concat([Buffer.from('v10'),c.update(s),c.final()]);};
const keyNames=['cindy_auth_session_v1','cindy_pod_resource_refresh_token','cindy_pod_membership_id','cindy_auth_refresh_token'];
export async function runProfilePreflight():Promise<void> {
 try{
 const context=readPreflightContext();
 const stage=JSON.parse(fs.readFileSync(PREFLIGHT_ROOT+'/stage.json','utf8')).stage;
 if(!stages.includes(stage))throw new Error();
 const auth=JSON.parse(fs.readFileSync(PREFLIGHT_ROOT+'/auth.json','utf8'));
 const u=new URL(auth.identity.authBaseUrl);if(u.hostname!=='127.0.0.1'||u.protocol!=='http:')throw new Error();
 const identity={deviceId:'cloud-device-0123456789abcdef01234567',membershipId:'preflight-synthetic-member',realm:auth.identity.realm,authBaseUrl:u.origin};
 if(!['cn','global'].includes(identity.realm))throw new Error();
 await app.whenReady();assertSecretService(safeStorage);
 if(stage==='sandbox'){await createSandboxWitness();atomicPrivateWrite(PREFLIGHT_ROOT+'/stage-result.json',Buffer.from(JSON.stringify({stage})));return;}
 const source=PREFLIGHT_ROOT+'/source',candidate=PREFLIGHT_ROOT+'/candidate',recovery=PREFLIGHT_ROOT+'/recovery';
 const readLegacy=(d:string,k:string)=>safeStorage.decryptString(Buffer.from(fs.readFileSync(path.join(d,'safe-storage',k+'.enc'),'utf8'),'base64'));
 const stopped=()=>{
 // Synthetic source was created by this image in its private scratch PVC. It has
 // no source app process; preserve the frozen inode/hash on every library fence.
 readPreflightContext();if(fs.existsSync(PREFLIGHT_ROOT+'/source.sha256'))assert.equal(digestTree(source),fs.readFileSync(PREFLIGHT_ROOT+'/source.sha256','utf8'));
 };
 if(stage==='prepare'){
 for(const d of [source,candidate,recovery])fs.mkdirSync(d,{mode:0o700});
 fs.mkdirSync(source+'/safe-storage',{mode:0o700});
 const values=[serializeAuthSessionRecord(identity.realm,auth.initialRefreshToken),auth.initialRefreshToken,identity.membershipId,auth.initialRefreshToken];
 keyNames.forEach((k,i)=>fs.writeFileSync(source+'/safe-storage/'+k+'.enc',v10(values[i]).toString('base64'),{mode:0o400}));
 fs.writeFileSync(source+'/old-task-sentinel','synthetic-not-migrated',{mode:0o400});fs.chmodSync(source+'/safe-storage',0o500);fs.chmodSync(source,0o500);
 atomicPrivateWrite(PREFLIGHT_ROOT+'/source.sha256',Buffer.from(digestTree(source)));
 importFrozenLegacyResourceCredential({sourceUserDataDir:source,targetUserDataDir:candidate,identity,codec:safeStorage,assertSourceStopped:stopped});
 seedLegacyResourceRecoveryProfile({candidateUserDataDir:candidate,recoveryUserDataDir:recovery,identity,codec:safeStorage,assertSourceStopped:stopped});
 verifyResourceCredentialHandoff({action:'prepare-profile',sourceUserDataDir:source,candidateUserDataDir:candidate,targetUserDataDir:candidate,identity,codec:safeStorage});
 assert.deepEqual(fs.readdirSync(recovery),['safe-storage']);assert.deepEqual(fs.readdirSync(recovery+'/safe-storage').sort(),keyNames.map(k=>k+'.enc').sort());
 } else if(stage==='canonical'){
 const store=createInstanceStore(candidate,safeStorage);const client=new CindyAuthClient({baseUrl:identity.authBaseUrl,region:identity.realm,deviceId:identity.deviceId,clientType:'desktop',fetch:(u,o)=>net.fetch(u,{...o,redirect:'error'})});
 const verify=createResourceClaimVerifier((u,o)=>net.fetch(u,{...o,redirect:'error'}));
 const session=new InstanceSession({config:{...identity,authProtocol:'resource-v1',credentialSource:'canonical'},authBaseUrl:identity.authBaseUrl,store,
 readBootstrap:()=>{throw new Error('PREFLIGHT_B_MUST_NOT_BE_READ');},exchange:rt=>client.refresh(rt)});
 for(let i=0;i<2;i++){const pair=await session.rotate();assert.equal(session.observation(),null);await verify(pair.accessToken,identity);session.acknowledge(pair);assert.equal(session.observation()?.durableRefreshSequence,i+1);assert.equal((store.read() as InstanceRecord).refreshToken,pair.refreshToken);}
 const empty=PREFLIGHT_ROOT+'/empty';fs.mkdirSync(empty,{mode:0o700});let contacted=false;
 const missing=new InstanceSession({config:{...identity,authProtocol:'resource-v1',credentialSource:'canonical'},authBaseUrl:identity.authBaseUrl,store:createInstanceStore(empty,safeStorage),
 readBootstrap:()=>{throw new Error('PREFLIGHT_B_MUST_NOT_BE_READ');},exchange:async()=>{contacted=true;throw new Error();}});
 await assert.rejects(()=>missing.rotate(),/INSTANCE_CANONICAL_REQUIRED/);assert.equal(contacted,false);
 atomicPrivateWrite(PREFLIGHT_ROOT+'/canonical-observation.json',Buffer.from(JSON.stringify({sequence:session.observation()?.durableRefreshSequence})));
 }else if(stage==='reverse'){
 prepareLegacyResourceRollback({originalUserDataDir:source,candidateUserDataDir:candidate,rollbackUserDataDir:recovery,identity,codec:safeStorage,assertSourceStopped:stopped});
 verifyResourceCredentialHandoff({action:'prepare-recovery',sourceUserDataDir:source,candidateUserDataDir:candidate,targetUserDataDir:recovery,identity,codec:safeStorage});
 }else if(stage==='cold'){
 const canonical=createInstanceStore(candidate,safeStorage).read() as InstanceRecord;assert.ok(canonical?.refreshToken);
 assert.equal(fs.readFileSync(candidate+'/instance-credentials/session.bin').subarray(0,3).toString(),'v11');
 // After reverse, the exact latest RT is available through both HOME keyring clients.
 const session=parseAuthSessionRecord(readLegacy(recovery,keyNames[0]));assert.equal(session?.refreshToken,canonical.refreshToken);
 assert.equal(readLegacy(recovery,keyNames[1]),canonical.refreshToken);assert.equal(readLegacy(recovery,keyNames[3]),canonical.refreshToken);
 }else if(stage==='recovery-cold'){
 const expected=JSON.parse(fs.readFileSync(PREFLIGHT_ROOT+'/expected-recovery.json','utf8'));
 const session=parseAuthSessionRecord(readLegacy(recovery,keyNames[0]));assert.equal(session?.refreshToken,expected.refreshToken);
 for(const k of [keyNames[1],keyNames[3]])assert.equal(readLegacy(recovery,k),expected.refreshToken);
 for(const k of keyNames)assert.equal(Buffer.from(fs.readFileSync(recovery+'/safe-storage/'+k+'.enc','utf8'),'base64').subarray(0,3).toString(),'v11');
 }
 stopped();atomicPrivateWrite(PREFLIGHT_ROOT+'/stage-result.json',Buffer.from(JSON.stringify({stage,bindingSha256:context.bindingSha256})));app.quit();
 }catch{throw new Error('PROFILE_PREFLIGHT_STAGE_FAILED');}
}
