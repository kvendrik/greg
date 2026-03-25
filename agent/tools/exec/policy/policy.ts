import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { ToolContext } from '../../../types';
import { getWorkspacePath } from '../../../utilities';
import { resolveBin } from '../../utilities/resolve-bin';
import type { ExecvePipelineToolParams, ExecveToolParams } from '../tools';
import type { PolicyEvaluation } from '../../utilities/policy/policy';
import { expandPath } from '../../files/filesystem';

type Profile = {
  allowSubcommands: 'all' | string[][];
  allowFlags:
    | Record<
        string,
        {
          takesValue: boolean;
          value?:
            | {
                type: 'int';
                min: number | undefined;
                max: number | undefined;
              }
            | { type: 'path' };
        }
      >
    | undefined;
  denyFlags: string[];
};

export type AllowedProfiles = Record<string, Profile>;
export type AllowedBinsEntry<P extends AllowedProfiles = AllowedProfiles> = {
  profiles: (keyof P)[];
};
export type AllowedBins<P extends AllowedProfiles = AllowedProfiles> = Record<
  string,
  AllowedBinsEntry<P>
>;

export const execPolicyToolNames = ['execve', 'execve_pipeline'] as const;

export function evaluate(input: {
  toolName: string;
  params: unknown;
  context: ToolContext;
}): PolicyEvaluation {
  if (input.toolName === 'execve') {
    return evaluateExecve(input.params as ExecveToolParams, input.context);
  }
  if (input.toolName === 'execve_pipeline') {
    return evaluatePipeline(
      input.params as ExecvePipelineToolParams,
      input.context
    );
  }
  return { allowed: true, reason: null };
}

function evaluateExecve(
  params: ExecveToolParams,
  context: ToolContext
): PolicyEvaluation {
  const policyResult = evaluateExecCommand({
    command: params.command,
    args: params.args,
    context,
    kindPrefix: 'execve',
  });
  return policyResult;
}

function evaluatePipeline(
  params: ExecvePipelineToolParams,
  context: ToolContext
): PolicyEvaluation {
  const commands = params.commands;
  for (const [index, step] of commands.entries()) {
    const stepPolicyResult = evaluateExecCommand({
      command: step.command,
      args: step.args,
      context,
      kindPrefix: `execve_pipeline.step_${index}`,
    });
    if (!stepPolicyResult.allowed) {
      return stepPolicyResult;
    }
  }
  return { allowed: true, reason: null };
}

function evaluateExecCommand(params: {
  command: string;
  args: string[];
  context: ToolContext;
  kindPrefix: string;
}): PolicyEvaluation {
  const execConfig = params.context.config.tools.guard.exec;

  const resolvedCwd = path.resolve(getWorkspacePath(params.context.config));

  if (!execConfig) {
    return {
      allowed: false,
      reason:
        'Command not allowed: tools.guard.exec is not configured. Configure allowResolvedBins and profiles.',
    };
  }

  let resolvedCommandPath: string;
  try {
    resolvedCommandPath = resolveCommandPath(params.command, resolvedCwd);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `Command not allowed: failed to resolve binary "${params.command}". ${errorMessage}`,
    };
  }
  const allowedBin = findAllowedBinConfig(
    execConfig.allowBins,
    resolvedCommandPath
  );

  if (!allowedBin) {
    return {
      allowed: false,
      reason: `Command not allowed: resolved binary "${resolvedCommandPath}" is not in tools.guard.exec.allowResolvedBins.`,
    };
  }

  let lastDenial: PolicyEvaluation = {
    allowed: false,
    reason: `Command not allowed: no matching profile found for "${resolvedCommandPath}".`,
  };

  for (const profileName of allowedBin.profiles) {
    if (!Object.hasOwn(execConfig.profiles, profileName)) {
      lastDenial = {
        allowed: false,
        reason: `Command not allowed: profile "${profileName}" not found for "${resolvedCommandPath}".`,
      };
      continue;
    }
    const profile = execConfig.profiles[profileName];

    const argvResult = evaluateArgvAgainstProfile({
      args: params.args,
      profile,
      cwd: resolvedCwd,
      kindPrefix: params.kindPrefix,
      context: params.context,
    });

    if (argvResult.allowed) {
      return { allowed: true, reason: null };
    }

    lastDenial = argvResult;
  }

  return lastDenial;
}

function evaluateArgvAgainstProfile(params: {
  args: string[];
  profile: Profile;
  cwd: string;
  kindPrefix: string;
  context: ToolContext;
}): PolicyEvaluation {
  const subcommandTokens: string[] = [];
  for (let index = 0; index < params.args.length; index += 1) {
    const token = params.args[index] ?? '';
    if (!token.startsWith('-')) {
      subcommandTokens.push(token);
      continue;
    }

    if (token.startsWith('--')) {
      const longFlagResult = evaluateLongFlag({
        token,
        args: params.args,
        index,
        allowFlags: params.profile.allowFlags,
        denyFlags: params.profile.denyFlags,
        cwd: params.cwd,
        kindPrefix: params.kindPrefix,
        context: params.context,
      });

      if (!longFlagResult.allowed) {
        return longFlagResult;
      }

      index += longFlagResult.consumedNextTokenCount;
      continue;
    }

    const shortFlagResult = evaluateShortFlag({
      token,
      args: params.args,
      index,
      allowFlags: params.profile.allowFlags,
      denyFlags: params.profile.denyFlags,
      cwd: params.cwd,
      kindPrefix: params.kindPrefix,
      context: params.context,
    });

    if (!shortFlagResult.allowed) {
      return shortFlagResult;
    }

    index += shortFlagResult.consumedNextTokenCount;
  }

  if (params.profile.allowSubcommands === 'all') {
    return { allowed: true, reason: null };
  }

  const matchesSubcommand = params.profile.allowSubcommands.some(
    (allowedPath) => isTokenPathGlobMatch(subcommandTokens, allowedPath)
  );
  if (!matchesSubcommand) {
    return {
      allowed: false,
      reason: `Command not allowed: subcommands "${subcommandTokens.join(' ')}" are not allowed by profile.`,
    };
  }

  return { allowed: true, reason: null };
}

function evaluateLongFlag(params: {
  token: string;
  args: string[];
  index: number;
  denyFlags: Profile['denyFlags'];
  allowFlags: Profile['allowFlags'];
  cwd: string;
  kindPrefix: string;
  context: ToolContext;
}):
  | {
      allowed: true;
      reason: null;
      consumedNextTokenCount: number;
    }
  | {
      allowed: false;
      reason: string;
      consumedNextTokenCount: number;
    } {
  const hasInlineValue = params.token.includes('=');
  const flagName = hasInlineValue
    ? params.token.slice(0, params.token.indexOf('='))
    : params.token;
  if (params.denyFlags.includes(flagName)) {
    return {
      allowed: false,
      reason: `Command not allowed: denied flag "${flagName}" is blocked by profile (${params.kindPrefix}).`,
      consumedNextTokenCount: 0,
    };
  }

  // Denylist mode: allow all flags except those in denyFlags.
  if (typeof params.allowFlags === 'undefined') {
    if (hasInlineValue) {
      return {
        allowed: true,
        reason: null,
        consumedNextTokenCount: 0,
      };
    }

    const nextToken = params.args[params.index + 1];
    const nextTokenLooksLikeValue =
      typeof nextToken === 'string' && !nextToken.startsWith('-');

    return {
      allowed: true,
      reason: null,
      // Best-effort heuristic for argv parsing: if the next token doesn't
      // look like another flag, treat it as the value.
      consumedNextTokenCount: nextTokenLooksLikeValue ? 1 : 0,
    };
  }

  // Allowlist mode: only allow flags present in allowFlags.
  if (!Object.hasOwn(params.allowFlags, flagName)) {
    return {
      allowed: false,
      reason: `Command not allowed: unlisted flag "${flagName}" (${params.kindPrefix}).`,
      consumedNextTokenCount: 0,
    };
  }
  const flagSpec = params.allowFlags[flagName];

  if (!flagSpec.takesValue && hasInlineValue) {
    return {
      allowed: false,
      reason: `Command not allowed: flag "${flagName}" does not accept a value.`,
      consumedNextTokenCount: 0,
    };
  }

  if (!flagSpec.takesValue) {
    return { allowed: true, reason: null, consumedNextTokenCount: 0 };
  }

  const flagValue = hasInlineValue
    ? params.token.slice(params.token.indexOf('=') + 1)
    : params.args[params.index + 1];

  if (typeof flagValue === 'undefined') {
    return {
      allowed: false,
      reason: `Command not allowed: missing value for flag "${flagName}".`,
      consumedNextTokenCount: 0,
    };
  }

  const valuePolicyResult = validateFlagValue({
    flagName,
    value: flagValue,
    spec: flagSpec,
    cwd: params.cwd,
    context: params.context,
  });

  if (!valuePolicyResult.allowed) {
    return { ...valuePolicyResult, consumedNextTokenCount: 0 };
  }

  return {
    allowed: true,
    reason: null,
    consumedNextTokenCount: hasInlineValue ? 0 : 1,
  };
}

function evaluateShortFlag(params: {
  token: string;
  args: string[];
  index: number;
  denyFlags: Profile['denyFlags'];
  allowFlags: Profile['allowFlags'];
  cwd: string;
  kindPrefix: string;
  context: ToolContext;
}):
  | {
      allowed: true;
      reason: null;
      consumedNextTokenCount: number;
    }
  | {
      allowed: false;
      reason: string;
      consumedNextTokenCount: number;
    } {
  if (params.token.length > 2) {
    const bundledFlags = params.token
      .slice(1)
      .split('')
      .map((flag) => `-${flag}`);
    for (const bundledFlag of bundledFlags) {
      if (params.denyFlags.includes(bundledFlag)) {
        return {
          allowed: false,
          reason: `Command not allowed: denied bundled flag "${bundledFlag}" is blocked by profile (${params.kindPrefix}).`,
          consumedNextTokenCount: 0,
        };
      }
      if (typeof params.allowFlags !== 'undefined') {
        if (!Object.hasOwn(params.allowFlags, bundledFlag)) {
          return {
            allowed: false,
            reason: `Command not allowed: unlisted bundled flag "${bundledFlag}" (${params.kindPrefix}).`,
            consumedNextTokenCount: 0,
          };
        }
        const bundledSpec = params.allowFlags[bundledFlag];
        if (bundledSpec.takesValue) {
          return {
            allowed: false,
            reason: `Command not allowed: bundled short flags are only valid for takesValue:false flags. Offending flag "${bundledFlag}".`,
            consumedNextTokenCount: 0,
          };
        }
      }
    }
    return { allowed: true, reason: null, consumedNextTokenCount: 0 };
  }

  if (params.denyFlags.includes(params.token)) {
    return {
      allowed: false,
      reason: `Command not allowed: denied flag "${params.token}" is blocked by profile (${params.kindPrefix}).`,
      consumedNextTokenCount: 0,
    };
  }

  // Denylist mode: allow all flags except those in denyFlags.
  if (typeof params.allowFlags === 'undefined') {
    const nextToken = params.args[params.index + 1];
    const nextTokenLooksLikeValue =
      typeof nextToken === 'string' && !nextToken.startsWith('-');

    return {
      allowed: true,
      reason: null,
      // Best-effort heuristic for argv parsing (see evaluateLongFlag()).
      consumedNextTokenCount: nextTokenLooksLikeValue ? 1 : 0,
    };
  }

  // Allowlist mode: only allow flags present in allowFlags.
  if (!Object.hasOwn(params.allowFlags, params.token)) {
    return {
      allowed: false,
      reason: `Command not allowed: unlisted flag "${params.token}" (${params.kindPrefix}).`,
      consumedNextTokenCount: 0,
    };
  }
  const flagSpec = params.allowFlags[params.token];
  if (!flagSpec.takesValue) {
    return { allowed: true, reason: null, consumedNextTokenCount: 0 };
  }

  const flagValue = params.args[params.index + 1];
  if (typeof flagValue === 'undefined') {
    return {
      allowed: false,
      reason: `Command not allowed: missing value for flag "${params.token}".`,
      consumedNextTokenCount: 0,
    };
  }
  const valuePolicyResult = validateFlagValue({
    flagName: params.token,
    value: flagValue,
    spec: flagSpec,
    cwd: params.cwd,
    context: params.context,
  });

  if (!valuePolicyResult.allowed) {
    return { ...valuePolicyResult, consumedNextTokenCount: 0 };
  }

  return { allowed: true, reason: null, consumedNextTokenCount: 1 };
}

function validateFlagValue(params: {
  flagName: string;
  value: string;
  spec: NonNullable<Profile['allowFlags']>[string] | undefined;
  cwd: string;
  context: ToolContext;
}): { allowed: true; reason: null } | { allowed: false; reason: string } {
  if (!params.spec) {
    return { allowed: true, reason: null };
  }
  const valueSpec = params.spec.value;
  if (valueSpec?.type === 'int') {
    const parsedValue = Number.parseInt(params.value, 10);
    if (!Number.isInteger(parsedValue)) {
      return {
        allowed: false,
        reason: `Command not allowed: flag "${params.flagName}" requires an integer value.`,
      };
    }
    const min = valueSpec.min;
    const max = valueSpec.max;
    if (typeof min === 'number' && Number.isInteger(min) && parsedValue < min) {
      return {
        allowed: false,
        reason: `Command not allowed: flag "${params.flagName}" value ${parsedValue} is below min ${min}.`,
      };
    }
    if (typeof max === 'number' && Number.isInteger(max) && parsedValue > max) {
      return {
        allowed: false,
        reason: `Command not allowed: flag "${params.flagName}" value ${parsedValue} is above max ${max}.`,
      };
    }
    return { allowed: true, reason: null };
  }

  return { allowed: true, reason: null };
}

function resolveCommandPath(command: string, cwd: string): string {
  if (path.isAbsolute(command) || command.includes('/')) {
    return realpathSync(path.resolve(cwd, command));
  }
  return resolveBin(command);
}

function findAllowedBinConfig(
  allowResolvedBins: AllowedBins,
  resolvedCommandPath: string
): AllowedBinsEntry | undefined {
  for (const [configuredPath, configuredBin] of Object.entries(
    allowResolvedBins
  )) {
    if (resolveConfiguredPath(configuredPath) === resolvedCommandPath) {
      return configuredBin;
    }
  }
  return undefined;
}

function resolveConfiguredPath(configuredPath: string): string {
  const expandedPath = expandPath(configuredPath);
  const absolutePath = path.resolve(expandedPath);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

function isTokenPathGlobMatch(tokens: string[], pattern: string[]): boolean {
  // Token globbing for subcommands:
  // - '*' matches exactly one token
  // - '**' matches any number of tokens (including zero)
  let tokenIndex = 0;
  let patternIndex = 0;

  let lastDoubleStarPatternIndex = -1;
  let lastDoubleStarTokenIndex = -1;

  while (tokenIndex < tokens.length) {
    const patternToken = pattern[patternIndex];
    const currentToken = tokens[tokenIndex];

    if (
      typeof patternToken === 'string' &&
      (patternToken === '*' || patternToken === currentToken)
    ) {
      tokenIndex += 1;
      patternIndex += 1;
      continue;
    }

    if (patternToken === '**') {
      lastDoubleStarPatternIndex = patternIndex;
      lastDoubleStarTokenIndex = tokenIndex;
      patternIndex += 1; // try to match empty first
      continue;
    }

    if (lastDoubleStarPatternIndex !== -1) {
      // Backtrack: let '**' consume one more token.
      lastDoubleStarTokenIndex += 1;
      tokenIndex = lastDoubleStarTokenIndex;
      patternIndex = lastDoubleStarPatternIndex + 1;
      continue;
    }

    return false;
  }

  // Remaining pattern tokens can only match if they are all '**' (matching empty).
  while (patternIndex < pattern.length && pattern[patternIndex] === '**') {
    patternIndex += 1;
  }

  return patternIndex === pattern.length;
}
