import { minimatch } from 'minimatch';
import type { AgentConfig } from '../../../types';

export type AllowList = Record<string, { allow: boolean }>;

const DEFAULT_ALLOWLIST: AllowList = {
  'pwd *': { allow: true },
  'ls *': { allow: true },
  'echo *': { allow: true },
  'cd *': { allow: true },
  'printf *': { allow: true },

  'greg logs *': { allow: true },
  'greg gateway *': { allow: true },
  'greg heartbeat *': { allow: true },
  'greg doctor': { allow: true },
  'greg config *': { allow: true },
  'greg sessions *': { allow: true },
  'greg skills *': { allow: true },
  'greg guard *': { allow: true },

  'git status *': { allow: true },
  'git diff *': { allow: true },
  'git log *': { allow: true },
  'git branch *': { allow: true },
  'git rev-parse *': { allow: true },

  'head *': { allow: true },
  'tail *': { allow: true },
  'wc *': { allow: true },
  'sort *': { allow: true },
  'uniq *': { allow: true },
  'grep *': { allow: true },
  'rg *': { allow: true },
  'cat *': { allow: true },
  'jq *': { allow: true },

  'which *': { allow: true },
  'file *': { allow: true },
  'stat *': { allow: true },
  'readlink *': { allow: true },
  whoami: { allow: true },
  'id *': { allow: true },
  'env *': { allow: true },
  'date *': { allow: true },
  hostname: { allow: true },
  'uname *': { allow: true },
  'diff *': { allow: true },
  'cut *': { allow: true },
  'tr *': { allow: true },
  'nl *': { allow: true },
  'seq *': { allow: true },
  'du *': { allow: true },
  'df *': { allow: true },
  'tree *': { allow: true },
};

export function getAllowlist(config: AgentConfig): AllowList {
  const configured = config.tools?.guard.exec?.allowlist ?? null;
  return configured ? { ...DEFAULT_ALLOWLIST, ...configured } : DEFAULT_ALLOWLIST;
}

export function getAllowlistForCommand(
  commandLine: string,
  config: AgentConfig
): { allow: boolean } {
  const allowlist = getAllowlist(config);
  const segments = splitSegments(commandLine);
  for (const segment of segments) {
    const normalized = normalizeSegment(segment);
    if (!normalized) continue;
    const decision = evaluateSegment(normalized, allowlist);
    if (!decision.allow) return decision;
  }
  return { allow: true };
}

function splitSegments(commandLine: string): string[] {
  // Split on common shell combinators; we still require each segment to be allowed.
  return commandLine
    .split(/&&|\|\||\||;|\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeSegment(segment: string): string | null {
  let value = segment.trim();
  if (!value) return null;

  // Strip leading env assignments: FOO=bar BAR=baz cmd ...
  value = value.replace(/^(\w+=[^\s]+\s+)+/, '').trim();

  // Drop common redirections (keep the actual command):
  value = value
    .replace(/\s+\d?>\S+/g, '')
    .replace(/\s+<\S+/g, '')
    .trim();

  // Collapse whitespace.
  value = value.replace(/\s+/g, ' ').trim();
  return value || null;
}

function evaluateSegment(segment: string, allowlist: AllowList): { allow: boolean } {
  const matches = matchingKeys(segment, allowlist);
  if (matches.length === 0) return { allow: false };
  for (const key of matches) {
    if (!allowlist[key]?.allow) return { allow: false };
  }
  return { allow: true };
}

function matchingKeys(segment: string, allowlist: AllowList): string[] {
  const keys = Object.keys(allowlist);
  const normalized = segment;
  const withResolvedBins = resolveCommonBins(normalized);

  const matches: string[] = [];
  for (const key of keys) {
    if (matchesKey(normalized, key) || matchesKey(withResolvedBins, key)) {
      matches.push(key);
    }
  }
  return matches;
}

function resolveCommonBins(segment: string): string {
  const firstToken = segment.split(' ')[0] ?? '';
  if (firstToken === 'git') return segment.replace(/^git\b/, '/usr/bin/git');
  if (firstToken === 'jq') return segment.replace(/^jq\b/, '/usr/bin/jq');
  return segment;
}

function matchesKey(segment: string, key: string): boolean {
  const normalizedKey = key.trim().replace(/\s+/g, ' ');
  if (normalizedKey === '') return false;

  // Glob patterns: use minimatch on the whole normalized segment.
  if (/[*?[\]]/.test(normalizedKey)) {
    return (
      minimatch(segment, normalizedKey, { dot: true }) ||
      // If wildcard is present, allow the base command too (e.g. "jq *" matches "jq").
      minimatch(segment, normalizedKey.replace(/\s+\*$/, ''), { dot: true })
    );
  }

  const keyTokens = normalizedKey.split(' ');
  const segmentTokens = segment.split(' ');

  // If the allowlist entry is a subcommand (2+ tokens), allow additional args by prefix.
  if (keyTokens.length >= 2) {
    if (segment === normalizedKey) return true;
    return segment.startsWith(normalizedKey + ' ');
  }

  // Base command: allow flags/paths/quoted args, but disallow "subcommands" (bare words).
  const base = keyTokens[0]!;
  if (segmentTokens[0] !== base) return false;
  const second = segmentTokens[1] ?? null;
  if (!second) return true;
  if (second.startsWith('-')) return true;
  if (second.startsWith('./') || second.startsWith('../') || second.startsWith('/')) return true;
  if (second.startsWith('"') || second.startsWith("'")) return true;
  if (second.includes('/') || second.includes('\\')) return true;
  // Otherwise treat it as a subcommand and require explicit allowlist entries.
  return false;
}

