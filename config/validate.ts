import type { Config } from './types';

export function validate(config: Config): void {
  const primaryCount = config.models.filter((m) => m.role === 'primary').length;
  const fallbackCount = config.models.filter(
    (m) => m.role === 'fallback'
  ).length;

  if (primaryCount !== 1) {
    throw new Error(
      `Config models must have exactly one primary entry, got ${primaryCount}`
    );
  }
  if (fallbackCount !== 1) {
    throw new Error(
      `Config models must have exactly one fallback entry, got ${fallbackCount}`
    );
  }
}
