import {describe,it,expect,vi,beforeEach} from 'vitest';
const h=vi.hoisted(()=>({role:'recovery' as string|null,failFsync:false,reads:new Map<string,string>(),writes:[] as string[],telemetry:null as any}));
vi.mock('electron',()=>({app:{getPath:()=>'/profile',once:vi.fn()}}));
vi.mock('../profile-runtime-io.js',()=>({profileMount:()=>h.role?{role:h.role,profile:'fixture-revision'}:null}));
vi.mock('../profile-telemetry.js',()=>({startProfileTelemetry:(input:any)=>{h.telemetry=input;return()=>{};}}));
vi.mock('node:fs',()=>({default:{lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:10001,mode:0o700}),
 constants:{O_RDONLY:0,O_NOFOLLOW:1},openSync:(p:string)=>{h.writes.push(p);return 42;},
 fstatSync:()=>({isFile:()=>true,nlink:1,uid:10001,mode:0o600,size:8}),readFileSync:()=>Buffer.from('v11synthetic').toString('base64'),
 fsyncSync:()=>{if(h.failFsync)throw new Error('fsync');},closeSync:vi.fn()}}));
import {noteRecoveryRefresh,noteRecoveryReadiness} from '../profile-recovery-observer.js';
import {serializeAuthSessionRecord,type AuthTokenPair} from '@cindy/auth-client';
const pair={accessToken:'synthetic-internal-only',refreshToken:'00000000-0000-4000-8000-000000000002',membership:{id:'fixture-member'}} as AuthTokenPair;
function input(){return{pair,requestedRefreshToken:'00000000-0000-4000-8000-000000000001',realm:'cn' as const,
 authBaseUrl:'https://auth.test.invalid',deviceId:'cloud-device-0123456789abcdef01234567',readSecret:(k:string)=>h.reads.get(k)??null,
 readAccessToken:()=>pair.accessToken,onFailure:vi.fn()};}
beforeEach(()=>{h.role='recovery';h.failFsync=false;h.writes=[];h.reads=new Map([
 ['cindy_auth_session_v1',serializeAuthSessionRecord('cn',pair.refreshToken)],['cindy_pod_resource_refresh_token',pair.refreshToken],
 ['cindy_pod_membership_id',pair.membership.id],['cindy_auth_refresh_token',pair.refreshToken]]);});
describe('legacy refresh observation, separate from the original auth transaction',()=>{
 it('requires the four current keys and directory fsync, and consumes actual readiness',()=>{
 const x=input();noteRecoveryRefresh(x);expect(x.onFailure).not.toHaveBeenCalled();expect(h.writes).toHaveLength(5);
 expect(h.telemetry.readAuth().durableRefreshSequence).toBeGreaterThan(0);
 expect(h.telemetry.read().database).toBe(false);
 noteRecoveryReadiness({heartbeatAtMs:Date.now(),readiness:{auth:'ready',database:'ready',binaries:'ready',maker:'ready',deviceLink:'ready'}});
 expect(Object.values(h.telemetry.read()).every(Boolean)).toBe(true);
 });
 it('does not produce a commit when fsync fails',()=>{
 h.failFsync=true;const x=input();noteRecoveryRefresh(x);expect(x.onFailure).toHaveBeenCalledOnce();expect(h.telemetry.readAuth()).toBeNull();
 });
 it('rejects an inconsistent mirror without fsync or invented success',()=>{
 h.reads.set('cindy_auth_refresh_token','stale-fixture');const x=input();noteRecoveryRefresh(x);expect(x.onFailure).toHaveBeenCalledOnce();expect(h.writes).toEqual([]);
 });
 it('has no effect on a source profile or an ordinary desktop',()=>{
 h.role=null;const x=input();noteRecoveryRefresh(x);expect(h.writes).toEqual([]);expect(x.onFailure).not.toHaveBeenCalled();
 });
});
