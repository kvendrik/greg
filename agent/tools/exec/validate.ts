import os from 'node:os';
import path from 'node:path';
import type { AllowedBins, AllowedProfiles } from './policy';

export function validateAllowBins(
  allowBins: AllowedBins,
  profiles: AllowedProfiles
): void {
  for (const [binPath, spec] of Object.entries(allowBins)) {
    const expanded = expandTildePath(binPath);
    if (!path.isAbsolute(expanded)) {
      throw new Error(
        `tools.guard.exec.allowBins key must be an absolute path (or start with ~/): "${binPath}"`
      );
    }

    for (const profileName of spec.profiles) {
      if (!profiles[profileName]) {
        throw new Error(
          `tools.guard.exec.allowBins references missing profile "${profileName}" for "${binPath}"`
        );
      }
    }
  }
}

export function validateProfiles(profiles: AllowedProfiles): void {
  for (const [profileName, profile] of Object.entries(profiles)) {
    validateDenyFlags(profileName, profile.denyFlags);
    validateSubcommands(profileName, profile.allowSubcommands);
    validateAllowFlags(profileName, profile.allowFlags);
  }
}

function validateDenyFlags(profileName: string, denyFlags: string[]): void {
  if (!Array.isArray(denyFlags)) {
    throw new Error(
      `tools.guard.exec.profiles.${profileName}.denyFlags must be an array`
    );
  }

  for (const flag of denyFlags) {
    if (typeof flag !== 'string' || !flag.startsWith('-')) {
      throw new Error(
        `tools.guard.exec.profiles.${profileName}.denyFlags entries must start with "-" and be strings`
      );
    }
  }
}

function validateSubcommands(
  profileName: string,
  allowSubcommands: 'all' | string[][]
): void {
  if (allowSubcommands === 'all') {
    return;
  }

  if (!Array.isArray(allowSubcommands)) {
    throw new Error(
      `tools.guard.exec.profiles.${profileName}.allowSubcommands must be "all" or an array`
    );
  }

  for (const subcommandPath of allowSubcommands) {
    if (
      !Array.isArray(subcommandPath) ||
      subcommandPath.length === 0 ||
      !subcommandPath.every(
        (token) => typeof token === 'string' && token.length > 0
      )
    ) {
      throw new Error(
        `tools.guard.exec.profiles.${profileName}.allowSubcommands entries must be non-empty string arrays`
      );
    }
  }
}

function validateAllowFlags(
  profileName: string,
  allowFlags: Record<string, { takesValue: boolean; value?: unknown }>
): void {
  for (const [flagName, flagSpec] of Object.entries(allowFlags)) {
    if (!flagName.startsWith('-')) {
      throw new Error(
        `tools.guard.exec.profiles.${profileName}.allowFlags key must start with "-" for "${flagName}"`
      );
    }

    if (typeof flagSpec.takesValue !== 'boolean') {
      throw new Error(
        `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.takesValue must be boolean`
      );
    }

    if (!flagSpec.takesValue && flagSpec.value !== undefined) {
      throw new Error(
        `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value is only allowed when takesValue is true`
      );
    }

    if (!flagSpec.takesValue || flagSpec.value === undefined) {
      continue;
    }

    const value = flagSpec.value as Record<string, unknown>;
    const valueType = value.type;

    if (valueType !== 'int' && valueType !== 'path') {
      throw new Error(
        `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.type must be "int" or "path"`
      );
    }

    if (valueType === 'int') {
      const min = value.min as number | undefined;
      const max = value.max as number | undefined;

      if (min !== undefined && !Number.isInteger(min)) {
        throw new Error(
          `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.min must be an integer when provided`
        );
      }
      if (max !== undefined && !Number.isInteger(max)) {
        throw new Error(
          `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.max must be an integer when provided`
        );
      }
      if (
        typeof min === 'number' &&
        typeof max === 'number' &&
        min > max
      ) {
        throw new Error(
          `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.min must be <= max`
        );
      }
    }
  }
}

function expandTildePath(inputPath: string): string {
  if (inputPath === '~') {
    return os.homedir();
  }
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}
