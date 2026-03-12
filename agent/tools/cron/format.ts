import type { Schedule } from './types';

export function formatSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'cron':
      return schedule.tz
        ? `cron ${schedule.expr} (${schedule.tz})`
        : `cron ${schedule.expr}`;
    case 'every':
      return `every ${schedule.everyMs}ms`;
    case 'at':
      return `at ${schedule.at}`;
    default:
      return String(schedule);
  }
}
