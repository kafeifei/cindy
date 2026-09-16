import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertLinuxDesktopText } from '../linuxInputHost';
import {
  acquireHumanDesktopInput,
  holdDesktopInputAction,
  withAgentDesktopInput,
} from '../inputOwnership';

const fixture = vi.hoisted(() => ({
  insertText: vi.fn(),
  browserText: vi.fn(),
  focused: true,
}));
vi.mock('electron', () => ({
  app: {},
  screen: {},
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        isVisible: () => true,
        isFocused: () => fixture.focused,
        getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0]),
        webContents: {
          isDestroyed: () => false,
          isFocused: () => fixture.focused,
          insertText: fixture.insertText,
        },
      },
    ],
  },
}));
vi.mock('../../mcp-integrations/browser-focused-text', () => ({
  insertManagedBrowserText: fixture.browserText,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.focused = true;
});

describe('Linux text targets and shared input ownership', () => {
  it('uses the focused Cindy window native text operation without evaluating page scripts', async () => {
    const validate = vi.fn(async () => {});
    const text = '中'.repeat(4096);
    await insertLinuxDesktopText({ pid: process.pid, windowId: 42, text, validate });
    expect(fixture.insertText).toHaveBeenCalledExactlyOnceWith(text);
    expect(fixture.browserText).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('refuses a non-focused Cindy window and never redirects to another field', async () => {
    fixture.focused = false;
    await expect(
      insertLinuxDesktopText({
        pid: process.pid,
        windowId: 42,
        text: 'secret',
        validate: async () => {},
      }),
    ).rejects.toThrow('TEXT_UNSUPPORTED');
    expect(fixture.insertText).not.toHaveBeenCalled();
    expect(fixture.browserText).not.toHaveBeenCalled();
  });

  it('delegates other PIDs to the existing owned-browser check', async () => {
    const request = {
      pid: process.pid + 1,
      windowId: 42,
      text: '中文😀',
      validate: async () => {},
    };
    await insertLinuxDesktopText(request);
    expect(fixture.browserText).toHaveBeenCalledExactlyOnceWith(request);
    expect(fixture.insertText).not.toHaveBeenCalled();
  });

  it('excludes Agent actions while upstream remote control owns input', async () => {
    const release = acquireHumanDesktopInput();
    try {
      await expect(withAgentDesktopInput(async () => {})).rejects.toThrow('person');
      expect(holdDesktopInputAction).toThrow('person');
    } finally {
      release();
    }
    await expect(withAgentDesktopInput(async () => {})).resolves.toBeUndefined();
  });

  it('keeps asynchronous action cleanup exclusive until its idempotent release', () => {
    const release = holdDesktopInputAction();
    try {
      expect(acquireHumanDesktopInput).toThrow('BUSY');
    } finally {
      release();
    }
    const releaseHuman = acquireHumanDesktopInput();
    release();
    try {
      expect(acquireHumanDesktopInput).toThrow('BUSY');
    } finally {
      releaseHuman();
    }
  });
});
