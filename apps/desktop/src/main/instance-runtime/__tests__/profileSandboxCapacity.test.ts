import { describe, expect, it, vi } from 'vitest';
import { observeSandbox } from '../profile-runtime-io.js';
import { MAX_RUNTIME_RENDERERS, SANDBOX_PAGE_TEXT, SANDBOX_PAGE_URL, preflightSandboxSchema, sandboxSchema } from '../profile-runtime-contract.js';
import { profileObservationDiagnostic } from '../profile-observation-diagnostic.js';

/** CDP and /proc metadata only; no Electron or real credentials in unit tests. */
function harness(count: number) {
  const observe = vi.fn((pid: number) => ({ pid, startTicks: pid + 10, seccomp: 2,
    filters: pid === 1 ? 1 : 2, noNewPrivs: 1, capEff: '0000000000000000' }));
  const invoke = vi.fn(async (method: string) => {
    if (method === 'SystemInfo.getProcessInfo') return { processInfo: [
      { type: 'browser', id: 1 }, ...Array.from({ length: count }, (_, n) => ({ type: 'renderer', id: n + 2 })),
    ] };
    if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'fixed-witness', url: SANDBOX_PAGE_URL }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'witness-session' };
    if (method === 'Runtime.evaluate') return { result: { value: SANDBOX_PAGE_TEXT } };
    return {};
  });
  return { observe, invoke };
}

describe('runtime observation with multiple plugin renderers', () => {
  it.each([8, 12, MAX_RUNTIME_RENDERERS])('observes all %i renderers without truncation', async count => {
    const h = harness(count);
    const proof = await observeSandbox(h.invoke, 1, h.observe);
    expect(proof.renderers).toHaveLength(count);
    expect(h.observe).toHaveBeenCalledTimes(count + 1);
    expect(proof.renderers.at(-1)?.pid).toBe(count + 1);
    expect(h.invoke).toHaveBeenCalledWith('Target.detachFromTarget', { sessionId: 'witness-session' });
  });
  it('rejects a weak sandbox beyond the old eight-renderer boundary', async () => {
    const h = harness(12), real = h.observe.getMockImplementation()!;
    h.observe.mockImplementation(pid => ({ ...real(pid), filters: pid === 13 ? 1 : pid === 1 ? 1 : 2 }));
    await expect(observeSandbox(h.invoke, 1, h.observe)).rejects.toThrow();
  });
  it('rejects an excessive census before expensive /proc reads', async () => {
    const h = harness(MAX_RUNTIME_RENDERERS + 1);
    await expect(observeSandbox(h.invoke, 1, h.observe)).rejects.toThrow('PROFILE_RENDERER_LIMIT_EXCEEDED');
    expect(h.observe).not.toHaveBeenCalled();
  });
  it('keeps preflight receipts bounded independently of runtime capacity', async () => {
    const h = harness(12), proof = await observeSandbox(h.invoke, 1, h.observe);
    expect(sandboxSchema.safeParse(proof).success).toBe(true);
    expect(preflightSandboxSchema.safeParse(proof).success).toBe(false);
  });
  it('emits fixed failure metadata without arbitrary error contents', () => {
    expect(profileObservationDiagnostic(new Error('PROFILE_RENDERER_LIMIT_EXCEEDED'), 'sandbox').code)
      .toBe('PROFILE_RENDERER_LIMIT_EXCEEDED');
    const result = profileObservationDiagnostic(new Error('synthetic-sensitive-value'), 'sandbox');
    expect(result).toEqual({ event: 'PROFILE_OBSERVATION_UNAVAILABLE', stage: 'sandbox', code: 'PROFILE_SANDBOX_REJECTED' });
    expect(JSON.stringify(result)).not.toContain('synthetic-sensitive-value');
  });
});
