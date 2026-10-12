import {describe,it,expect,vi} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createResourceClaimVerifier,profileMount} from '../profile-runtime-io.js';
import {runtimeEvidenceSchema,sandboxSchema} from '../profile-runtime-contract.js';
const identity={authBaseUrl:'https://auth.test.invalid',membershipId:'test-member',deviceId:'cloud-device-0123456789abcdef01234567'};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=1800000000000;
function token(overrides:Record<string,unknown>={},header:Record<string,unknown>={}) {
 const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key',...header})).toString('base64url');
 const p=Buffer.from(JSON.stringify({iss:identity.authBaseUrl,typ:'access',aud:'cindy',sub:identity.membershipId,device:identity.deviceId,accountControl:false,iat:now/1000,exp:now/1000+300,...overrides})).toString('base64url');
 return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
}
const fetcher=()=>vi.fn(async()=>new Response(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'}]})));
describe('resource observation verifies a current least-privilege identity',()=>{
 it('accepts RS256 with issuer-owned JWKS and returns metadata only',async()=>{
 const fetch=fetcher();const value=await createResourceClaimVerifier(fetch,()=>now)(token(),identity);
 expect(value).toEqual({typ:'access',aud:'cindy',sub:identity.membershipId,deviceId:identity.deviceId,accountControl:false,expiresAtMs:now+300000});
 expect(fetch).toHaveBeenCalledWith(identity.authBaseUrl+'/.well-known/jwks.json',expect.objectContaining({redirect:'error'}));
 });
 it.each([{typ:'instance_access'},{typ:'account'},{aud:['cindy']},{accountControl:true},{accountControl:undefined},{sub:'other'},{device:'other'},{iss:'https://other.invalid'},{exp:now/1000},{iat:now/1000+60},{nbf:now/1000+60},{instance:{id:'other'}}])('rejects incompatible claims %j',async override=>{
 await expect(createResourceClaimVerifier(fetcher(),()=>now)(token(override),identity)).rejects.toThrow('PROFILE_ACCESS_VERIFICATION_FAILED');
 });
 it.each([{alg:'none'},{alg:'HS256'},{jku:'https://other.invalid'},{crit:['test']},{kid:undefined}])('rejects attacker key selection %j',async header=>{
 const fetch=fetcher();await expect(createResourceClaimVerifier(fetch,()=>now)(token({},header),identity)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects a forged signature and an oversized JWKS',async()=>{
 const real=token();await expect(createResourceClaimVerifier(fetcher(),()=>now)(real.slice(0,-8)+'AAAAAAAA',identity)).rejects.toThrow();
 await expect(createResourceClaimVerifier(async()=>new Response(' '.repeat(65537)),()=>now)(real,identity)).rejects.toThrow();
 });
});
describe('profile binding and sandbox evidence',()=>{
 const line=(root:string,opts='rw')=>`1 0 8:1 ${root} /var/lib/cindy/user-data ${opts} - ext4 /dev/example rw`;
 it('derives the role from the actual subpath, never a caller flag',()=>{
 expect(profileMount(line('/data/profiles/revision-1/candidate/user-data'))).toEqual({profile:'revision-1',role:'candidate'});
 expect(profileMount(line('/profiles/revision-1/recovery/user-data'))).toEqual({profile:'revision-1',role:'recovery'});
 expect(profileMount('')).toBeNull();expect(profileMount(line('/data/user-data'))).toBeNull();
 });
 it.each(['/profiles/revision-1/snapshot/user-data','/profiles/revision-1/candidate/user-data/child'])('rejects non-profile subpaths %s',p=>expect(()=>profileMount(line(p))).toThrow());
 it('rejects readonly or ambiguous roots',()=>{
 const p='/profiles/revision-1/candidate/user-data';expect(()=>profileMount(line(p,'ro'))).toThrow();expect(()=>profileMount(line(p)+'\n'+line(p))).toThrow();
 });
 it('requires a live extra renderer filter and excludes secret fields',()=>{
 const browser={pid:1,startTicks:1,seccomp:2,filters:2,noNewPrivs:1,capEff:'0000000000000000'};
 const sandbox={browser,renderers:[{...browser,pid:2,filters:3}],rendererDiscovery:'cdp-system-info',pageReadback:'exact'};
 expect(sandboxSchema.safeParse(sandbox).success).toBe(true);
 expect(sandboxSchema.safeParse({...sandbox,renderers:[{...browser,pid:2}]}).success).toBe(false);
 expect(sandboxSchema.safeParse({...sandbox,token:'forbidden'}).success).toBe(false);
 expect(runtimeEvidenceSchema.safeParse({refreshToken:'forbidden'}).success).toBe(false);
 });
});
