import { promises as fs } from 'node:fs';
import { dirname as getDirname } from 'node:path';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { AgentConfig } from '../types';

type PatchOperation = 'add' | 'update';

interface ParsedPatch {
  operation: PatchOperation;
  filePath: string;
  lines: string[];
}

function parseSingleFilePatch(patch: string): ParsedPatch {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 3) {
    throw new Error('Patch must contain at least a begin line, header, and end line.');
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
    throw new Error('Second line must be "*** Add File: <path>" or "*** Update File: <path>".');
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
  const originalText = await fs.readFile(filePath, 'utf8').catch((err: unknown) => {
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

async function applyAddPatch(filePath: string, hunkLines: string[]): Promise<void> {
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
  patch: string
): Promise<{ filePath: string }> {
  const parsed = parseSingleFilePatch(patch);

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

export function getFilesTools(_config: AgentConfig): AgentTool[] {
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

        const { patch } = params as { patch: string };

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
  ];
}

