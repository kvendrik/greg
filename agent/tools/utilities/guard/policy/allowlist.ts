import type { AgentConfig } from '../../../../types';
import { getWorkspacePath } from '../../../../utilities';
import path from 'node:path';
import fs from 'node:fs';
import { minimatch } from 'minimatch';
import { parseCommand } from './command-parser/command-parser';
import type { ParsedCommandSegment } from './command-parser/command-parser';
import { defaultExecAllowlist } from './default_exec_allowlist';

/**
 * Trusted means the output is trusted to be safe and won't be ran through the guard.
 * Allow means the input is allowed to run.
 */
export type AllowListEntry = { allow: boolean };
export type AllowList = Record<string, AllowListEntry>;

/** True if the allowlist key contains glob metacharacters (* ? [ ]). */
function isGlobPattern(key: string): boolean {
  return /[*?[\]]/.test(key);
}

/** Match candidate strings against a glob pattern (e.g. "npm run *", "bun run hub/*", "cd *"). */
function matchesGlob(candidate: string, pattern: string): boolean {
  // "cmd *" / "cmd path" style: match when candidate starts with pattern prefix (e.g. "cd ").
  if (pattern.endsWith(' *') && !pattern.includes('/')) {
    const prefix = pattern.slice(0, -2);
    if (candidate === prefix || candidate.startsWith(prefix + ' ')) return true;
  }
  const patternForPath =
    pattern.endsWith(' *') && !pattern.endsWith(' **')
      ? pattern.slice(0, -1) + '**'
      : pattern;
  const useGlobstar = patternForPath.includes('**');
  return minimatch(candidate, patternForPath, { noglobstar: !useGlobstar });
}

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
 * - **Glob patterns** (via minimatch: `*`, `?`, `[]`); e.g. `"npm run *"`, `"bun run hub/*"`, `"cd *"`.
 */
export function getAllowlistForCommand(
  command: string,
  config: AgentConfig
): AllowListEntry {
  // Start from the curated default allowlist, then let workspace- and
  // config-level entries extend/override it.
  //
  // This means:
  // - Defaults are always available out of the box (e.g. `cat`).
  // - Workspace `exec_allowlist.json` can refine/override defaults.
  // - Config-level `allowlist.exec` has the highest precedence and can
  //   both add new entries and override defaults/workspace entries
  //   (e.g. to explicitly deny `git status` even though it's allowed
  //   by default).
  let mergedAllowlist: AllowList = { ...defaultExecAllowlist };

  const workspaceAllowlistPath = path.join(
    getWorkspacePath(config),
    'exec_allowlist.json'
  );

  if (fs.existsSync(workspaceAllowlistPath)) {
    const workspaceAllowlistData: AllowList = JSON.parse(
      fs.readFileSync(workspaceAllowlistPath, 'utf8')
    );
    mergedAllowlist = { ...mergedAllowlist, ...workspaceAllowlistData };
  }

  if (Object.keys(mergedAllowlist).length === 0) {
    return { allow: false };
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

    // Path-like globs (e.g. "bun run hub/*") must not get normalized variants,
    // or we would add "bun run *" / "/path/to/bun run *" and over-match.
    if (isGlobPattern(rawKey) && rawKey.includes('/')) continue;

    const segment: ParsedCommandSegment = parsed.segments[0]!;
    const baseKeys = new Set<string>();

    // For path-based keys (e.g. "/usr/bin/git status"), add basename form so
    // "git status -sb" matches when the binary resolves to that path.
    if (segment.command?.includes('/') && segment.commandWithSubcommands) {
      const basenameForm =
        path.basename(segment.command) +
        (segment.subcommands.length > 0
          ? ' ' + segment.subcommands.join(' ')
          : '');
      baseKeys.add(basenameForm);
    }

    // Only normalize bare commands (no path) further; path keys already added basename above.
    if (segment.command && segment.command.includes('/')) {
      for (const baseKey of baseKeys) {
        normalized[baseKey] = entry;
      }
      continue;
    }

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
    const wildcardPrefix = isWildcard
      ? rawKey.replace(/\s+\*$/, '').replace(/\*$/, '')
      : '';

    for (const baseKey of baseKeys) {
      // Don't add a shortened base (e.g. "bun run") for a wildcard key like
      // "bun run hub/*", or we would allow "bun run anything".
      if (
        isWildcard &&
        baseKey.length < wildcardPrefix.length &&
        wildcardPrefix.startsWith(baseKey)
      ) {
        continue;
      }
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
    return { allow: false };
  }

  const directEntry = list?.[command];
  let aggregateAllow = true;

  for (const segment of parsedCommand.segments) {
    const segmentEntry = getAllowlistForSegmentFromList(segment, list);

    if (!segmentEntry.allow) {
      aggregateAllow = false;
      break;
    }
  }

  if (!directEntry) {
    return { allow: aggregateAllow };
  }

  return {
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

  const candidates: string[] = [trimmedSegment];

  if (segment.commandWithSubcommands) {
    candidates.push(segment.commandWithSubcommands);
  }

  if (segment.resolvedCommandPath) {
    const resolvedWithSubcommands =
      segment.subcommands.length > 0
        ? `${segment.resolvedCommandPath} ${segment.subcommands.join(' ')}`
        : segment.resolvedCommandPath;
    candidates.push(resolvedWithSubcommands);
  }

  const matches: [string, AllowListEntry][] = [];

  // For path-like globs (e.g. "bun run hub/*"), match only the segment before " -- "
  // so "bun run hub_root/dangerous -- x" does not match "bun run hub/*".
  const candidatesForGlob = trimmedSegment.includes(' -- ')
    ? [
        trimmedSegment.split(' -- ')[0]!.trim(),
        ...candidates.filter((c) => !c.includes(' -- ')),
      ]
    : candidates;

  for (const [key, entry] of Object.entries(list)) {
    // Glob patterns (e.g. "npm run *", "bun run hub/*").
    if (isGlobPattern(key)) {
      const toCheck = key.includes('/') ? candidatesForGlob : candidates;
      if (toCheck.some((candidate) => matchesGlob(candidate, key))) {
        matches.push([key, entry]);
      }
      continue;
    }

    // Non-glob keys with spaces: subcommand-style ("git status", "/usr/bin/git status").
    if (key.includes(' ')) {
      const exactMatch =
        segment.commandWithSubcommands === key || candidates.includes(key);
      const prefixPlusFlags =
        (segment.commandWithSubcommands.startsWith(key + ' ') ||
          trimmedSegment === key ||
          trimmedSegment.startsWith(key + ' ')) &&
        segment.commandWithSubcommands
          .slice(key.length + 1)
          .trim()
          .split(/\s+/)
          .every((w) => w.startsWith('-'));
      if (exactMatch || prefixPlusFlags) {
        matches.push([key, entry]);
      }
      continue;
    }

    // Base command key like "ls" or "cat": match when command is key and there
    // are no subcommands, or only flag-like tokens (e.g. "ls -la" has subcommands ["-la"]).
    const onlyFlagsAsSubcommands =
      segment.subcommands.length === 0 ||
      segment.subcommands.every((s) => s.startsWith('-'));
    if (
      onlyFlagsAsSubcommands &&
      (segment.command === key ||
        (segment.resolvedCommandPath &&
          path.basename(segment.resolvedCommandPath) === key))
    ) {
      matches.push([key, entry]);
    }
  }

  if (matches.length === 0) {
    return { allow: false };
  }

  const allAllowed = matches.every(([, entry]) => entry.allow);

  return {
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
    : { allow: true };

  fs.writeFileSync(
    workspaceAllowlist,
    JSON.stringify(workspaceAllowlistData, null, 2)
  );
}
