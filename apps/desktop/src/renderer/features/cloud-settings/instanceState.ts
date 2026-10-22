import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';

export const stableInstanceState = (view: CloudInstanceView) =>
  view.desiredState !== 'deleted' &&
  !view.upgradeOperation?.active &&
  !view.resourceChanging &&
  view.upgradeState !== 'verifying' &&
  ((view.desiredState === 'running' && view.runtimeState === 'running' && view.ready) ||
    (view.desiredState === 'stopped' && ['stopped', 'missing'].includes(view.runtimeState)) ||
    view.runtimeState === 'error');

export const instanceStatus = (view: CloudInstanceView) =>
  view.upgradeOperation?.active || view.upgradeState === 'verifying'
    ? 'upgrading'
    : view.runtimeState === 'error'
      ? 'error'
      : view.desiredState === 'stopped'
        ? ['stopped', 'missing'].includes(view.runtimeState)
          ? 'asleep'
          : 'stopping'
        : view.runtimeState === 'running' && view.ready
          ? 'running'
          : 'starting';

// Match the owner's web action: one request outside the maintenance window is
// allowed even with auto-update off. CIS remains the final eligibility authority.
export const canRequestUpgrade = (view: CloudInstanceView) =>
  view.manualUpgrade === true &&
  view.updateAvailable &&
  !view.upgradeOperation?.active &&
  !view.resourceChanging &&
  !view.loginRequired &&
  view.upgradeState !== 'verifying' &&
  view.desiredState === 'running' &&
  view.runtimeState === 'running';

export const upgradeProgressKey = (phase: string) =>
  phase === 'requested'
    ? 'upgradeQueued'
    : phase === 'completed'
      ? 'upgradeComplete'
      : phase === 'recovery-hold'
        ? 'upgradeHeld'
        : phase === 'cancelled' || phase === 'backup-deferred'
          ? 'upgradeDeferred'
          : phase === 'backup-running'
            ? 'upgradeBackup'
            : 'upgradeInProgress';
