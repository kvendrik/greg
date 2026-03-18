import { promises as fs } from 'node:fs';
import path, { dirname as getDirname } from 'node:path';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { ToolContext } from '../../types';
import { minimatch } from 'minimatch';

type PatchOperation = 'add' | 'update';

interface ParsedPatch {
  operation: PatchOperation;
  filePath: string;
  lines: string[];
}

export type PatchFileToolParams = {
  patch: string;
};

export type WriteFileToolParams = {
  path: string;
  content: string;
};

export type AppendFileToolParams = {
  path: string;
  content: string;
};

export type ReadFileToolParams = {
  path: string;
  maxBytes?: number;
};

export type ListFilesToolParams = {
  directory?: string;
  pattern?: string;
  excludePatterns?: string[];
  recursive?: boolean;
  maxDepth?: number;
  includeHidden?: boolean;
  mode?: 'files' | 'dirs' | 'both';
  maxResults?: number;
};

function parseSingleFilePatch(patchText: string): ParsedPatch {
  const lines = patchText.replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 3) {
    throw new Error(
      'Patch must contain at least a begin line, header, and end line.'
    );
  }

  const beginLine = lines[0].trim();
  if (beginLine !== '*** Begin Patch') {
    throw new Error('Patch must start with "*** Begin Patch".');
  }

  const headerLine = lines[1];
  const addPrefix = '*** Add File: ';
  const updatePrefix = '*** Update File: ';

  let operation: PatchOperation;
  let filePath: string;

  if (headerLine.startsWith(addPrefix)) {
    operation = 'add';
    filePath = headerLine.slice(addPrefix.length).trim();
  } else if (headerLine.startsWith(updatePrefix)) {
    operation = 'update';
    filePath = headerLine.slice(updatePrefix.length).trim();
  } else {
    throw new Error(
      'Second line must be "*** Add File: <path>" or "*** Update File: <path>".'
    );
  }

  if (!filePath) {
    throw new Error('File path in patch header is empty.');
  }

  const endIndex = lines.lastIndexOf('*** End Patch');
  if (endIndex === -1) {
    throw new Error('Patch must end with "*** End Patch".');
  }

  const bodyLines = lines.slice(2, endIndex);

  return {
    operation,
    filePath,
    lines: bodyLines,
  };
}

async function applyUpdatePatch(
  filePath: string,
  hunkLines: string[]
): Promise<void> {
  const originalText = await fs
    .readFile(filePath, 'utf8')
    .catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Cannot update non-existent file: ${filePath}`);
      }
      throw err;
    });

  const originalLines = originalText.replace(/\r\n/g, '\n').split('\n');
  const newLines: string[] = [];

  let originalIndex = 0;

  const applyHunk = (hunkBody: string[]) => {
    for (const rawLine of hunkBody) {
      if (!rawLine) {
        continue;
      }

      const marker = rawLine[0];
      const content = rawLine.slice(1);

      if (marker === ' ') {
        const originalLine = originalLines[originalIndex];
        if (originalLine !== content) {
          throw new Error(
            `Context line mismatch while applying patch.\nExpected: "${originalLine ?? ''}"\nGot: "${content}".`
          );
        }
        newLines.push(originalLine);
        originalIndex += 1;
      } else if (marker === '-') {
        const originalLine = originalLines[originalIndex];
        if (originalLine !== content) {
          throw new Error(
            `Removal line mismatch while applying patch.\nExpected: "${originalLine ?? ''}"\nGot: "${content}".`
          );
        }
        originalIndex += 1;
      } else if (marker === '+') {
        newLines.push(content);
      } else {
        // Non patch line inside hunk body; ignore (e.g. comments)
      }
    }
  };

  let currentHunk: string[] = [];

  for (const line of hunkLines) {
    if (line.startsWith('@@')) {
      if (currentHunk.length > 0) {
        applyHunk(currentHunk);
        currentHunk = [];
      }
      continue;
    }
    if (line === '*** End of File') {
      break;
    }
    currentHunk.push(line);
  }

  if (currentHunk.length > 0) {
    applyHunk(currentHunk);
  }

  while (originalIndex < originalLines.length) {
    newLines.push(originalLines[originalIndex] ?? '');
    originalIndex += 1;
  }

  const finalText = newLines.join('\n');
  await fs.mkdir(getDirname(filePath), { recursive: true });
  await fs.writeFile(filePath, finalText, 'utf8');
}

async function applyAddPatch(
  filePath: string,
  hunkLines: string[]
): Promise<void> {
  const newLines: string[] = [];

  for (const rawLine of hunkLines) {
    if (!rawLine || rawLine.startsWith('@@') || rawLine === '*** End of File') {
      continue;
    }
    if (rawLine[0] === '+') {
      newLines.push(rawLine.slice(1));
    }
  }

  const finalText = newLines.join('\n');
  await fs.mkdir(getDirname(filePath), { recursive: true });
  await fs.writeFile(filePath, finalText, 'utf8');
}

export async function applyPatchString(
  patchText: string
): Promise<{ filePath: string }> {
  const parsed = parseSingleFilePatch(patchText);

  if (!parsed.filePath.startsWith('/')) {
    throw new Error(
      `Patch file path must be absolute. Got: "${parsed.filePath}".`
    );
  }

  if (parsed.operation === 'update') {
    await applyUpdatePatch(parsed.filePath, parsed.lines);
  } else {
    await applyAddPatch(parsed.filePath, parsed.lines);
  }

  return { filePath: parsed.filePath };
}

export function getFilesTools(context: ToolContext): AgentTool[] {
  return [
    {
      name: 'patch_file',
      label: 'patch file',
      description:
        'Apply a small, line-based patch to a single local file. Patch must be in the "*** Begin Patch" format used by Cursor, with exactly one "*** Add File" or "*** Update File" section.',
      parameters: Type.Object({
        patch: Type.String({
          description:
            'Patch string in the "*** Begin Patch" format for a single file. The file path inside the patch must be absolute.',
        }),
      }),
      execute: async (_id, params, signal, _onUpdate) => {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const { patch } = params as PatchFileToolParams;

        try {
          const { filePath } = await applyPatchString(patch);
          const message = `Patch applied successfully to ${filePath}.`;
          return {
            content: [{ type: 'text' as const, text: message }],
            details: { filePath },
          };
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? `Failed to apply patch: ${error.message}`
              : 'Failed to apply patch due to an unknown error.';
          return {
            content: [{ type: 'text' as const, text: message }],
            details: { error: String(error) },
          };
        }
      },
    },
    {
      name: 'write_file',
      label: 'write file',
      description:
        'Write a text file to disk. Creates parent directories as needed.',
      parameters: Type.Object({
        path: Type.String({
          description: 'Absolute file path to write.',
        }),
        content: Type.String({ description: 'Full file contents to write.' }),
      }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { path: filePath, content } = params as WriteFileToolParams;

        const resolvedTarget = path.resolve(filePath);
        if (!path.isAbsolute(resolvedTarget)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Refusing to write to a non-absolute path: ${filePath}`,
              },
            ],
            details: {},
          };
        }

        await fs.mkdir(getDirname(resolvedTarget), { recursive: true });
        await fs.writeFile(resolvedTarget, content, 'utf8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Wrote ${resolvedTarget} (${content.length} chars).`,
            },
          ],
          details: {},
        };
      },
    },
    {
      name: 'append_file',
      label: 'append file',
      description:
        'Append text to a file on disk. Creates the file and parent directories if missing.',
      parameters: Type.Object({
        path: Type.String({
          description: 'Absolute file path to append to.',
        }),
        content: Type.String({ description: 'Text to append.' }),
      }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { path: filePath, content } = params as AppendFileToolParams;

        const resolvedTarget = path.resolve(filePath);
        if (!path.isAbsolute(resolvedTarget)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Refusing to append to a non-absolute path: ${filePath}`,
              },
            ],
            details: {},
          };
        }

        await fs.mkdir(getDirname(resolvedTarget), { recursive: true });
        await fs.appendFile(resolvedTarget, content, 'utf8');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Appended to ${resolvedTarget} (${content.length} chars).`,
            },
          ],
          details: {},
        };
      },
    },
    {
      name: 'read_file',
      label: 'read file',
      description:
        'Read a text file from disk. Use this instead of shelling out to cat.',
      parameters: Type.Object({
        path: Type.String({
          description: 'Absolute file path to read.',
        }),
        maxBytes: Type.Optional(
          Type.Number({
            description:
              'Optional maximum bytes to return. If exceeded, the result is truncated.',
            default: 200_000,
            minimum: 1,
          })
        ),
      }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { path: filePath, maxBytes } = params as ReadFileToolParams;

        const resolvedTarget = path.resolve(filePath);
        if (!path.isAbsolute(resolvedTarget)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Refusing to read a non-absolute path: ${filePath}`,
              },
            ],
            details: {},
          };
        }

        const fileBuffer = await fs
          .readFile(resolvedTarget)
          .catch((err: unknown) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
              throw new Error(`File does not exist: ${resolvedTarget}`);
            }
            throw err;
          });

        const limit =
          typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : 200_000;
        const truncated = fileBuffer.length > limit;
        const head = fileBuffer.subarray(0, Math.min(limit, fileBuffer.length));

        const binaryDetection = detectBinaryLike(head);
        if (binaryDetection.isBinaryLike) {
          const hexPreview =
            head
              .subarray(0, Math.min(64, head.length))
              .toString('hex')
              .match(/.{1,2}/g)
              ?.join(' ') ?? '';
          const message =
            `Binary file detected; refusing to decode as UTF-8 text.\n` +
            `Path: ${resolvedTarget}\n` +
            `Size: ${fileBuffer.length} bytes\n` +
            `Heuristic: ${binaryDetection.reason}\n` +
            `Hex preview (first ${Math.min(64, head.length)} bytes):\n${hexPreview}\n\n` +
            `If you need to inspect this file, consider adding a dedicated tool (e.g. base64/hex reader, PDF extractor, image metadata reader) instead of treating it as text.`;
          return {
            content: [{ type: 'text' as const, text: message }],
            details: {
              path: resolvedTarget,
              bytes: fileBuffer.length,
              truncated: false,
              binary: true,
              reason: binaryDetection.reason,
            },
          };
        }

        const text = head.toString('utf8');
        const finalText = truncated
          ? `${text}\n\n[truncated]\nRead ${limit} of ${fileBuffer.length} bytes.`
          : text;

        return {
          content: [{ type: 'text' as const, text: finalText }],
          details: {
            path: resolvedTarget,
            truncated,
            bytes: fileBuffer.length,
            binary: false,
          },
        };
      },
    },
    {
      name: 'list_files',
      label: 'list files',
      description:
        'List files under a directory, optionally filtered by a glob pattern.',
      parameters: Type.Object({
        directory: Type.Optional(
          Type.String({
            description:
              'Absolute directory to list. Defaults to the current workspace root.',
          })
        ),
        pattern: Type.Optional(
          Type.String({
            description:
              'Optional glob pattern (minimatch) to filter paths, e.g. "**/*.ts", "src/**".',
          })
        ),
        excludePatterns: Type.Optional(
          Type.Array(
            Type.String({
              description:
                'Glob patterns to exclude (matched against absolute paths). Example: "**/node_modules/**".',
            }),
            {
              description:
                'Optional exclude globs. Defaults to excluding node_modules and .git.',
            }
          )
        ),
        recursive: Type.Optional(
          Type.Boolean({
            description:
              'Whether to recurse into subdirectories. Default: true.',
            default: true,
          })
        ),
        maxDepth: Type.Optional(
          Type.Number({
            description:
              'Maximum directory depth to recurse (0 = only the directory itself). Default: 25.',
            default: 25,
            minimum: 0,
          })
        ),
        includeHidden: Type.Optional(
          Type.Boolean({
            description:
              'Whether to include hidden files/directories (dotfiles). Default: false.',
            default: false,
          })
        ),
        mode: Type.Optional(
          Type.Union(
            [Type.Literal('files'), Type.Literal('dirs'), Type.Literal('both')],
            {
              description:
                'What to include in results: files, dirs, or both. Default: files.',
            }
          )
        ),
        maxResults: Type.Optional(
          Type.Number({
            description: 'Maximum number of results to return. Default: 200.',
            default: 200,
            minimum: 1,
          })
        ),
      }),
      execute: async (_id, params, signal) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const {
          directory,
          pattern,
          excludePatterns,
          recursive = true,
          maxDepth = 25,
          includeHidden = false,
          mode = 'files',
          maxResults = 200,
        } = params as ListFilesToolParams;

        const defaultDirectory = path.resolve(context.config.workspace);
        const resolvedDir = path.resolve(directory ?? defaultDirectory);
        if (!path.isAbsolute(resolvedDir)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Refusing to list a non-absolute directory: ${directory ?? ''}`,
              },
            ],
            details: {},
          };
        }

        const results: string[] = [];
        const excludeGlobs =
          Array.isArray(excludePatterns) && excludePatterns.length > 0
            ? excludePatterns
            : ['**/node_modules/**', '**/.git/**'];

        await walk(resolvedDir, 0);

        const text = results.join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: text === '' ? '(no matches)' : text,
            },
          ],
          details: { count: results.length },
        };

        async function walk(currentDir: string, depth: number): Promise<void> {
          if (results.length >= maxResults) return;
          if (recursive && depth > maxDepth) return;

          // Exclude directories early.
          if (
            excludeGlobs.some((glob) =>
              minimatch(currentDir, glob, { dot: true })
            )
          ) {
            return;
          }

          const entries = await fs.readdir(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= maxResults) return;
            const fullPath = path.join(currentDir, entry.name);

            if (!includeHidden && entry.name.startsWith('.')) {
              continue;
            }

            if (
              excludeGlobs.some((glob) =>
                minimatch(fullPath, glob, { dot: true })
              )
            ) {
              continue;
            }

            if (entry.isDirectory()) {
              if (mode === 'dirs' || mode === 'both') {
                if (!pattern || minimatch(fullPath, pattern, { dot: true })) {
                  results.push(fullPath);
                  if (results.length >= maxResults) return;
                }
              }
              if (recursive) {
                await walk(fullPath, depth + 1);
              }
              continue;
            }

            if (mode === 'dirs') {
              continue;
            }

            if (pattern && !minimatch(fullPath, pattern, { dot: true })) {
              continue;
            }
            results.push(fullPath);
          }
        }
      },
    },
  ];
}

function detectBinaryLike(buffer: Buffer): {
  isBinaryLike: boolean;
  reason: string;
} {
  if (buffer.length === 0) return { isBinaryLike: false, reason: 'empty' };

  // NUL bytes are a strong signal for binary or UTF-16; treat as binary for our purposes.
  if (buffer.includes(0)) {
    return { isBinaryLike: true, reason: 'contains NUL byte(s)' };
  }

  // Heuristic: count "mostly printable" bytes in the head.
  // Allow common whitespace. Treat bytes outside ASCII printable range as non-printable.
  let printableCount = 0;
  for (const byte of buffer) {
    const isTab = byte === 9;
    const isNewline = byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    if (isTab || isNewline || isPrintableAscii) {
      printableCount += 1;
    }
  }

  const printableRatio = printableCount / buffer.length;
  if (printableRatio < 0.8) {
    return {
      isBinaryLike: true,
      reason: `low printable ASCII ratio (${Math.round(printableRatio * 100)}%)`,
    };
  }

  return { isBinaryLike: false, reason: 'looks like text' };
}

export function getFilesToolsInstructions(): string {
  return `
## Files (local filesystem)

Use these tools to read/write files directly.

### Tools

- \`read_file\`: read a text file (bounded). If the file looks binary, it returns a diagnostic + hex preview instead of mojibake.
- \`write_file\`: write full contents to a file (creates parent dirs).
- \`append_file\`: append text to a file (creates parent dirs/file if missing).
- \`list_files\`: list paths under a directory with optional \`pattern\`, pruning via \`excludePatterns\`, \`maxDepth\`, \`includeHidden\`, and \`mode\`.
- \`patch_file\`: apply a single-file Cursor-style patch (*** Begin Patch format).

### Common workflows

- Use \`read_file\` for inspection and feeding content into other tools.
- Use \`write_file\` / \`append_file\` for persisting outputs from other tools.
- Use \`list_files\` to enumerate candidate paths for subsequent reads/patches.

### Tips

- Prefer narrowing \`list_files.directory\` + \`pattern\` and using \`excludePatterns\` to avoid slow scans.
- If you hit a “binary file detected” message, add a specialized tool (PDF extractor, sqlite query, image metadata) instead of forcing text reads.
`;
}
