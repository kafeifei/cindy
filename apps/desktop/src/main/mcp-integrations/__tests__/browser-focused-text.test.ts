import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configureManagedBrowserText,
  insertManagedBrowserText,
  ownedManagedBrowserEndpoint,
} from '../browser-focused-text';

const root = path.resolve('test-browser-runtime');
const data = {
  running: true,
  pid: 12,
  transport: 'cdp',
  profile: 'Cindy',
  headless: false,
  userDataDir: path.join(root, 'browser', 'Cindy', 'user-data'),
  cdpUrl: 'http://127.0.0.1:18800',
};

describe('managed browser text host', () => {
  it('rejects text before a managed browser provider is configured', async () => {
    await expect(
      insertManagedBrowserText({ pid: 12, text: '中文', validate: async () => {} }),
    ).rejects.toThrow('managed browser');
  });

  it('uses only a running owned profile endpoint', () => {
    expect(ownedManagedBrowserEndpoint({ ok: true, data }, root, 'Cindy', 12)).toBe(data.cdpUrl);
    expect(() => ownedManagedBrowserEndpoint({ ok: true, data }, undefined, 'Cindy', 12)).toThrow(
      'owned',
    );
    expect(() => ownedManagedBrowserEndpoint({ ok: false, data }, root, 'Cindy', 12)).toThrow(
      'owned',
    );
  });

  it.each([
    { pid: 99 },
    { pid: null },
    { running: false },
    { profile: 'Cindy-real' },
    { transport: 'chrome-mcp' },
    { attachOnly: true },
    { headless: true },
    { userDataDir: path.join(root, 'foreign', 'user-data') },
    { cdpUrl: null },
  ])('rejects an unsupported or unowned target: %j', (override) => {
    expect(() =>
      ownedManagedBrowserEndpoint({ ok: true, data: { ...data, ...override } }, root, 'Cindy', 12),
    ).toThrow('owned');
  });

  it('forwards the caller focus and lifetime guard without replacing it', async () => {
    const provider = vi.fn(async () => {});
    configureManagedBrowserText(provider);
    const request = { pid: 12, text: '中文😀', validate: vi.fn(async () => {}) };
    await insertManagedBrowserText(request);
    expect(provider).toHaveBeenCalledExactlyOnceWith(request);
  });
});
