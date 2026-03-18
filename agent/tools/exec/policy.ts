import path from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolContext } from '../../types';
import { getWorkspacePath } from '../../utilities';
import type { ExecvePipelineToolParams, ExecveToolParams } from './tools';

export type PolicyEvaluation = {
  allowed: boolean;
  reason: string | null;
};

export const execPolicyToolNames = [
  'execve',
  'execve_pipeline',
] as const;

export async function evaluate(input: {
  toolName: string;
  params: unknown;
  context: ToolContext;
}): Promise<PolicyEvaluation> {
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

async function evaluateExecve(
  params: ExecveToolParams,
  context: ToolContext
): Promise<PolicyEvaluation> {
  return evaluateResolvedPaths({
    cwd: params.cwd,
    args: params.args,
    context,
    kindPrefix: 'execve',
  });
}

async function evaluatePipeline(
  params: ExecvePipelineToolParams,
  context: ToolContext
): Promise<PolicyEvaluation> {
  const allArgs: string[] = [];
  for (const step of params.commands ?? []) {
    allArgs.push(...(step.args ?? []));
  }
  return evaluateResolvedPaths({
    cwd: params.cwd,
    args: allArgs,
    context,
    kindPrefix: 'execve_pipeline',
  });
}

function evaluateResolvedPaths(params: {
  cwd?: string;
  args: string[];
  context: ToolContext;
  kindPrefix: string;
}): PolicyEvaluation {
  const workspaceRoot = path.resolve(getWorkspacePath(params.context.config));
  const tmpRoot = path.resolve(tmpdir());

  const candidatePaths: { raw: string; resolved: string; kind: string }[] = [];

  const cwd = typeof params.cwd === 'string' ? params.cwd : null;
  if (cwd) {
    candidatePaths.push({
      raw: cwd,
      resolved: path.resolve(cwd),
      kind: `${params.kindPrefix}.cwd`,
    });
  }

  for (const item of params.args) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    const maybePath = item.trim();
    if (!looksLikePath(maybePath)) continue;
    candidatePaths.push({
      raw: maybePath,
      resolved: cwd ? path.resolve(cwd, maybePath) : path.resolve(maybePath),
      kind: `${params.kindPrefix}.arg`,
    });
  }

  const offending = candidatePaths.find(
    (candidate) =>
      !isUnderRoot(candidate.resolved, workspaceRoot) &&
      !isUnderRoot(candidate.resolved, tmpRoot)
  );

  if (offending) {
    return {
      allowed: false,
      reason: `Command not allowed: path outside workspace/tmp. Offending ${offending.kind}: "${offending.raw}" -> "${offending.resolved}". Allowed roots: "${workspaceRoot}", "${tmpRoot}".`,
    };
  }

  return { allowed: true, reason: null };
}

function isUnderRoot(resolvedCandidate: string, resolvedRoot: string): boolean {
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(rootWithSep)
  );
}

function looksLikePath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.includes('/') ||
    value.includes('\\')
  );
}

