import type { PendingPluginSetup, PluginSetupInlineFormValues } from '@/lib/makerChatStore';
import {
  createPluginConnectionPresentation,
  createPluginSecretPresentation,
} from '../../../shared/pluginOauth';

/** Credential-bearing actions must use the existing signed Main bridge. Never
 * send a form through cloud resources, generic device invoke or local settings. */
export async function executeCloudPluginAction(
  deviceId: string,
  card: PendingPluginSetup,
  action: 'run_action' | 'submit_form',
  actionId: string,
  values?: PluginSetupInlineFormValues,
) {
  if (!deviceId || card.terminal) throw new Error('UNAVAILABLE');
  const step = card.steps.find((step) => step.action?.id === actionId);
  if (!step?.action || !['pending', 'failed'].includes(step.phase)) throw new Error('UNAVAILABLE');
  const base = {
    deviceId,
    ghostId: card.ghost.id,
    requestId: card.requestId,
    actionId,
    expectedRevision: card.revision,
  };
  let result: { accepted: boolean };
  if (action === 'run_action' && step.action.kind === 'oauth_connect' && card.remoteOauth) {
    result = await window.electronAPI.maker.assistPluginOauth(base);
  } else if (action === 'submit_form' && step.action.kind === 'inline_form' && card.remoteSecret) {
    const field = step.action.form.fields[0];
    if (!values?.value.trim() || values.value.length > field.maxLength)
      throw new Error('INVALID_FORM');
    result = await window.electronAPI.maker.submitRemotePluginSecret({
      ...base,
      value: values.value,
      presentation: createPluginSecretPresentation(card, step, field),
    });
  } else if (
    action === 'submit_form' &&
    step.action.kind === 'manage_connection' &&
    card.remoteConnection &&
    values?.host &&
    values.value
  ) {
    result = await window.electronAPI.maker.submitRemotePluginConnection({
      ...base,
      value: { host: values.host, token: values.value },
      presentation: createPluginConnectionPresentation(card, step),
    });
  } else throw new Error('UNSUPPORTED');
  if (!result.accepted) throw new Error('REJECTED');
}
