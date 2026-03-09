import fs from 'node:fs';
import path from 'node:path';

export type CommandChainOperator = '|' | '||' | '&&' | ';';

export type ParsedCommandSegment = {
  /**
   * The raw segment text (between operators).
   */
  raw: string;
  /**
   * Words in the segment, split roughly like a shell (respects simple quotes/escapes).
   */
  argv: string[];
  /**
   * The base command of this segment, usually argv[0], or null when empty.
   */
  command: string | null;
  /**
   * Absolute path to the resolved command binary when found via PATH lookup,
   * or null when it cannot be resolved. If the command already contains a
   * slash, this is that path when it exists and is executable.
   */
  resolvedCommandPath: string | null;
  /**
   * Subcommands for this segment (e.g. ['commit'] for 'git commit -m "msg"').
   * We treat consecutive non-option words after the command as subcommands.
   */
  subcommands: string[];
  /**
   * The command with subcommands
   */
  commandWithSubcommands: string;
};

export type ParsedCommand = {
  /**
   * Parsed segments separated by |, ||, && or ; operators.
   */
  segments: ParsedCommandSegment[];
  /**
   * Operators between segments. Length is segments.length - 1 (when > 0).
   */
  operators: CommandChainOperator[];
};

/**
 * Parse a full shell command into segments and argv-style words.
 * This is not a full POSIX parser, but it is good enough for
 * permission/allowlist checks and respects simple quotes/escapes.
 */
export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  if (!trimmed) {
    return { segments: [], operators: [] };
  }

  const segments: string[] = [];
  const operators: CommandChainOperator[] = [];

  let lastIndex = 0;

  const operatorRegex = /(\|\||&&|[|;])/g;
  let match: RegExpExecArray | null;

  while ((match = operatorRegex.exec(trimmed)) !== null) {
    const op = match[1] as CommandChainOperator;
    const rawSegment = trimmed.slice(lastIndex, match.index);
    if (rawSegment.trim()) {
      segments.push(rawSegment);
      operators.push(op);
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = trimmed.slice(lastIndex);
  if (tail.trim()) {
    segments.push(tail);
  }

  const parsedSegments: ParsedCommandSegment[] = segments.map((segment) => {
    let argv = parseWords(segment);

    // Strip leading environment variable assignments like
    // "FOO=bar BAR=baz cmd ..." so that policy and allowlist
    // checks operate on the real command ("cmd").
    let envPrefixCount = 0;
    while (
      envPrefixCount < argv.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[envPrefixCount]!)
    ) {
      envPrefixCount++;
    }

    if (envPrefixCount > 0) {
      argv = argv.slice(envPrefixCount);
    }

    const commandWord = argv[0] ?? null;
    const subcommands: string[] = [];

    if (commandWord) {
      for (let i = 1; i < argv.length; i++) {
        const word = argv[i];
        // Treat consecutive "command-like" words as subcommands.
        // Allow common CLI subcommand patterns (letters, numbers, dashes, colons, underscores),
        // but stop once we hit a flag/option or obviously non-subcommand token.
        if (!/^[a-z0-9:_-]+$/.test(word)) break;
        subcommands.push(word);
      }
    }

    const resolvedCommandPath = resolveCommandPath(commandWord);

    const commandWithSubcommands =
      commandWord && subcommands.length > 0
        ? `${commandWord} ${subcommands.join(' ')}`
        : commandWord ?? '';

    return {
      raw: segment,
      argv,
      command: commandWord,
      resolvedCommandPath,
      subcommands,
      commandWithSubcommands,
    };
  });

  // If we skipped empty segments, operators might be longer than segments - 1.
  // Trim extra operators from the end to keep the relationship sane.
  const normalizedOperators = operators.slice(
    0,
    Math.max(0, parsedSegments.length - 1)
  );

  return {
    segments: parsedSegments,
    operators: normalizedOperators,
  };
}

function resolveCommandPath(commandWord: string | null): string | null {
  if (!commandWord) return null;

  // If the command already looks like a path, keep it if it's executable.
  if (commandWord.includes('/')) {
    return isExecutable(commandWord) ? commandWord : null;
  }

  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;

  const pathEntries = pathEnv.split(path.delimiter);

  for (const entry of pathEntries) {
    if (!entry) continue;
    const candidate = path.join(entry, commandWord);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isExecutable(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() && !stats.isSymbolicLink()) {
      return false;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Very small "shell-like" word splitter.
 * Handles:
 * - whitespace separation
 * - single and double quotes
 * - backslash escapes (outside of single quotes)
 *
 * It is intentionally minimal and only needs to be robust enough for
 * our allowlist and policy checks.
 */
function parseWords(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
      if (current !== '') {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current !== '') {
    result.push(current);
  }

  return result;
}
