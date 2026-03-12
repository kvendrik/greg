import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { isWithinActiveHours } from '../active-hours';

/** Fixed date for tests; time is interpreted in UTC when using timezone: 'UTC'. */
const UTC_BASE = '2025-03-12';

function utcTime(hour: number, minute: number): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  return new Date(`${UTC_BASE}T${pad(hour)}:${pad(minute)}:00.000Z`);
}

describe('heartbeat', () => {
  describe('isWithinActiveHours()', () => {
    const tz = 'UTC';

    afterEach(() => {
      setSystemTime();
    });

    it('returns true when window is full day (00:00 to 24:00) at any time', () => {
      setSystemTime(utcTime(0, 0));
      expect(isWithinActiveHours({ start: '00:00', end: '24:00', timezone: tz })).toBe(true);
      setSystemTime(utcTime(12, 0));
      expect(isWithinActiveHours({ start: '00:00', end: '24:00', timezone: tz })).toBe(true);
      setSystemTime(utcTime(23, 59));
      expect(isWithinActiveHours({ start: '00:00', end: '24:00', timezone: tz })).toBe(true);
    });

    it('returns false when window is empty (same start and end)', () => {
      setSystemTime(utcTime(12, 0));
      expect(isWithinActiveHours({ start: '12:00', end: '12:00', timezone: tz })).toBe(false);
      setSystemTime(utcTime(0, 0));
      expect(isWithinActiveHours({ start: '00:00', end: '00:00', timezone: tz })).toBe(false);
    });

    it('returns false when window is 24:00 to 00:00 at any time', () => {
      setSystemTime(utcTime(0, 0));
      expect(isWithinActiveHours({ start: '24:00', end: '00:00', timezone: tz })).toBe(false);
      setSystemTime(utcTime(12, 0));
      expect(isWithinActiveHours({ start: '24:00', end: '00:00', timezone: tz })).toBe(false);
    });

    it('within same-day window: inside returns true, outside returns false', () => {
      const window = { start: '08:00', end: '22:00', timezone: tz };
      setSystemTime(utcTime(7, 0));
      expect(isWithinActiveHours(window)).toBe(false);
      setSystemTime(utcTime(8, 0));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(10, 30));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(21, 59));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(22, 0));
      expect(isWithinActiveHours(window)).toBe(false);
    });

    it('within midnight-spanning window (22:00 to 06:00): inside/outside correct', () => {
      const window = { start: '22:00', end: '06:00', timezone: tz };
      setSystemTime(utcTime(21, 0));
      expect(isWithinActiveHours(window)).toBe(false);
      setSystemTime(utcTime(22, 0));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(23, 0));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(2, 0));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(5, 59));
      expect(isWithinActiveHours(window)).toBe(true);
      setSystemTime(utcTime(6, 0));
      expect(isWithinActiveHours(window)).toBe(false);
      setSystemTime(utcTime(12, 0));
      expect(isWithinActiveHours(window)).toBe(false);
    });

    it('accepts single-digit hour and parses correctly', () => {
      setSystemTime(utcTime(8, 30));
      expect(isWithinActiveHours({ start: '8:00', end: '9:00', timezone: tz })).toBe(true);
      setSystemTime(utcTime(9, 0));
      expect(isWithinActiveHours({ start: '8:00', end: '9:00', timezone: tz })).toBe(false);
    });

    it('accepts trimmed whitespace in start/end', () => {
      setSystemTime(utcTime(12, 0));
      expect(
        isWithinActiveHours({ start: '  08:00  ', end: '  17:00  ', timezone: tz })
      ).toBe(true);
    });

    it('one-minute window: inclusive start, exclusive end', () => {
      setSystemTime(utcTime(12, 0));
      expect(
        isWithinActiveHours({ start: '12:00', end: '12:01', timezone: tz })
      ).toBe(true);
      setSystemTime(utcTime(12, 1));
      expect(
        isWithinActiveHours({ start: '12:00', end: '12:01', timezone: tz })
      ).toBe(false);
    });
  });
});
