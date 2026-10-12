/** Fixed diagnostic vocabulary. Never log telemetry, tokens, URLs or raw errors. */
export type ProfileObservationStage = 'telemetry' | 'binding' | 'sandbox' | 'publish' | 'watchdog' | 'lifecycle';

const knownCodes = new Set([
  'PROFILE_PROCESS_LIST_REJECTED', 'PROFILE_BROWSER_REJECTED',
  'PROFILE_RENDERER_LIMIT_EXCEEDED', 'PROFILE_PAGE_REJECTED',
  'PROFILE_PROCESS_REJECTED', 'PROFILE_EVIDENCE_REJECTED',
  'PROFILE_CDP_CLOSED', 'PROFILE_CDP_REJECTED', 'PROFILE_CDP_TIMEOUT',
  'PROFILE_CDP_WRITE_FAILED',
]);
const defaults: Record<ProfileObservationStage, string> = {
  telemetry: 'PROFILE_TELEMETRY_UNAVAILABLE',
  binding: 'PROFILE_BINDING_REJECTED',
  sandbox: 'PROFILE_SANDBOX_REJECTED',
  publish: 'PROFILE_PUBLICATION_FAILED',
  watchdog: 'PROFILE_HEARTBEAT_STALE',
  lifecycle: 'PROFILE_PROCESS_UNAVAILABLE',
};

export function profileObservationDiagnostic(error: unknown, stage: ProfileObservationStage) {
  const code = error instanceof Error && knownCodes.has(error.message)
    ? error.message : defaults[stage];
  return { event: 'PROFILE_OBSERVATION_UNAVAILABLE' as const, stage, code };
}
