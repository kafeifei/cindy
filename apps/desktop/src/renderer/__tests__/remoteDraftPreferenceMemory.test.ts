import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('localStorage', localStorage);
  vi.resetModules();
});

async function host(owner = 'owner-a') {
  const draft = await import('@/state/newMakerDraft');
  const memory = await import('@/state/providerModelMemory');
  const { applyRemoteDraftPreference: apply } = await import('@/state/applyRemoteDraftPreference');
  draft.setNewMakerDraftOwner(owner);
  memory.setProviderModelMemoryOwner(owner);
  return { draft, memory, apply };
}

const selection = {
  agent: 'codex' as const,
  providerId: 'xd',
  modelId: 'chosen-model',
  active: true,
  markModelChoice: true,
  effort: 'medium',
  fast: false,
};

describe('remote picker → host-owned persistent new-task preference', () => {
  it('remembers model, source and engine after closing the draft and restarting the host', async () => {
    let h = await host();
    h.apply(selection);
    expect(h.draft.getDraft()).toMatchObject({
      vendor: 'codex',
      defaultTupleCustomized: true,
      modelChosenByVendor: { codex: true },
      lastByVendor: { codex: { model: 'chosen-model', providerId: 'xd', effort: 'medium' } },
    });
    vi.resetModules();
    h = await host();
    expect(h.draft.getPersistedVendorModel('codex')).toBe('chosen-model');
    expect(h.draft.getDraft().vendor).toBe('codex');
    expect(
      h.draft.applySuggestedDefaultTuple({ vendor: 'pi', model: 'recommended', providerId: 'xd' }),
    ).toBe(false);
    expect(h.draft.getDraft().lastByVendor.codex.model).toBe('chosen-model');
  });

  it('a second explicit selection replaces the previous remembered model', async () => {
    const h = await host();
    h.apply(selection);
    h.apply({ ...selection, agent: 'pi', modelId: 'second-model', effort: 'high' });
    expect(h.draft.getDraft()).toMatchObject({
      vendor: 'pi',
      modelChosenByVendor: { codex: true, pi: true },
      lastByVendor: { pi: { model: 'second-model', providerId: 'xd' } },
    });
  });

  it('tuning another model cannot replace the chosen model, engine or source', async () => {
    const h = await host();
    h.apply(selection);
    h.apply({
      ...selection,
      modelId: 'other',
      providerId: 'other-provider',
      markModelChoice: false,
      effort: 'high',
    });
    h.apply({
      ...selection,
      agent: 'pi',
      modelId: 'other-pi',
      active: false,
      markModelChoice: false,
    });
    expect(h.draft.getDraft()).toMatchObject({
      vendor: 'codex',
      lastByVendor: { codex: { model: 'chosen-model', providerId: 'xd', effort: 'medium' } },
    });
  });

  it('an explicit row without an effort value is still remembered', async () => {
    const h = await host();
    h.apply({ ...selection, effort: undefined });
    expect(h.draft.getPersistedVendorModel('codex')).toBe('chosen-model');
  });

  it('model preferences remain isolated by account', async () => {
    const a = await host();
    a.apply(selection);
    const b = await host('owner-b');
    expect(b.draft.getPersistedVendorModel('codex')).toBe('');
    b.apply({ ...selection, modelId: 'b-model' });
    const back = await host();
    expect(back.draft.getPersistedVendorModel('codex')).toBe('chosen-model');
  });

  it('a recommendation/tuning write does not mark a fresh profile as a user choice', async () => {
    const h = await host();
    h.apply({ ...selection, markModelChoice: false });
    expect(h.draft.getDraft().modelChosenByVendor.codex).not.toBe(true);
    expect(h.draft.getDraft().vendor).toBe('cc');
  });
});
