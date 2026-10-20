#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,generateKeyPairSync,sign,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {cdpPipe} from './cdp-pipe.mjs';
import {readPreflightContext,PREFLIGHT_ROOT,observeSandbox,preflightEvidenceSchema} from './profile-runtime-wire.mjs';
if(process.argv.length!==2)process.exit(1);
let server,active=null,ownsScratch=false;const root=PREFLIGHT_ROOT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const privateWrite=(file,value)=>{const fd=fs.openSync(file,'w',0o600);try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const waitFile=async(file,child,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(fs.existsSync(file))return;if(child.exitCode!==null||child.signalCode)throw new Error('PREFLIGHT_STAGE_EXITED');await sleep(50);}throw new Error('PREFLIGHT_STAGE_TIMEOUT');};
async function stop(child){if(child.exitCode!==null||child.signalCode)return;child.kill('SIGTERM');for(let i=0;i<60;i++){if(child.exitCode!==null||child.signalCode)return;await sleep(50);}child.kill('SIGKILL');throw new Error('PREFLIGHT_UNCLEAN_STOP');}
const envFor=home=>({...process.env,HOME:home,CINDY_POD_KEYRING_PASSWORD_FILE:root+'/key',CINDY_POD_AUTH_PROTOCOL:'resource-v1'});
async function stage(name,home,{wrongKey=false,sandbox=false}={}){
 process.stdout.write('PROFILE_PREFLIGHT_STAGE '+name+(wrongKey?' wrong-key':'')+'\n');
 const result=root+'/stage-result.json';fs.rmSync(result,{force:true});privateWrite(root+'/stage.json',JSON.stringify({stage:name}));
 const child=spawn('/usr/local/bin/cindy-linux-desktop',['/opt/cindy/Cindy','--cloud-profile-preflight-stage',...(sandbox?['--remote-debugging-pipe']:[])],
 {env:envFor(home),stdio:['ignore','ignore','pipe',...(sandbox?['pipe','pipe']:[])]});active=child;
 let diagnostic='';child.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-8192);});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const timeout=setTimeout(()=>child.kill('SIGTERM'),45000);
 try{
 if(sandbox){const invoke=cdpPipe(child);await waitFile(result,child);const evidence=await observeSandbox(invoke);await stop(child);return evidence;}
 const {code,signal}=await exited;if(signal)throw new Error('PREFLIGHT_STAGE_INTERRUPTED');
 if(wrongKey){if(code===0||fs.existsSync(result))throw new Error('PREFLIGHT_WRONG_KEY_ACCEPTED');return;}
 if(code!==0||!fs.existsSync(result)||JSON.parse(fs.readFileSync(result,'utf8')).stage!==name){
 process.stderr.write(diagnostic.split('\n').filter(l=>/PROFILE_|INSTANCE_|\[cindy\] fatal/.test(l)).join('\n')+'\n');
 throw new Error('PREFLIGHT_STAGE_FAILED');}
 }finally{clearTimeout(timeout);if(child.exitCode===null&&!child.signalCode)await stop(child);active=null;}
}
async function main(){
 if(spawnSync('unshare',['--propagation=unchanged','-Urmpfn','true'],{stdio:'ignore',timeout:5000}).status!==0)throw new Error('PREFLIGHT_SANDBOX_UNAVAILABLE');
 const context=readPreflightContext();
 if(fs.existsSync(root))throw new Error('PREFLIGHT_SCRATCH_NOT_EMPTY');fs.mkdirSync(root,{mode:0o700});ownsScratch=true;
 const homes=[root+'/home-a',root+'/home-b'];fs.mkdirSync(root+'/keyrings',{mode:0o700});
 for(const home of homes){fs.mkdirSync(home+'/.local/share',{mode:0o700,recursive:true});fs.symlinkSync(root+'/keyrings',home+'/.local/share/keyrings');}
 const password=randomBytes(32).toString('base64url');privateWrite(root+'/key',password);
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const kid=randomUUID();
 let current=randomUUID(),rotations=0,bad=false;const initial=current;
 const identity={deviceId:'cloud-device-0123456789abcdef01234567',membershipId:'preflight-synthetic-member',realm:JSON.parse(fs.readFileSync('/usr/local/lib/cindy/profile-image.json','utf8')).realm};
 server=createServer(async(req,res)=>{
 try{
 if(req.url==='/.well-known/jwks.json'&&req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'}]}));return;}
 if(req.url!=='/api/auth/refresh'||req.method!=='POST'){res.writeHead(503).end('{"error":{"code":"PREFLIGHT_SERVICE_NOT_PRESENT","message":"Synthetic preflight"}}');return;}
 let body='';for await(const c of req){body+=c;if(body.length>8192)throw 0;}const request=JSON.parse(body);
 if(request.refreshToken!==current||request.deviceId!==identity.deviceId)throw 0;
 current=randomUUID();rotations++;const now=Math.floor(Date.now()/1000);
 const claims={typ:'access',aud:'cindy',iss:identity.authBaseUrl,sub:identity.membershipId,device:identity.deviceId,accountControl:false,iat:now,exp:now+305,ctx:'personal',passport:'preflight-synthetic-passport'};
 const encoded=Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
 const accessToken=encoded+'.'+sign('RSA-SHA256',Buffer.from(encoded),privateKey).toString('base64url');
 res.setHeader('content-type','application/json');res.end(JSON.stringify({accessToken,refreshToken:current,membership:{id:identity.membershipId,kind:'personal',role:'member',displayName:'Synthetic preflight',email:null,orgId:null,orgName:null,passportId:'preflight-synthetic-passport'}}));
 }catch{bad=true;res.writeHead(400).end('{"error":{"code":"PREFLIGHT_AUTH_REJECTED","message":"Synthetic preflight"}}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));identity.authBaseUrl=`http://127.0.0.1:${server.address().port}`;
 privateWrite(root+'/auth.json',JSON.stringify({identity,initialRefreshToken:initial}));
 await stage('prepare',homes[0]);await stage('canonical',homes[1]);if(rotations!==2||bad)throw new Error('PREFLIGHT_REFRESH_FAILED');
 await stage('reverse',homes[0]);await stage('cold',homes[1]);
 privateWrite(root+'/key',randomBytes(32).toString('base64url'));await stage('cold',homes[0],{wrongKey:true});
 privateWrite(root+'/key',password);await stage('cold',homes[1]);
 let recoveryCycles=0;
 if(context.role==='recovery'){
 const manifest=JSON.parse(fs.readFileSync('/usr/local/lib/cindy/profile-image.json','utf8'));
 if(!manifest.recoveryAsarSha256||createHash('sha256').update(fs.readFileSync('/opt/cindy-rollback/resources/app.asar')).digest('hex')!==manifest.recoveryAsarSha256)throw new Error('PREFLIGHT_RECOVERY_IMAGE_REQUIRED');
 const endpoint=JSON.parse(fs.readFileSync('/usr/local/lib/cindy/profile-endpoint-template.json','utf8'));
 for(const [k,v]of Object.entries(endpoint))if(typeof v==='string'&&/^(https?|wss?):/.test(v))endpoint[k]=/^wss?:/.test(v)?identity.authBaseUrl.replace('http:','ws:'):identity.authBaseUrl;
 privateWrite(root+'/endpoint.json',JSON.stringify(endpoint));
 // An inert B is required by the original CLI config only. It must never be used:
 // the synthetic Auth only accepts the latest RT imported in the four v11 keys.
 privateWrite(root+'/inert-bootstrap',randomUUID());fs.mkdirSync(root+'/workspaces',{mode:0o700});
 const start=rotations;const child=spawn('/usr/local/bin/cindy-linux-desktop',['/opt/cindy-rollback/Cindy','--headless','--cloud-ui','--password-store=gnome-libsecret'],{
 env:{...envFor(homes[0]),CINDY_POD_DEVICE_ID:identity.deviceId,CINDY_POD_MEMBERSHIP_ID:identity.membershipId,CINDY_POD_DEVICE_NAME:'Synthetic preflight',
 CINDY_POD_RESOURCE_REFRESH_TOKEN_FILE:root+'/inert-bootstrap',XDT_USER_DATA_DIR:root+'/recovery',XDT_ENDPOINT_MANIFEST_FILE:root+'/endpoint.json',
 CINDY_POD_WORKSPACES_DIR:root+'/workspaces',CINDY_CLOUD_STATUS_FILE:root+'/legacy-status.json'},stdio:'ignore'});active=child;
 const deadline=Date.now()+45000;let accepted=false;
 while(Date.now()<deadline&&child.exitCode===null&&!child.signalCode&&!bad){
 try{const status=JSON.parse(fs.readFileSync(root+'/legacy-status.json','utf8'));if(status.readiness.auth==='ready'&&rotations-start>=2){accepted=true;break;}}catch{}
 await sleep(100);
 }
 await stop(child);active=null;if(!accepted||bad)throw new Error('PREFLIGHT_RECOVERY_AUTH_FAILED');recoveryCycles=rotations-start;
 privateWrite(root+'/expected-recovery.json',JSON.stringify({refreshToken:current}));await stage('recovery-cold',homes[1]);
 }
 const sandbox=await stage('sandbox',homes[0],{sandbox:true});
 const checks=context.role==='candidate'?{canonicalWithoutB:true,missingCanonicalRejected:true,wrongKeyRejected:true,sharedKeyringAcrossHomes:true}:
 context.role==='maintenance'?{latestDurableForward:true,latestCanonicalReverse:true,sourceUnchanged:true,cindyOnlyRecovery:true,wrongKeyRejected:true}:
 {legacyAsarWithSecureWrapper:true,currentResourceAccepted:true,refreshCycles:recoveryCycles,sharedKeyringAcrossHomes:true};
 const proof=preflightEvidenceSchema.parse({version:1,role:context.role,bindingSha256:context.bindingSha256,podUid:context.podUid,
 observedAtMs:Date.now(),architecture:process.arch==='arm64'?'arm64':process.arch==='x64'?'amd64':'invalid',sandbox,checks});
 const bytes=JSON.stringify(proof);if(Buffer.byteLength(bytes)>4096)throw new Error('PREFLIGHT_RECEIPT_TOO_LARGE');
 // Termination metadata is written only after every owned child has exited.
 privateWrite('/preflight/receipt.json',bytes);fs.writeFileSync('/dev/termination-log',bytes);
 process.stdout.write('PROFILE_PREFLIGHT_PASSED\n');
}
try{await main();}catch{process.stderr.write('PROFILE_PREFLIGHT_FAILED\n');process.exitCode=1;}
finally{
 if(active)try{await stop(active);}catch{process.exitCode=1;}
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 const unlock=d=>{if(!fs.existsSync(d))return;for(const n of fs.readdirSync(d)){const f=path.join(d,n),s=fs.lstatSync(f);if(s.isDirectory()){fs.chmodSync(f,0o700);unlock(f);}}};
 if(ownsScratch)try{unlock(root);fs.rmSync(root,{recursive:true,force:true});}catch{process.exitCode=1;fs.rmSync('/preflight/receipt.json',{force:true});fs.writeFileSync('/dev/termination-log','');}
}
