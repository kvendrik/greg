import { Cron } from 'croner';
import type { Schedule } from './types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateTimezone(tz: string): ValidationResult {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid IANA timezone: ${tz}` };
  }
}

export function validateCronSchedule(expr: string, tz?: string): ValidationResult {
  try {
    new Cron(expr, tz ? { timezone: tz } : undefined);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

export function validateAtSchedule(at: string): ValidationResult {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return { valid: false, error: `Invalid date: ${at}` };
  }
  if (date.getTime() < Date.now()) {
    return { valid: false, error: 'Scheduled time is in the past' };
  }
  return { valid: true };
}

export function validateEverySchedule(everyMs: number): ValidationResult {
  if (typeof everyMs !== 'number' || !Number.isFinite(everyMs) || everyMs <= 0) {
    return { valid: false, error: 'everyMs must be a positive number' };
  }
  return { valid: true };
}

export function validateSchedule(schedule: Schedule): ValidationResult {
  switch (schedule.kind) {
    case 'cron':
      if (schedule.tz) {
        const tzResult = validateTimezone(schedule.tz);
        if (!tzResult.valid) return tzResult;
      }
      return validateCronSchedule(schedule.expr, schedule.tz);
    case 'every':
      return validateEverySchedule(schedule.everyMs);
    case 'at':
      return validateAtSchedule(schedule.at);
    default:
      return { valid: false, error: 'Unknown schedule kind' };
  }
}
