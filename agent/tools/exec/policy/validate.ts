import os from 'node:os';
import path from 'node:path';
import type { AllowedBins, AllowedProfiles } from './policy';
import type { Config } from '../../../../config/types';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const which = require('which') as {
  sync: (cmd: string, opt?: { nothrow?: boolean }) => string | null;
};

type GuardValidationMessages = {
  info: string[];
  warnings: string[];
  errors: string[];
};

export function validate(config: Config): GuardValidationMessages {
  const messages: GuardValidationMessages = {
    info: [],
    warnings: [],
    errors: [],
  };

  const guardConfig = config.tools.guard;

  if (!guardConfig.enabled) {
    messages.warnings.push('Guard is disabled (tools.guard.enabled is false)');
    return messages;
  }

  if (guardConfig.ask) {
    if (!config.telegram) {
      messages.warnings.push(
        'Telegram is not configured. Either configure it, use the TUI, or use a custom client with a configured reply callback.'
      );
    }
  } else {
    messages.warnings.push(
      'Asking permission for tool calls is disabled (tools.guard.ask is false)'
    );
  }

  if (!guardConfig.ask) {
    messages.warnings.push(
      'tools.guard.ask is off (execve calls will be denied instead of prompting for permission)'
    );
  }

  const execConfig = guardConfig.exec;

  if (!execConfig) {
    messages.errors.push(
      'tools.guard.exec is not configured (exec allowlist missing)'
    );
    return messages;
  }

  validateProfiles(execConfig.profiles);
  validateAllowBins(execConfig.allowBins, execConfig.profiles);

  if (messages.errors.length > 0) {
    return messages;
  }

  // Verify each configured bin resolves to an executable on PATH.
  let _notFoundBins = 0;
  let foundBins = 0;
  for (const [binPath] of Object.entries(execConfig.allowBins)) {
    const expanded = expandTildePath(binPath);
    const resolved = which.sync(expanded, { nothrow: true });
    if (!resolved) {
      _notFoundBins++;
      messages.errors.push(
        `tools.guard.exec.allowBins key "${binPath}" does not resolve to an executable file (checked at "${expanded}")`
      );
    } else {
      foundBins++;
    }
  }

  messages.info.push(
    `${foundBins}/${Object.keys(execConfig.allowBins).length} bins resolved to an executable file (tools.guard.exec.allowBins)`
  );

  return messages;

  function validateAllowBins(
    allowBins: AllowedBins,
    profiles: AllowedProfiles
  ): void {
    for (const [binPath, spec] of Object.entries(allowBins)) {
      const expanded = expandTildePath(binPath);

      if (!path.isAbsolute(expanded)) {
        messages.errors.push(
          `tools.guard.exec.allowBins key must be an absolute path (or start with ~/): "${binPath}"`
        );
        continue;
      }

      for (const profileName of spec.profiles) {
        const profileNameString =
          typeof profileName === 'string' ? profileName : String(profileName);

        if (!Object.hasOwn(profiles, profileNameString)) {
          messages.errors.push(
            `tools.guard.exec.allowBins references missing profile "${profileNameString}" for "${binPath}"`
          );
          continue;
        }
      }
    }
  }

  function validateProfiles(profiles: AllowedProfiles): void {
    for (const [profileName, profile] of Object.entries(profiles)) {
      validateDenyFlags(profileName, profile.denyFlags);
      validateSubcommands(profileName, profile.allowSubcommands);

      // Semantics:
      // - allowFlags defined => allowlist mode (only listed flags permitted)
      // - allowFlags undefined => denylist mode (allow all except denyFlags)
      if (typeof profile.allowFlags === 'undefined') {
        // In denylist mode, we require at least one deny rule, otherwise the
        // profile effectively becomes "allow all flags" and is too risky.
        if (!Array.isArray(profile.denyFlags) || profile.denyFlags.length === 0) {
          messages.errors.push(
            `tools.guard.exec.profiles.${profileName} must define allowFlags, or provide a non-empty denyFlags array (denylist mode)`
          );
        }
      } else {
        validateAllowFlags(profileName, profile.allowFlags);
      }
    }
  }

  function validateDenyFlags(profileName: string, denyFlags: string[]): void {
    if (!Array.isArray(denyFlags)) {
      messages.errors.push(
        `tools.guard.exec.profiles.${profileName}.denyFlags must be an array`
      );
      return;
    }

    for (const flag of denyFlags) {
      if (typeof flag !== 'string' || !flag.startsWith('-')) {
        messages.errors.push(
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
      messages.errors.push(
        `tools.guard.exec.profiles.${profileName}.allowSubcommands must be "all" or an array`
      );
      return;
    }

    for (const subcommandPath of allowSubcommands) {
      if (
        !Array.isArray(subcommandPath) ||
        subcommandPath.length === 0 ||
        !subcommandPath.every(
          (token) => typeof token === 'string' && token.length > 0
        )
      ) {
        messages.errors.push(
          `tools.guard.exec.profiles.${profileName}.allowSubcommands entries must be non-empty string arrays`
        );
      }
    }
  }

  function validateAllowFlags(
    profileName: string,
    allowFlags:
      | Record<string, { takesValue: boolean; value?: unknown }>
      | undefined
  ): void {
    if (typeof allowFlags === 'undefined') {
      return;
    }
    for (const [flagName, flagSpec] of Object.entries(allowFlags)) {
      if (!flagName.startsWith('-')) {
        messages.errors.push(
          `tools.guard.exec.profiles.${profileName}.allowFlags key must start with "-" for "${flagName}"`
        );
        continue;
      }

      if (typeof flagSpec.takesValue !== 'boolean') {
        messages.errors.push(
          `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.takesValue must be boolean`
        );
        continue;
      }

      if (!flagSpec.takesValue && flagSpec.value !== undefined) {
        messages.errors.push(
          `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value is only allowed when takesValue is true`
        );
        continue;
      }

      if (!flagSpec.takesValue || flagSpec.value === undefined) {
        continue;
      }

      const value = flagSpec.value as Record<string, unknown>;
      const valueType = value.type;

      if (valueType !== 'int' && valueType !== 'path') {
        messages.errors.push(
          `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.type must be "int" or "path"`
        );
        continue;
      }

      if (valueType === 'int') {
        const min = value.min as number | undefined;
        const max = value.max as number | undefined;

        if (min !== undefined && !Number.isInteger(min)) {
          messages.errors.push(
            `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.min must be an integer when provided`
          );
        }
        if (max !== undefined && !Number.isInteger(max)) {
          messages.errors.push(
            `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.max must be an integer when provided`
          );
        }
        if (typeof min === 'number' && typeof max === 'number' && min > max) {
          messages.errors.push(
            `tools.guard.exec.profiles.${profileName}.allowFlags.${flagName}.value.min must be <= max`
          );
        }
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
