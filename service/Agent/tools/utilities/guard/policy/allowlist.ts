import type { AgentConfig, AllowList, AllowListEntry } from '../../../../types';
import { getWorkspacePath } from '../../../../utilities';
import path from 'node:path';
import fs from 'node:fs';
import { parseCommand } from './command-parser/command-parser';
import type { ParsedCommandSegment } from './command-parser/command-parser';
import { defaultExecAllowlist } from './default_exec_allowlist';

/**
 * Resolve the allowlist entry for a given shell command.
 *
 * Allowlist keys can use:
 *
 * - **Exact command syntax**
 *
 *   ```json
 *   { "ls -la": { "trusted": false, "allow": true } }
 *   ```
 *
 * - **Base command syntax** (matches any args)
 *
 *   ```json
 *   { "ls": { "trusted": false, "allow": true } }
 *   // matches "ls -la"
 *   ```
 *
 * - **Command-with-subcommands syntax**
 *
 *   ```json
 *   { "git status": { "trusted": false, "allow": true } }   // matches "git status -sb"
 *   { "npm run build": { "trusted": true, "allow": true } } // matches "npm run build --watch"
 *   ```
 *
 * - **Wildcard syntax** (key ends with " *", matches by prefix on commandWithSubcommands)
 *
 *   ```json
 *   { "cd *": { "trusted": false, "allow": true } }      // matches "cd repo", "cd src/app", etc.
 *   { "npm run *": { "trusted": false, "allow": true } } // matches "npm run dev", "npm run build", etc.
 *   ```
 */
export function getAllowlistForCommand(
  command: string,
  config: AgentConfig
): AllowListEntry {
  const configAllowlist = config.tools.guard?.allowlist?.exec;

  // When a config-level exec allowlist is provided, treat it (together with
  // any workspace-level allowlist) as authoritative and do NOT include the
  // built-in defaults. This lets users fully override default trust/allow
  // behavior when they opt in to a custom allowlist.
  const mergedAllowlist: AllowList = configAllowlist
    ? {}
    : { ...defaultExecAllowlist };

  const workspaceAllowlistPath = path.join(
    getWorkspacePath(config),
    'exec_allowlist.json'
  );

  if (fs.existsSync(workspaceAllowlistPath)) {
    const workspaceAllowlistData: AllowList = JSON.parse(
      fs.readFileSync(workspaceAllowlistPath, 'utf8')
    );
    Object.assign(mergedAllowlist, workspaceAllowlistData);
  }

  if (configAllowlist) {
    Object.assign(mergedAllowlist, configAllowlist);
  }

  if (Object.keys(mergedAllowlist).length === 0) {
    return { trusted: false, allow: false };
  }

  const normalizedAllowlist =
    normalizeAllowlistWithResolvedCommands(mergedAllowlist);

  return getAllowlistForCommandFromList(command, normalizedAllowlist);
}

function normalizeAllowlistWithResolvedCommands(list: AllowList): AllowList {
  const normalized: AllowList = { ...list };

  for (const [rawKey, entry] of Object.entries(list)) {
    const parsed = parseCommand(rawKey);

    if (!parsed.segments.length) continue;

    // We currently only support normalization for single-segment allowlist
    // entries. Multi-segment keys are kept as-is to avoid surprising splits.
    if (parsed.segments.length > 1) continue;

    const segment: ParsedCommandSegment = parsed.segments[0]!;
    // Only normalize bare commands (like "git status"). Entries that already
    // use full binary paths (e.g. "/usr/bin/git status") are left as-is,
    // since the parser will produce matching resolvedCommandPath values.
    if (segment.command && segment.command.includes('/')) continue;
    const baseKeys = new Set<string>();

    if (segment.commandWithSubcommands) {
      baseKeys.add(segment.commandWithSubcommands);
    }

    if (segment.resolvedCommandPath) {
      baseKeys.add(segment.resolvedCommandPath);

      const resolvedWithSubcommands =
        segment.subcommands.length > 0
          ? `${segment.resolvedCommandPath} ${segment.subcommands.join(' ')}`
          : segment.resolvedCommandPath;

      baseKeys.add(resolvedWithSubcommands);
    }

    // Preserve wildcard semantics: if the original key ends with " *",
    // also add wildcard variants for the resolved/basename forms.
    const isWildcard = /[^\*]+\*$/.test(rawKey);
    const wildcardSuffix = isWildcard ? ' *' : '';

    for (const baseKey of baseKeys) {
      const keyToAdd = isWildcard
        ? `${baseKey.replace(/\s+\*$/, '')}${wildcardSuffix}`
        : baseKey;

      // Always let later entries (e.g. workspace/config allowlists) override
      // earlier ones (e.g. defaults), to preserve the same precedence rules
      // as the merged allowlist itself.
      normalized[keyToAdd] = entry;
    }
  }

  return normalized;
}

function getAllowlistForCommandFromList(
  command: string,
  list: AllowList
): AllowListEntry {
  const parsedCommand = parseCommand(command);

  if (!parsedCommand.segments.length) {
    return { trusted: false, allow: false };
  }

  const directEntry = list?.[command];

  let aggregateTrusted = true;
  let aggregateAllow = true;

  for (const segment of parsedCommand.segments) {
    const segmentEntry = getAllowlistForSegmentFromList(segment, list);

    if (!segmentEntry.allow) {
      aggregateAllow = false;
      aggregateTrusted = false;
      break;
    }

    if (!segmentEntry.trusted) {
      aggregateTrusted = false;
    }
  }

  if (!directEntry) {
    return { trusted: aggregateTrusted, allow: aggregateAllow };
  }

  return {
    trusted: aggregateTrusted && directEntry.trusted,
    allow: aggregateAllow && directEntry.allow,
  };
}

function getAllowlistForSegmentFromList(
  segment: ParsedCommandSegment,
  list: AllowList
): AllowListEntry {
  const trimmedSegment = segment.raw.trim();
  const directEntry = list?.[trimmedSegment];
  if (directEntry) return directEntry;

  const baseCommands = new Set<string>();
  const baseCommandsWithSubcommands = new Set<string>();

  if (segment.command) {
    baseCommands.add(segment.command);
  }

  if (segment.commandWithSubcommands) {
    baseCommandsWithSubcommands.add(segment.commandWithSubcommands);
  }

  if (segment.resolvedCommandPath) {
    baseCommands.add(segment.resolvedCommandPath);

    const resolvedWithSubcommands =
      segment.subcommands.length > 0
        ? `${segment.resolvedCommandPath} ${segment.subcommands.join(' ')}`
        : segment.resolvedCommandPath;

    baseCommandsWithSubcommands.add(resolvedWithSubcommands);
  }

  const matchedEntries = Object.entries(list).filter(([key]) => {
    if (baseCommands.has(key)) return true;
    if (baseCommandsWithSubcommands.has(key)) return true;
    if (
      /[^\*]+\*$/.test(key) &&
      Array.from(baseCommandsWithSubcommands).some((baseCommand) =>
        baseCommand.startsWith(key.replace(/\s+\*$/, ''))
      )
    ) {
      return true;
    }
    return false;
  });

  // Fallback: if nothing matched structurally, try simple prefix matching on the
  // raw segment (and its resolved form) so that commands like
  // "/usr/bin/git status -sb" still match an entry for "/usr/bin/git status".
  if (matchedEntries.length === 0) {
    const raw = segment.raw.trim();
    const resolvedPrefix =
      segment.resolvedCommandPath && segment.subcommands.length > 0
        ? `${segment.resolvedCommandPath} ${segment.subcommands.join(' ')}`
        : null;

    const fallbackMatches = Object.entries(list).filter(([key]) => {
      if (raw === key) return true;
      if (raw.startsWith(`${key} `)) return true;
      if (resolvedPrefix) {
        if (resolvedPrefix === key) return true;
        if (resolvedPrefix.startsWith(`${key} `)) return true;
      }
      return false;
    });

    if (fallbackMatches.length === 0) {
      return { trusted: false, allow: false };
    }

    const allAllowedFallback = fallbackMatches.every(
      ([, entry]) => entry.allow
    );
    const allTrustedFallback = fallbackMatches.every(
      ([, entry]) => entry.trusted
    );

    return {
      trusted: allTrustedFallback,
      allow: allAllowedFallback,
    };
  }

  const allAllowed = matchedEntries.every(([, entry]) => entry.allow);
  const allTrusted = matchedEntries.every(([, entry]) => entry.trusted);

  return {
    trusted: allTrusted,
    allow: allAllowed,
  };
}

export function saveAlwaysAllowPreferenceForCommand(
  command: string,
  config: AgentConfig
): void {
  const workspaceAllowlist = path.join(
    getWorkspacePath(config),
    'exec_allowlist.json'
  );
  const workspaceAllowlistData: AllowList = fs.existsSync(workspaceAllowlist)
    ? (JSON.parse(fs.readFileSync(workspaceAllowlist, 'utf8')) as AllowList)
    : {};

  workspaceAllowlistData[command] = workspaceAllowlistData[command]
    ? { ...workspaceAllowlistData[command], allow: true }
    : { trusted: false, allow: true };

  fs.writeFileSync(
    workspaceAllowlist,
    JSON.stringify(workspaceAllowlistData, null, 2)
  );
}
