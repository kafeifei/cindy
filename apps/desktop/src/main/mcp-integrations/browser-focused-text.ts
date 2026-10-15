import path from 'node:path';

export interface ManagedBrowserTextRequest {
  pid: number;
  text: string;
  validate(): Promise<void>;
}

let insertText: ((request: ManagedBrowserTextRequest) => Promise<void>) | null = null;

export function ownedManagedBrowserEndpoint(
  status: { ok: boolean; data?: unknown },
  root: string | undefined,
  profile: string,
  pid: number,
): string {
  const data = status.data as Record<string, unknown> | undefined;
  if (
    !root ||
    !data ||
    !status.ok ||
    data.running !== true ||
    data.pid !== pid ||
    data.transport !== 'cdp' ||
    data.profile !== profile ||
    data.headless !== false ||
    data.attachOnly === true ||
    data.userDataDir !== path.join(root, 'browser', profile, 'user-data') ||
    typeof data.cdpUrl !== 'string'
  )
    throw new Error('Text requires the owned managed browser');
  return data.cdpUrl;
}

export function configureManagedBrowserText(
  handler: (request: ManagedBrowserTextRequest) => Promise<void>,
): void {
  insertText = handler;
}

export function insertManagedBrowserText(request: ManagedBrowserTextRequest): Promise<void> {
  if (!insertText) return Promise.reject(new Error('Text requires a managed browser'));
  return insertText(request);
}
