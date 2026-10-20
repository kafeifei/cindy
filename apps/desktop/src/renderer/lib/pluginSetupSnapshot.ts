import {
  GHOST_SECRET_VALUE_MAX_CHARS,
  GHOST_SETUP_MAX_INTERACTION_STEPS,
  isGhostSetupErrorCode,
  type GhostSetupStepPhase,
  type GhostSetupActionKind,
  type GhostSetupAllowedAction,
} from '../../shared/ghost';
import type { PendingPluginSetup, PluginSetupAction } from './makerChatStore';

type PluginSetupInlineFormAction = Extract<GhostSetupAllowedAction, { kind: 'inline_form' }>;
const PLUGIN_SETUP_STEP_PHASES = new Set<GhostSetupStepPhase>([
  'pending',
  'action_running',
  'waiting_external',
  'verifying',
  'satisfied',
  'failed',
  'cancelled',
]);

const PLUGIN_SETUP_ACTION_KINDS = new Set<GhostSetupActionKind>([
  'oauth_connect',
  'open_plugin_settings',
  'manage_connection',
  'open_client_settings',
]);

function parsePluginSetupInlineFormAction(
  rawAction: Record<string, unknown>,
): PluginSetupInlineFormAction | null {
  const rawForm = rawAction.form;
  if (!rawForm || typeof rawForm !== 'object' || Array.isArray(rawForm)) return null;
  const rawFields = (rawForm as Record<string, unknown>).fields;
  if (!Array.isArray(rawFields) || rawFields.length !== 1) return null;

  const rawField = rawFields[0];
  if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) return null;
  const field = rawField as Record<string, unknown>;
  let externalLink: { url: string } | undefined;
  if (field.externalLink !== undefined) {
    if (
      !field.externalLink ||
      typeof field.externalLink !== 'object' ||
      Array.isArray(field.externalLink)
    ) {
      return null;
    }
    const rawLink = field.externalLink as Record<string, unknown>;
    if (
      Object.keys(rawLink).length !== 1 ||
      typeof rawLink.url !== 'string' ||
      rawLink.url.length === 0 ||
      rawLink.url.length > 200
    ) {
      return null;
    }
    try {
      const parsed = new URL(rawLink.url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    } catch {
      return null;
    }
    externalLink = { url: rawLink.url };
  }
  if (
    field.id !== 'value' ||
    field.type !== 'secret' ||
    typeof field.label !== 'string' ||
    field.label.length === 0 ||
    field.label.length > 120 ||
    (field.description !== undefined &&
      (typeof field.description !== 'string' || field.description.length > 500)) ||
    (field.placeholder !== undefined &&
      (typeof field.placeholder !== 'string' || field.placeholder.length > 120)) ||
    field.required !== true ||
    typeof field.maxLength !== 'number' ||
    !Number.isSafeInteger(field.maxLength) ||
    field.maxLength < 1 ||
    field.maxLength > GHOST_SECRET_VALUE_MAX_CHARS
  ) {
    return null;
  }

  return {
    id: rawAction.id as string,
    kind: 'inline_form',
    form: {
      fields: [
        {
          id: field.id,
          type: 'secret',
          label: field.label,
          ...(typeof field.description === 'string' ? { description: field.description } : {}),
          ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}),
          ...(externalLink ? { externalLink } : {}),
          required: true,
          maxLength: field.maxLength,
        },
      ],
    },
  };
}

/** Strict renderer boundary parser: unknown push data never reaches the card. */
export function parsePendingPluginSetup(request: {
  remoteOauth?: unknown;
  remoteSecret?: unknown;
  remoteConnection?: unknown;
  requestId?: unknown;
  revision?: unknown;
  terminal?: unknown;
  ghost?: unknown;
  intro?: unknown;
  steps?: unknown;
}): PendingPluginSetup | null {
  if (
    typeof request.requestId !== 'string' ||
    request.requestId.length === 0 ||
    request.requestId.length > 256 ||
    typeof request.revision !== 'number' ||
    !Number.isSafeInteger(request.revision) ||
    request.revision < 0 ||
    !request.ghost ||
    typeof request.ghost !== 'object' ||
    !Array.isArray(request.steps) ||
    request.steps.length === 0 ||
    request.steps.length > GHOST_SETUP_MAX_INTERACTION_STEPS ||
    (request.terminal !== undefined && request.terminal !== true) ||
    (request.intro !== undefined &&
      (typeof request.intro !== 'string' || request.intro.length > 500))
  ) {
    return null;
  }

  const ghost = request.ghost as Record<string, unknown>;
  if (
    typeof ghost.id !== 'string' ||
    ghost.id.length === 0 ||
    ghost.id.length > 256 ||
    typeof ghost.name !== 'string' ||
    ghost.name.length === 0 ||
    ghost.name.length > 256
  ) {
    return null;
  }

  const steps: PendingPluginSetup['steps'] = [];
  for (const rawStep of request.steps) {
    if (!rawStep || typeof rawStep !== 'object') return null;
    const step = rawStep as Record<string, unknown>;
    if (
      typeof step.id !== 'string' ||
      step.id.length === 0 ||
      step.id.length > 256 ||
      (step.groupId !== undefined &&
        (typeof step.groupId !== 'string' ||
          step.groupId.length === 0 ||
          step.groupId.length > 256)) ||
      (step.groupMode !== undefined && step.groupMode !== 'any_of') ||
      typeof step.title !== 'string' ||
      step.title.length === 0 ||
      step.title.length > 120 ||
      typeof step.description !== 'string' ||
      step.description.length > 500 ||
      typeof step.phase !== 'string' ||
      !PLUGIN_SETUP_STEP_PHASES.has(step.phase as GhostSetupStepPhase) ||
      (step.errorCode !== undefined && !isGhostSetupErrorCode(step.errorCode)) ||
      (step.errorMessage !== undefined &&
        (typeof step.errorMessage !== 'string' || step.errorMessage.length > 500))
    ) {
      return null;
    }

    let action: PluginSetupAction | undefined;
    if (step.action !== undefined) {
      if (!step.action || typeof step.action !== 'object') return null;
      const rawAction = step.action as Record<string, unknown>;
      if (
        typeof rawAction.id !== 'string' ||
        rawAction.id.length === 0 ||
        rawAction.id.length > 256 ||
        typeof rawAction.kind !== 'string'
      ) {
        return null;
      }
      if (rawAction.kind === 'inline_form') {
        const parsedInline = parsePluginSetupInlineFormAction(rawAction);
        if (!parsedInline) return null;
        action = parsedInline;
      } else {
        if (!PLUGIN_SETUP_ACTION_KINDS.has(rawAction.kind as GhostSetupActionKind)) return null;
        action = {
          id: rawAction.id,
          kind: rawAction.kind as Exclude<GhostSetupActionKind, 'inline_form'>,
        };
      }
    }

    steps.push({
      id: step.id,
      // Older controlled Desktops did not project group identity. Treat each
      // legacy step as its own group while preserving strict validation when
      // the new fields are present.
      groupId: typeof step.groupId === 'string' ? step.groupId : step.id,
      groupMode: 'any_of',
      title: step.title,
      description: step.description,
      phase: step.phase as GhostSetupStepPhase,
      ...(action ? { action } : {}),
      ...(isGhostSetupErrorCode(step.errorCode) ? { errorCode: step.errorCode } : {}),
      ...(typeof step.errorMessage === 'string' ? { errorMessage: step.errorMessage } : {}),
    });
  }

  const iconDataUrl =
    typeof ghost.iconDataUrl === 'string' &&
    ghost.iconDataUrl.length <= 512_000 &&
    ghost.iconDataUrl.startsWith('data:image/')
      ? ghost.iconDataUrl
      : undefined;
  return {
    requestId: request.requestId,
    revision: request.revision,
    ...(request.remoteOauth === true ? { remoteOauth: true as const } : {}),
    ...(request.remoteSecret === true ? { remoteSecret: true as const } : {}),
    ...(request.remoteConnection === true ? { remoteConnection: true as const } : {}),
    ...(request.terminal === true ? { terminal: true as const } : {}),
    ghost: {
      id: ghost.id,
      name: ghost.name,
      ...(iconDataUrl ? { iconDataUrl } : {}),
    },
    ...(typeof request.intro === 'string' ? { intro: request.intro } : {}),
    steps,
  };
}
