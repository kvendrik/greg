import path from 'node:path';
import type { ToolContext } from '../../types';
import { isAllowed } from './filesystem';
import type {
  AppendFileToolParams,
  ListFilesToolParams,
  PatchFileToolParams,
  ReadFileToolParams,
  WriteFileToolParams,
} from './tools';

type PolicyEvaluation = {
  allowed: boolean;
  reason: string | null;
};

export const toolNames = {
  read: ['read_file', 'list_files'] as const,
  write: [
    'write_file',
    'append_file',
    'move_file',
    'delete_file',
    'patch_file',
  ] as const,
};

export type ToolName =
  | (typeof toolNames.read)[number]
  | (typeof toolNames.write)[number];

export async function evaluate({
  toolName,
  params,
  context,
}: {
  toolName: ToolName;
  params: unknown;
  context: ToolContext;
}): Promise<PolicyEvaluation> {
  if (!Object.values(toolNames).flat().includes(toolName)) {
    return {
      allowed: false,
      reason: `Called ${toolName} but it is not a file tool`,
    };
  }

  const rawPath = extractPath({ toolName, params, context });

  if (rawPath) {
    const mode = (toolNames.read as readonly string[]).includes(toolName)
      ? 'read'
      : 'write';
    const allowed = isAllowed(mode, rawPath, context.config);
    return {
      allowed,
      reason: allowed ? null : `${rawPath} is not allowed for mode: ${mode}`,
    };
  }

  return { allowed: false, reason: 'Could not extract path from tool call' };
}

function extractPath(input: {
  toolName: string;
  params: unknown;
  context: ToolContext;
}): string | null {
  if (input.toolName === 'write_file') {
    return (input.params as WriteFileToolParams).path;
  }
  if (input.toolName === 'append_file') {
    return (input.params as AppendFileToolParams).path;
  }
  if (input.toolName === 'read_file') {
    return (input.params as ReadFileToolParams).path;
  }
  if (input.toolName === 'list_files') {
    const params = input.params as ListFilesToolParams;
    const defaultDirectory = path.resolve(input.context.config.workspace);
    return params.directory ?? defaultDirectory;
  }
  if (input.toolName === 'patch_file') {
    const params = input.params as PatchFileToolParams;
    return extractPatchFilePath(params.patch);
  }
  return null;
}

function extractPatchFilePath(patch: string): string | null {
  const firstLines = patch.replace(/\r\n/g, '\n').split('\n').slice(0, 3);
  if (firstLines.length < 2) return null;
  const headerLine = firstLines[1] ?? '';
  const addPrefix = '*** Add File: ';
  const updatePrefix = '*** Update File: ';
  if (headerLine.startsWith(addPrefix)) {
    return headerLine.slice(addPrefix.length).trim() || null;
  }
  if (headerLine.startsWith(updatePrefix)) {
    return headerLine.slice(updatePrefix.length).trim() || null;
  }
  return null;
}

export function isUnderRoot(
  resolvedCandidate: string,
  resolvedRoot: string
): boolean {
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(rootWithSep)
  );
}
