import type { AgentKind, ProviderView } from '@cindy/model-providers';
import { createIpcError } from './ipc-errors.js';
import { isDataOwnerPushStamp, type DataOwnerPushStamp } from './dataOwnerPush.js';
import {
  visibilityPreferenceKey,
  type ModelPresentationPreferencesSnapshot,
} from './modelPresentationPreferences.js';

/** Host 注入权威快照与变更通知；跨端复用同一等待/错误逻辑，不加载 Electron 或文件存储。 */
export function createModelVisibilityMirror({
  inspectModelPresentationPreferences,
  onModelPresentationPreferencesChanged,
}: {
  inspectModelPresentationPreferences(): ModelPresentationPreferencesSnapshot;
  onModelPresentationPreferencesChanged(listener: () => void): () => void;
}) {
  const waiters = new Set<(error?: Error) => void>();
  let lastNotification = '';
  function notReady(): Error {
    return createIpcError(
      'MODEL_VISIBILITY_NOT_READY',
      'current account model preferences have not synchronized',
    );
  }
  function read() {
    const snapshot = inspectModelPresentationPreferences();
    if (snapshot.status !== 'ready') throw notReady();
    return snapshot.value.visibility.overrides;
  }
  onModelPresentationPreferencesChanged(() => {
    if (inspectModelPresentationPreferences().status === 'ready')
      for (const finish of waiters) finish();
  });
  function waitForModelVisibilityMirror(timeoutMs = 5000): Promise<void> {
    if (inspectModelPresentationPreferences().status === 'ready') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        waiters.delete(finish);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(notReady()), timeoutMs);
      waiters.add(finish);
    });
  }
  /** 旧 Renderer 推送不能替代 Host 文件，仅观察当前 Host 状态变化。 */
  function setModelVisibilityMirror(_raw: unknown, _policy?: unknown): boolean {
    const snapshot = inspectModelPresentationPreferences();
    if (snapshot.status !== 'ready') return false;
    const key = JSON.stringify([snapshot.ownerStamp, snapshot.value.visibility]);
    if (key === lastNotification) return false;
    lastNotification = key;
    for (const finish of waiters) finish();
    return true;
  }
  function syncModelVisibilityMirror(
    raw: unknown,
    onChanged: () => void,
    policy?: unknown,
  ): boolean {
    if (!setModelVisibilityMirror(raw, policy)) return false;
    onChanged();
    return true;
  }
  function syncModelVisibilityMirrorForOwner(
    raw: unknown,
    requestedOwner: unknown,
    activeOwner: DataOwnerPushStamp,
    boundaryPending: boolean,
    onChanged: () => void,
    policy?: unknown,
  ): boolean {
    if (
      boundaryPending ||
      !isDataOwnerPushStamp(requestedOwner) ||
      requestedOwner.dataOwnerId !== activeOwner.dataOwnerId ||
      requestedOwner.ownerGeneration !== activeOwner.ownerGeneration
    )
      return false;
    return syncModelVisibilityMirror(raw, onChanged, policy);
  }
  /** 缺失路由返回 undefined，由消费者应用当前目录 defaultEnabled。 */
  function getModelVisibilityOverride(
    agent: AgentKind,
    providerId: string,
    modelId: string,
  ): boolean | undefined {
    return read()[visibilityPreferenceKey(agent, providerId, modelId)];
  }
  function getModelVisibilityMirrorSnapshot(
    _providers: readonly ProviderView[] = [],
    allowPending = false,
  ): Record<string, boolean> {
    const snapshot = inspectModelPresentationPreferences();
    if (snapshot.status !== 'ready') {
      if (allowPending) return {};
      throw notReady();
    }
    return { ...snapshot.value.visibility.overrides };
  }
  /** 账号边界同步取消旧等待者，下次读取解析新 owner 文件。 */
  function clearModelVisibilityMirror(): void {
    lastNotification = '';
    for (const finish of waiters) finish(notReady());
  }
  return {
    waitForModelVisibilityMirror,
    setModelVisibilityMirror,
    syncModelVisibilityMirror,
    syncModelVisibilityMirrorForOwner,
    getModelVisibilityOverride,
    getModelVisibilityMirrorSnapshot,
    clearModelVisibilityMirror,
    __resetModelVisibilityMirrorForTest: clearModelVisibilityMirror,
  };
}
