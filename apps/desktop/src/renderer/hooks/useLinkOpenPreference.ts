import { getDesktopPreference, setDesktopPreference, clearDesktopPreference, useDesktopPreference, useDesktopPreferenceCustomized, __resetDesktopPreferencesForTests } from '../state/hostDesktopPreferences';

import { desktopPreferenceDefaults } from '../../shared/desktopPreferences';

export type LinkOpenPreference = 'sidebar' | 'external';
export type LinkOpenKind = 'web' | 'local';

export const LINK_OPEN_DEFAULTS: Record<LinkOpenKind, LinkOpenPreference> = {
  web: desktopPreferenceDefaults().webLinkOpenPreference,
  local: desktopPreferenceDefaults().localLinkOpenPreference,
};

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isIPv4Loopback(host: string): boolean {
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

/** 本地硬盘(file:)或本机 loopback(localhost / 127/8 / ::1)。不含局域网地址。 */
export function isLocalOpenUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = hostnameOf(parsed);
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1') return true;
    return isIPv4Loopback(host);
  } catch {
    return false;
  }
}

const field = (kind: LinkOpenKind) => kind === 'web' ? 'webLinkOpenPreference' as const : 'localLinkOpenPreference' as const;
export function getLinkOpenPreference(kind: LinkOpenKind): LinkOpenPreference { return getDesktopPreference(field(kind)); }
export function getLinkOpenPreferenceForUrl(url: string): LinkOpenPreference { return getLinkOpenPreference(isLocalOpenUrl(url) ? 'local' : 'web'); }
export function useLinkOpenPreference(kind: LinkOpenKind) {
  const key = field(kind);
  return { preference: useDesktopPreference(key), isCustomized: useDesktopPreferenceCustomized(key),
    setPreference: (next: LinkOpenPreference) => { void setDesktopPreference(key, next); },
    resetPreference: () => clearDesktopPreference(key) };
}
export const _resetLinkOpenPreferenceForTests = __resetDesktopPreferencesForTests;
