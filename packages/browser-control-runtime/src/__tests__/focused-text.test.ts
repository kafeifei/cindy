import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { deliverFocusedBrowserText, insertFocusedBrowserText } from '../focused-text.js';

function harness() {
  const request = { pid: 12, text: '中文🙂', cdpUrl: 'http://127.0.0.1:18800/', validate: vi.fn(async () => {}) };
  const send = vi.fn(async (method: string, _params?: Record<string, unknown>, _session?: string): Promise<unknown> => {
    if (method === 'SystemInfo.getProcessInfo') return { processInfo: [{ type: 'browser', id: 12 }] };
    if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'tab' }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'session' };
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame' } } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 };
    if (method === 'Runtime.evaluate') return { result: { objectId: 'field' } };
    if (method === 'Runtime.callFunctionOn') return { result: { value: true } };
    throw new Error('Unexpected CDP command');
  });
  return { request, send };
}

describe('managed browser atomic text', () => {
  it('pins an isolated-world field and submits one argument without exposing text to discovery', async () => {
    const { request, send } = harness();
    request.text = '文'.repeat(4095) + '終';
    await deliverFocusedBrowserText(request, send);
    const writes = send.mock.calls.filter(([method]) => method === 'Runtime.callFunctionOn');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]).toMatchObject({ objectId: 'field', arguments: [{ value: request.text }], silent: true });
    expect(writes[0]?.[2]).toBe('session');
    expect(JSON.stringify(send.mock.calls.slice(0, -1))).not.toContain(request.text);
    expect(request.validate).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.some(([method]) => /Input\.|clipboard/i.test(method))).toBe(false);
  });

  it.each(['wrong-pid', 'no-focus', 'ambiguous', 'navigation', 'cancelled'])('does not deliver to an invalid target: %s', async (failure) => {
    const { request, send } = harness();
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (method, ...args) => {
      if (failure === 'wrong-pid' && method === 'SystemInfo.getProcessInfo') return { processInfo: [{ type: 'browser', id: 99 }] };
      if (failure === 'no-focus' && method === 'Runtime.evaluate') return { result: { value: null } };
      if (failure === 'ambiguous' && method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'one' }, { type: 'page', targetId: 'two' }] };
      if (failure === 'navigation' && method === 'Runtime.evaluate') return { exceptionDetails: {} };
      return original(method, ...args);
    });
    if (failure === 'cancelled') request.validate.mockRejectedValueOnce(new Error('expired'));
    await expect(deliverFocusedBrowserText(request, send)).rejects.toThrow();
    expect(send.mock.calls.some(([method]) => method === 'Runtime.callFunctionOn')).toBe(false);
  });

  it('never retries an uncertain atomic insertion', async () => {
    const { request, send } = harness();
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (method, ...args) => {
      if (method === 'Runtime.callFunctionOn') throw new Error('transport lost');
      return original(method, ...args);
    });
    await expect(deliverFocusedBrowserText(request, send)).rejects.toThrow();
    expect(send.mock.calls.filter(([method]) => method === 'Runtime.callFunctionOn')).toHaveLength(1);
  });

  it.each(['https://127.0.0.1:18800', 'http://localhost:18800', 'http://10.0.0.1:18800', 'http://127.0.0.1:18800/?secret=test'])('rejects unapproved discovery endpoints: %s', async (cdpUrl) => {
    const { request } = harness();
    await expect(insertFocusedBrowserText({ ...request, cdpUrl })).rejects.toThrow('without retrying');
    expect(request.validate).not.toHaveBeenCalled();
  });

  it.each(['valid', 'focus-changed', 'document-changed', 'disabled', 'readonly', 'over-limit', 'newline', 'unsupported'])('checks the pinned field in the same script as insertion: %s', async (condition) => {
    const { request, send } = harness();
    await deliverFocusedBrowserText(request, send);
    const write = send.mock.calls.find(([method]) => method === 'Runtime.callFunctionOn')!;
    class Input {
      type = 'text';
      isConnected = true;
      disabled = condition === 'disabled';
      readOnly = condition === 'readonly';
      value = '前后';
      selectionStart = 1;
      selectionEnd = 1;
      maxLength = condition === 'over-limit' ? 3 : 100;
      ownerDocument: unknown;
    }
    class Textarea {}
    const field = new Input();
    const document = {
      activeElement: condition === 'focus-changed' ? new Input() : field,
      visibilityState: 'visible',
      hasFocus: () => true,
      queryCommandSupported: () => condition !== 'unsupported',
      execCommand: vi.fn(() => true),
    };
    field.ownerDocument = condition === 'document-changed' ? {} : document;
    const execute = runInNewContext(`(${write[1]!.functionDeclaration})`, { document, HTMLInputElement: Input, HTMLTextAreaElement: Textarea });
    const text = condition === 'newline' ? '中\n文' : '中文🙂';
    expect(execute.call(field, text)).toBe(condition === 'valid');
    expect(document.execCommand).toHaveBeenCalledTimes(condition === 'valid' ? 1 : 0);
    expect(field.value).toBe('前后');
  });
});
