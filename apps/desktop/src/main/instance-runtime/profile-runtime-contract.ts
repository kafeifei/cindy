import { z } from 'zod';
import { createHash } from 'node:crypto';
// Local implementation of CIS runtime evidence v1. Maintenance ABI v3 is unchanged.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const preflightBindingSchema = z.object({version:z.literal(1),purpose:z.literal('cis-profile-preflight'),
 pilotSha256:sha,layoutSha256:sha,sourcePodUid:id,pvcUid:id,sourceTemplateSha256:sha,
 recoveryScope:z.literal('image-and-cindy-resource'),credentials:z.literal('synthetic-only')}).strict();
const processSchema = z.object({pid:z.number().int().positive(),startTicks:counter,seccomp:z.literal(2),
 filters:z.number().int().positive(),noNewPrivs:z.literal(1),capEff:z.literal('0000000000000000')}).strict();
export const sandboxSchema = z.object({browser:processSchema,renderers:z.array(processSchema).min(1).max(8),
 rendererDiscovery:z.literal('cdp-system-info'),pageReadback:z.literal('exact')}).strict().superRefine((v,c)=>{
 const pids=[v.browser.pid,...v.renderers.map(p=>p.pid)];
 if(new Set(pids).size!==pids.length||v.renderers.some(p=>p.filters<=v.browser.filters))
 c.addIssue({code:z.ZodIssueCode.custom,message:'additional renderer sandbox required'});
});
export const canonicalObservationSchema = z.object({source:z.enum(['canonical','legacy-cindy-four-keys']),
 backend:z.literal('gnome-libsecret'),sessionId:id,durableRefreshSequence:counter,durableAtMs:counter,
 typ:z.literal('access'),aud:z.literal('cindy'),sub:id,deviceId:id,accountControl:z.literal(false),expiresAtMs:counter}).strict();
export const readinessSchema = z.object({auth:z.literal('ready'),database:z.literal('ready'),binaries:z.literal('ready'),
 maker:z.literal('ready'),deviceLink:z.literal('ready')}).strict();
export const telemetrySchema = z.object({version:z.literal(1),deviceId:id,membershipId:id,realm:z.enum(['cn','global']),
 authBaseUrl:z.string().url(),profile:id,role:z.enum(['candidate','recovery']),heartbeatAtMs:counter,
 process:z.object({pid:z.number().int().positive(),startTicks:counter}).strict(),canonical:canonicalObservationSchema,
 readiness:readinessSchema}).strict();
export const runtimeEvidenceSchema = telemetrySchema.extend({sandbox:sandboxSchema}).strict();
const preflightBase = z.object({version:z.literal(1),bindingSha256:sha,podUid:id,observedAtMs:counter,
 architecture:z.enum(['amd64','arm64']),sandbox:sandboxSchema}).strict();
export const preflightEvidenceSchema = z.discriminatedUnion('role',[
 preflightBase.extend({role:z.literal('candidate'),checks:z.object({canonicalWithoutB:z.literal(true),missingCanonicalRejected:z.literal(true),
 wrongKeyRejected:z.literal(true),sharedKeyringAcrossHomes:z.literal(true)}).strict()}).strict(),
 preflightBase.extend({role:z.literal('recovery'),checks:z.object({legacyAsarWithSecureWrapper:z.literal(true),currentResourceAccepted:z.literal(true),
 refreshCycles:counter.min(2),sharedKeyringAcrossHomes:z.literal(true)}).strict()}).strict(),
 preflightBase.extend({role:z.literal('maintenance'),checks:z.object({latestDurableForward:z.literal(true),latestCanonicalReverse:z.literal(true),
 sourceUnchanged:z.literal(true),cindyOnlyRecovery:z.literal(true),wrongKeyRejected:z.literal(true)}).strict()}).strict(),
]);
export function evidenceDigest(value:unknown):string {
 const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'
 ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sorted(x)])):v;
 return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}
export const SANDBOX_PAGE_TEXT='cindy-profile-sandbox-v1';
export const SANDBOX_PAGE_URL='data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><body>'+SANDBOX_PAGE_TEXT+'</body>');
