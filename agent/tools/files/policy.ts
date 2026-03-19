import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig, ToolContext } from '../../types';
import { getWorkspacePath } from '../../utilities';
import type {
  AppendFileToolParams,
  ListFilesToolParams,
  PatchFileToolParams,
  ReadFileToolParams,
  WriteFileToolParams,
} from './tools';

export type PolicyEvaluation = {
  allowed: boolean;
  reason: string | null;
};

export const filePolicyToolNames = [
  'patch_file',
  'write_file',
  'append_file',
  'read_file',
  'list_files',
] as const;

export const getAllowedRoots = (config: AgentConfig): string[] => [
  path.resolve(getWorkspacePath(config)),
  path.resolve(tmpdir()),
];

export async function evaluate(input: {
  toolName: string;
  params: unknown;
  context: ToolContext;
}): Promise<PolicyEvaluation> {
  if (
    !filePolicyToolNames.includes(
      input.toolName as (typeof filePolicyToolNames)[number]
    )
  ) {
    return {
      allowed: false,
      reason: `Called ${input.toolName} but it is not a file tool`,
    };
  }

  const rawPath = extractPathForPolicyCheck(input);

  if (rawPath) {
    const resolved = path.resolve(rawPath);
    const allowedRoots = getAllowedRoots(input.context.config);
    const allowed = allowedRoots.some((root) => isUnderRoot(resolved, root));

    if (allowed) {
      return { allowed: true, reason: null };
    } else {
      return {
        allowed: false,
        reason: `File tool not allowed: path outside workspace/tmp. Offending path: "${rawPath}" -> "${resolved}". Allowed roots: ${allowedRoots.map((root) => `"${root}"`).join(', ')}.`,
      };
    }
  }

  return { allowed: false, reason: null };
}

function extractPathForPolicyCheck(input: {
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
