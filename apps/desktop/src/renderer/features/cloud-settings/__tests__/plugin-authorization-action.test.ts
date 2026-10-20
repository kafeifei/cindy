// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { executeCloudPluginAction } from '../pluginAuthorizationAction';
import { createTrialPluginAuthorization } from '../trialPluginAuthorization';
import { parsePendingPluginSetup } from '@/lib/pluginSetupSnapshot';
async function fixture(id: string) {
  const result = await createTrialPluginAuthorization()({
    operation: 'start',
    operationId: crypto.randomUUID(),
    pluginId: id,
  });
  if (result.kind !== 'setup') throw Error('FIXTURE');
  const card = parsePendingPluginSetup(result.snapshot as object)!;
  const api = {
    assistPluginOauth: vi.fn(async () => ({ accepted: true })),
    submitRemotePluginSecret: vi.fn(async () => ({ accepted: true })),
    submitRemotePluginConnection: vi.fn(async () => ({ accepted: true })),
  };
  Object.assign(window, {
    electronAPI: {
      maker: new Proxy(api, {
        get(target, key) {
          if (!(key in target)) throw Error('FORBIDDEN_API');
          return target[key as keyof typeof api];
        },
      }),
    },
  });
  return { card, api, actionId: card.steps[0].action!.id };
}
describe('plugin credential transport', () => {
  it('uses the exact target, card revision and dedicated OAuth channel', async () => {
    const f = await fixture('trial-oauth');
    await executeCloudPluginAction('cloud-a', f.card, 'run_action', f.actionId);
    expect(f.api.assistPluginOauth).toHaveBeenCalledWith({
      deviceId: 'cloud-a',
      ghostId: f.card.ghost.id,
      requestId: f.card.requestId,
      actionId: f.actionId,
      expectedRevision: f.card.revision,
    });
    expect(f.api.submitRemotePluginSecret).not.toHaveBeenCalled();
  });
  it('sends a Token only through the signed secret bridge with displayed field binding', async () => {
    const f = await fixture('trial-secret');
    await executeCloudPluginAction('cloud-a', f.card, 'submit_form', f.actionId, {
      value: 'test-token',
    });
    expect(f.api.submitRemotePluginSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'cloud-a',
        value: 'test-token',
        presentation: expect.objectContaining({
          fieldLabel: 'Token',
          ghostName: 'API Key / Token',
        }),
      }),
    );
    expect(f.api.assistPluginOauth).not.toHaveBeenCalled();
  });
  it('keeps connection host/token on the dedicated connection channel', async () => {
    const f = await fixture('trial-connection');
    await executeCloudPluginAction('cloud-a', f.card, 'submit_form', f.actionId, {
      host: 'https://example.com',
      value: 'test-token',
    });
    expect(f.api.submitRemotePluginConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'cloud-a',
        value: { host: 'https://example.com', token: 'test-token' },
        presentation: expect.objectContaining({ connectionKey: 'service' }),
      }),
    );
  });
  it('rejects unsupported/terminal/stale cards without local fallback', async () => {
    const f = await fixture('trial-secret');
    await expect(
      executeCloudPluginAction(
        'cloud-a',
        { ...f.card, remoteSecret: undefined },
        'submit_form',
        f.actionId,
        { value: 'test-token' },
      ),
    ).rejects.toThrow();
    await expect(
      executeCloudPluginAction(
        'cloud-a',
        { ...f.card, terminal: true },
        'submit_form',
        f.actionId,
        { value: 'test-token' },
      ),
    ).rejects.toThrow();
    await expect(
      executeCloudPluginAction('cloud-a', f.card, 'submit_form', 'stale', { value: 'test-token' }),
    ).rejects.toThrow();
    expect(f.api.submitRemotePluginSecret).not.toHaveBeenCalled();
  });
});
