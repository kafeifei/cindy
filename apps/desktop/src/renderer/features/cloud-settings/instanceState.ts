import type { CloudInstanceView } from '../../../shared/cloudInstanceControl';

export const stableInstanceState = (view: CloudInstanceView) =>
  view.desiredState !== 'deleted' &&
  view.upgradeState !== 'verifying' &&
  ((view.desiredState === 'running' && view.runtimeState === 'running' && view.ready) ||
    (view.desiredState === 'stopped' && ['stopped', 'missing'].includes(view.runtimeState)) ||
    view.runtimeState === 'error');

export const instanceStatus = (view: CloudInstanceView) =>
  view.upgradeState === 'verifying'
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
