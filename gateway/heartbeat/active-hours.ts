import type { HeartbeatActiveHours } from './types';

/** Parse "HH:MM" or "H:MM" to minutes since midnight. "24:00" => 24*60. */
function parseTimeToMinutes(timeStr: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) return 0;
  const hour = Math.min(24, parseInt(match[1], 10));
  const minute = Math.min(59, parseInt(match[2], 10));
  return hour * 60 + minute;
}

/** Get current minutes since midnight in the given timezone (IANA) or host. */
function minutesSinceMidnightInTz(timezone?: string): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const parts = fmt.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

/** True if current time in the given timezone is inside [start, end). */
export function isWithinActiveHours(activeHours: HeartbeatActiveHours): boolean {
  const startMinutes = parseTimeToMinutes(activeHours.start);
  const endMinutes = parseTimeToMinutes(activeHours.end);
  const nowMinutes = minutesSinceMidnightInTz(activeHours.timezone);

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // e.g. 22:00 - 06:00 spans midnight
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
