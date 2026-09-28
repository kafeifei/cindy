import type { IpcRenderer } from 'electron';
import {
  MODEL_PRESENTATION_CHANNELS,
  type ModelPresentationPreferencesApi,
} from '../shared/modelPresentationPreferences';

/** 仅固定本机 IPC：禁止经 device-link 转发控制端 localStorage。 */
export function createModelPresentationPreferencesApi(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>,
): ModelPresentationPreferencesApi {
  return {
    get: () => ipc.invoke(MODEL_PRESENTATION_CHANNELS.get),
    importLegacy: (request) => ipc.invoke(MODEL_PRESENTATION_CHANNELS.importLegacy, request),
    mutate: (request) => ipc.invoke(MODEL_PRESENTATION_CHANNELS.mutate, request),
    onChanged: (listener) => {
      const handler = (_event: unknown, stamp: Parameters<typeof listener>[0]) => listener(stamp);
      ipc.on(MODEL_PRESENTATION_CHANNELS.changed, handler);
      return () => {
        ipc.removeListener(MODEL_PRESENTATION_CHANNELS.changed, handler);
      };
    },
  };
}
