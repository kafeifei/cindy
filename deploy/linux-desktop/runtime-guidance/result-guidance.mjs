/** Cloud packaging only. Adds interpretation next to authoritative results; never changes them. */
export function cloudSettingsResultGuidance(tool, args, result, cloudInstance) {
  if (!cloudInstance || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  const receipt = tool === 'update_settings' ? result.receipt : tool === 'get_settings_operation' ? result.operation : null;
  let guidance;
  if (receipt?.status === 'rejected' && receipt.saved === false) {
    guidance = {
      state: 'finished_not_saved',
      originalOperationId: receipt.operationId,
      confirmationPending: false,
      explanation: receipt.code === 'CONFLICT'
        ? 'This operation has ended without saving because its revision conflicted. Read current settings and compare; do not resubmit, promise a retry or overwrite. A matching current value does not mean this operation succeeded.'
        : 'This operation has ended without saving. CONFIRMATION_REQUIRED on this finished result is not a pending card. Do not ask the user to click the old card, reopen it or resubmit. A new change needs a new explicit user request.',
      next: 'Query this original operation ID and independently read its domain. Report this request as not saved, in the user\'s language.',
    };
  } else if (tool === 'get_settings' && args.domain === 'personalization' && args.include_user_prompt === true && result.ok === false && ['CONFIRMATION_REQUIRED', 'CONFLICT'].includes(result.errorCode)) {
    guidance = {
      state: 'finished_body_not_returned', confirmationPending: false, bodyReturned: false, bodyIsEmpty: null, bodyLength: null,
      responseMeaning: 'Viewing was not confirmed. No body was obtained, so whether it is empty and its character count cannot be determined. No settings were changed.',
      explanation: 'The separate viewing attempt has ended without returning the body. Do not say a viewing card is still waiting or ask the user to approve that ended card. Do not reopen it automatically. Report only that this viewing attempt was not completed. Earlier metadata describes current overrides, not past configuration; never claim the instructions were never saved.',
    };
  } else if (tool === 'get_settings' && args.domain === 'personalization' && result.ok === true && result.settings?.status === 'ready' && !Object.hasOwn(result.settings.value ?? {}, 'userPrompt')) {
    guidance = {
      state: 'current_metadata_only', bodyReturned: false, historyKnown: false, bodyIsEmpty: null, bodyLength: null,
      responseMeaning: 'Only current override metadata is known. The personal-instructions body was not obtained; whether it is empty and its length cannot be determined. If a viewing attempt was canceled, report that it ended unconfirmed.',
      explanation: 'isCustomized and customizedKeys describe current overrides only. Say currently no custom override when appropriate. They do not establish never configured/saved, past instructions, the body, emptiness, or its length. A missing current override is NOT an approved reading of an empty body. Do not start or end the reply with empty/no contents/no characters/zero length, even with a metadata caveat. Never infer history from this metadata.',
    };
  } else if (receipt?.status === 'saved' && receipt.saved === true) {
    guidance = {
      state: 'saved', originalOperationId: receipt.operationId, confirmationPending: false,
      explanation: 'This operation saved. Independently read the domain to verify current value and overrides. For an operation query keep this original ID; a read issues a different ID for a future operation. Report application exactly as the receipt states; saving alone does not prove a running process changed.',
    };
  } else if (tool === 'get_settings_operation' && ['pending', 'unknown'].includes(receipt?.status)) {
    guidance = {
      state: receipt.status, originalOperationId: args.operation_id,
      explanation: receipt.status === 'pending'
        ? 'This original operation has not returned a terminal receipt. Keep waiting for its existing tool/confirmation; do not mint or replay an update. Do not terminate a running exec receiver just because the user has not clicked.'
        : 'The original receipt is unavailable. This alone proves neither past success nor failure. Independently read current settings and do not replay the update.',
    };
  } else if (tool === 'get_settings' && result.ok === true && ['imWorkspaces', 'imWorkspaceProviders'].includes(args.domain) && ['ready', 'unavailable'].includes(result.settings?.status)) {
    guidance = {
      state: result.settings.status === 'ready' ? 'im_preferences_only' : 'im_preferences_unavailable',
      directoryInventoryKnown: false,
      bindingStateKnown: false,
      serviceConfigurationKnown: false,
      explanation: args.domain === 'imWorkspaces'
        ? 'This domain stores model, effort and permission preferences for an existing channel/team/workspace identity. It cannot create, rename, change a path or remove directories. Saved entries are overrides; choices can include historical entries and do not prove a live binding or a complete current directory inventory.'
        : 'This domain stores the model provider source for an existing channel/team/workspace identity. It cannot create, rename, change a path or remove directories. Saved entries are overrides; choices can include historical entries and do not prove a live binding or a complete current directory inventory.',
      next: result.settings.status === 'unavailable'
        ? 'Report only that this preferences read is unavailable. Do not infer different machines, no projects, an unbound account, a missing upgrade, synchronization failure or missing service addresses. Discover existing read capabilities before making a diagnosis; do not invent name/path fields, substitute personal Telegram Bot Token setup for official login, or start authorization automatically.'
        : 'Preserve the exact channel/team/workspace identity when changing supported preferences. Use a live dedicated directory or account-management capability for other requests, if one exists; do not invent it. Official Slack/Telegram/X login and personal bot setup are distinct flows.',
    };
  } else if (tool === 'get_settings' && result.ok === true && result.settings?.status === 'unavailable') {
    guidance = {
      state: 'settings_unavailable', causeKnown: false,
      explanation: 'This read does not establish why the domain is unavailable. Do not infer missing data, an unbound account, a missing service endpoint or a synchronization failure. Discover exact live capabilities; do not invent tools/fields, write a substitute setting, edit files or start authorization to diagnose this result.',
    };
  }
  return guidance ? { ...result, cloudSettingsGuidance: guidance } : result;
}

export async function withCloudSettingsResult(tool, args, cloudInstance, perform) {
  // No timer, fire-and-forget call, confirmation, retry, mutation or extra settings read.
  const result = await perform();
  return cloudSettingsResultGuidance(tool, args, result, cloudInstance);
}
