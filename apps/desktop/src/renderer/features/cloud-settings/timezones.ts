/** IANA identifiers stay on the wire. Offsets are display-only and follow DST. */
export const COMMON_TIMEZONES: Record<string, string> = {
  UTC: 'utc',
  'Asia/Shanghai': 'shanghai',
  'Asia/Hong_Kong': 'hongKong',
  'Asia/Taipei': 'taipei',
  'Asia/Tokyo': 'tokyo',
  'Asia/Seoul': 'seoul',
  'Asia/Singapore': 'singapore',
  'Asia/Kolkata': 'kolkata',
  'Asia/Dubai': 'dubai',
  'Europe/London': 'london',
  'Europe/Paris': 'paris',
  'Europe/Berlin': 'berlin',
  'America/New_York': 'newYork',
  'America/Los_Angeles': 'losAngeles',
  'Australia/Sydney': 'sydney',
};

export function timezoneOffset(zone: string, now = new Date()): string {
  try {
    const value = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value;
    return value?.replace('GMT', 'UTC') ?? zone;
  } catch {
    // Keep an existing server value visible instead of silently changing policy.
    return '';
  }
}

export function timezoneChoices(current: string): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  return [
    ...new Set([
      ...Object.keys(COMMON_TIMEZONES),
      ...(intl.supportedValuesOf?.('timeZone') ?? []),
      current,
    ]),
  ].filter(Boolean);
}
