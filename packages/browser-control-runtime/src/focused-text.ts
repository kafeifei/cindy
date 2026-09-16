import { Agent, fetch } from 'undici';
import { withCdpSocket, type CdpSendFn } from './_generated/extension/src/browser/cdp.helpers.js';

export interface FocusedBrowserTextRequest {
  cdpUrl: string;
  pid: number;
  text: string;
  validate(): Promise<void>;
}

const focusedElement = `(() => {
  if (!document.hasFocus() || document.visibilityState !== 'visible') return null;
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  if (!element || !element.isConnected || element.disabled || element.readOnly) return null;
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return element;
  if (element instanceof HTMLInputElement && ['text', 'password', 'search', 'tel', 'url', 'email'].includes(element.type)) return element;
  return null;
})()`;

const insertIntoPinnedElement = `function(text) {
  const element = ${focusedElement};
  if (element !== this || this.ownerDocument !== document) return false;
  const multiline = this instanceof HTMLTextAreaElement || this.isContentEditable;
  if (!multiline && /[\\n\\t]/.test(text)) return false;
  if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
    if (this.maxLength >= 0) {
      if (this.selectionStart === null || this.selectionEnd === null) return false;
      const length = this.value.length - (this.selectionEnd - this.selectionStart) + text.length;
      if (length > this.maxLength) return false;
    }
  } else {
    const selection = document.getSelection();
    if (!selection || !this.contains(selection.anchorNode) || !this.contains(selection.focusNode)) return false;
  }
  if (!document.queryCommandSupported('insertText')) return false;
  return document.execCommand('insertText', false, text);
}`;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browser response');
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid browser identifier');
  return value;
}

export async function deliverFocusedBrowserText(request: FocusedBrowserTextRequest, send: CdpSendFn): Promise<void> {
  const processes = record(await send('SystemInfo.getProcessInfo')).processInfo;
  if (!Array.isArray(processes) || !processes.some((process) => record(process).type === 'browser' && record(process).id === request.pid))
    throw new Error('Managed browser process changed');
  const targets = record(await send('Target.getTargets')).targetInfos;
  if (!Array.isArray(targets) || targets.length > 64) throw new Error('Browser target limit exceeded');
  const matches: Array<{ sessionId: string; objectId: string }> = [];
  for (const item of targets) {
    const target = record(item);
    if (target.type !== 'page') continue;
    await request.validate();
    const sessionId = identifier(record(await send('Target.attachToTarget', { targetId: identifier(target.targetId), flatten: true })).sessionId);
    const tree = record(await send('Page.getFrameTree', {}, sessionId));
    const { executionContextId } = record(await send('Page.createIsolatedWorld', {
      frameId: identifier(record(record(tree.frameTree).frame).id),
      worldName: 'cindy-cloud-text',
    }, sessionId));
    const response = record(await send('Runtime.evaluate', {
      expression: focusedElement, contextId: executionContextId, silent: true,
    }, sessionId));
    if (response.exceptionDetails) throw new Error('Browser document changed');
    const objectId = record(response.result).objectId;
    if (typeof objectId === 'string') matches.push({ sessionId, objectId: identifier(objectId) });
  }
  if (matches.length !== 1) throw new Error('A single focused editable browser field is required');
  await request.validate();
  const target = matches[0]!;
  const response = record(await send('Runtime.callFunctionOn', {
    objectId: target.objectId,
    functionDeclaration: insertIntoPinnedElement,
    arguments: [{ value: request.text }],
    returnByValue: true,
    silent: true,
  }, target.sessionId));
  if (response.exceptionDetails || record(response.result).value !== true) throw new Error('Browser text delivery was not confirmed');
  await request.validate();
}

export async function insertFocusedBrowserText(request: FocusedBrowserTextRequest): Promise<void> {
  const dispatcher = new Agent();
  try {
    if (!Number.isSafeInteger(request.pid) || request.pid <= 0 || typeof request.text !== 'string'
      || !request.text || Array.from(request.text).length > 4096
      || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(request.text)
      || Array.from(request.text).some((character) => character.length === 1 && /[\ud800-\udfff]/.test(character)))
      throw new Error('Invalid browser text request');
    const deadline = Date.now() + 8000;
    const bounded = { ...request, validate: async () => {
      if (Date.now() >= deadline) throw new Error('Browser text deadline exceeded');
      await request.validate();
    } };
    const endpoint = new URL(request.cdpUrl);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
      || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
      throw new Error('A local managed browser is required');
    await bounded.validate();
    const response = await fetch(`${endpoint.origin}/json/version`, { dispatcher, redirect: 'error', signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error('Browser discovery unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Invalid browser discovery');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 8192) throw new Error('Invalid browser discovery');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const source = Buffer.concat(chunks).toString('utf8');
    const socket = new URL(identifier(record(JSON.parse(source)).webSocketDebuggerUrl));
    if (socket.protocol !== 'ws:' || socket.host !== endpoint.host || socket.username || socket.password
      || socket.search || socket.hash || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(socket.pathname))
      throw new Error('Browser endpoint changed');
    await withCdpSocket(socket.href, (send) => deliverFocusedBrowserText(bounded, send), {
      handshakeRetries: 0, handshakeTimeoutMs: 1500, commandTimeoutMs: 1500,
    });
  } catch {
    throw new Error('Cloud browser text unavailable or uncertain; refresh without retrying');
  } finally {
    await dispatcher.destroy();
  }
}
