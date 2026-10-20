import { app, ipcMain, net, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as auth from '../authManager';
import { getClientEndpointForRealm } from '../clientEndpointsService';
import { isAppSessionBoundaryPending, peekCommittedAppSession } from '../appSessionState';
import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer';
import { CLOUD_CLIENT_CHANNELS } from '../../shared/cloudSettingsClient';
import { createCloudSettingsService } from './service';
import { cloudSettingsClientHandlers } from './ipc';
import { createCloudClientHttp, type CloudClientIdentity } from './transport';

function identity(): CloudClientIdentity | null {
  if (isAppSessionBoundaryPending()) return null;
  const session = peekCommittedAppSession(),
    membership = auth.peekCommittedAuthIdentity();
  const accessToken = auth.getAccessToken();
  if (
    session?.mode !== 'cloud' ||
    !membership?.isAuthenticated ||
    !accessToken ||
    session.dataOwnerId !== membership.userId
  )
    return null;
  const realm = auth.getActiveAuthRealm();
  let baseUrl: string;
  try {
    baseUrl = getClientEndpointForRealm(realm, 'cloudInstanceApiBaseUrl');
  } catch {
    return null;
  }
  if (!baseUrl) return null;
  return {
    key: JSON.stringify([
      session.dataOwnerId,
      session.generation,
      realm,
      auth.getDeviceId(),
      baseUrl,
    ]),
    generation: session.generation,
    baseUrl,
    accessToken,
  };
}
let registered = false;
export function registerCloudSettingsClientIpc() {
  if (registered) return;
  registered = true;
  const service = createCloudSettingsService({
    identity,
    openExternal: (url) => shell.openExternal(url),
    http: createCloudClientHttp((url, init) => net.fetch(url as string, init)),
    keepAlive(refresh) {
      const timer = setInterval(() => {
        void refresh();
      }, 30_000);
      timer.unref();
      return () => clearInterval(timer);
    },
  });
  const handlers = cloudSettingsClientHandlers(service);
  const observed = new WeakSet<WebContents>();
  const caller = (event: IpcMainInvokeEvent) => {
    assertTrustedAppRendererEvent(event);
    const sender = event.sender;
    if (!observed.has(sender)) {
      observed.add(sender);
      const invalidate = () => service.invalidate(sender.id);
      sender.once('destroyed', invalidate);
      sender.on('render-process-gone', invalidate);
      sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) invalidate();
      });
    }
    return { id: sender.id, assertCurrent: () => assertTrustedAppRendererEvent(event) };
  };
  for (const key of Object.keys(CLOUD_CLIENT_CHANNELS) as Array<keyof typeof handlers>) {
    ipcMain.handle(CLOUD_CLIENT_CHANNELS[key], (event, raw: unknown) =>
      handlers[key](caller(event), raw),
    );
  }
  let ownerKey = identity()?.key;
  const off = auth.onAuthStateChange(() => {
    const next = identity()?.key;
    if (next !== ownerKey) {
      service.invalidate();
      ownerKey = next;
    }
  });
  app.once('before-quit', () => {
    off();
    service.invalidate();
  });
}
