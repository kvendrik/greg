import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn, type ChildProcess } from 'child_process';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ToolContext } from '../../types';
import { getWorkspacePath } from '../../utilities';
import { resolveBin } from '../utilities/resolve-bin';
import { sandbox } from './sandbox';
import pc from 'picocolors';
import { tmpdir } from 'node:os';

export type BackgroundUpdate = {
  tool: 'execve';
  message: string;
};

interface BackgroundProcess {
  runId: string;
  children: ChildProcess[];
  startedAtIso: string;
  commandLine: string;
}

const MAX_CAPTURED_OUTPUT_BYTES = 200_000;
const SAFE_PATH =
  '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin';
const backgroundProcesses = new Map<string, BackgroundProcess>();
let shutdownHooksRegistered = false;

export type ExecveEnv = Record<string, string>;

export type ExecveToolParams = {
  command: string;
  args: string[];
  background: boolean;
  cwd: string | undefined;
  env?: ExecveEnv;
  input?: string;
  pty?: boolean;
  capture?: 'head' | 'tail';
  noOutputTimeoutMs?: number;
};

export type ExecTermination =
  | 'exit'
  | 'signal'
  | 'no-output-timeout'
  | 'start-error'
  | 'aborted';

function captureBytes(
  current: Buffer,
  chunk: Buffer,
  mode: 'head' | 'tail',
  maxBytes: number
): Buffer {
  if (maxBytes <= 0) return Buffer.alloc(0);
  if (mode === 'head') {
    if (current.length >= maxBytes) return current;
    const combined = Buffer.concat([current, chunk]) as Buffer;
    return combined.length > maxBytes
      ? (combined.subarray(0, maxBytes) as Buffer)
      : combined;
  }

  // tail: keep only the last maxBytes
  const combined = Buffer.concat([current, chunk]) as Buffer;
  return combined.length > maxBytes
    ? (combined.subarray(combined.length - maxBytes) as Buffer)
    : combined;
}

function wrapWithPty(
  command: string,
  args: string[]
): {
  spawnCommand: string;
  spawnArgs: string[];
  effectiveCommandLine: string;
} {
  // Use BSD/GNU `script` to allocate a PTY without shell parsing.
  // macOS: /usr/bin/script; Linux typically provides it via util-linux.
  const scriptPath = resolveBin('script');
  const binPath = resolveBin(command);
  const scriptArgs = ['-q', '/dev/null', binPath, ...args];
  return {
    spawnCommand: scriptPath,
    spawnArgs: scriptArgs,
    effectiveCommandLine: ['script', ...scriptArgs].join(' ').trim(),
  };
}

export type ExecResultDetails = {
  background: boolean;
  runId?: string;
  pid?: number;
  commandLine: string;
  cwd?: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  termination: ExecTermination;
  stdout: string;
  stderr: string;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  bytesStdoutTotal: number;
  bytesStderrTotal: number;
};

export type ExecveStopToolParams = {
  runId: string;
};

export type ExecvePipelineToolParams = {
  commands: { command: string; args: string[] }[];
  background: boolean;
  cwd: string | undefined;
  env?: ExecveEnv;
  input?: string;
  mergeStderrMode?: 'next' | 'collect-only' | 'last-merge';
  capture?: 'head' | 'tail';
  noOutputTimeoutMs?: number;
};

export async function runExec(
  params: { command: string; args: string[] },
  context: {
    signal?: AbortSignal;
    background: boolean;
    onFinished: (result: string) => void;
    onError: (error: string) => void;
    noOutputTimeoutMs?: number;
    cwd?: string;
    env?: ExecveEnv;
    input?: string;
    pty?: boolean;
    capture?: 'head' | 'tail';
    shouldSandbox?: boolean;
  }
): Promise<{ text: string; details: ExecResultDetails }> {
  const {
    signal,
    background,
    onFinished,
    onError,
    noOutputTimeoutMs,
    shouldSandbox,
  } = context;
  const { cwd, env, input, pty = false, capture = 'head' } = context;
  const { command, args } = params;
  const commandLine = [command, ...args].join(' ').trim();

  if (background) {
    registerShutdownHooksIfNeeded();
    const runId = nanoid(5);

    run({
      onSpawn(child) {
        backgroundProcesses.set(runId, {
          runId,
          children: [child],
          startedAtIso: new Date().toISOString(),
          commandLine,
        });
        child.once('close', () => {
          backgroundProcesses.delete(runId);
        });
      },
      stdin: typeof input === 'string' ? 'pipe' : 'ignore',
      detached: true,
      noOutputTimeoutMs,
      cwd,
      env,
      input,
      pty,
      capture,
    })
      .then((result) => {
        onFinished(
          `Result from execve() call with Run ID ${runId}:\n\n---\n\n${result.text}`
        );
      })
      .catch((error) => {
        onError(
          `execve() call with Run ID ${runId} threw an error:\n\n---\n\n${toErrorMessage(error)}`
        );
      });

    const pid = backgroundProcesses.get(runId)?.children[0]?.pid ?? null;
    const startedText = `Started command in background with run ID ${runId}${
      pid ? ` (pid: ${pid})` : ''
    }\nCommand: ${commandLine}`;
    return {
      text: startedText,
      details: {
        background: true,
        runId,
        pid: pid ?? undefined,
        commandLine,
        cwd,
        code: null,
        signal: null,
        termination: 'exit',
        stdout: '',
        stderr: '',
        truncatedStdout: false,
        truncatedStderr: false,
        bytesStdoutTotal: 0,
        bytesStderrTotal: 0,
      },
    };
  }

  const result = await run({
    stdin: typeof input === 'string' ? 'pipe' : 'inherit',
    detached: false,
    noOutputTimeoutMs,
    cwd,
    env,
    input,
    pty,
    capture,
  });
  return result;

  function run({
    stdin,
    onSpawn,
    detached,
    noOutputTimeoutMs,
    cwd,
    env,
    input,
    pty,
    capture,
  }: {
    stdin: 'inherit' | 'ignore' | 'pipe';
    onSpawn?: (child: ChildProcess) => void;
    detached: boolean;
    noOutputTimeoutMs?: number;
    cwd?: string;
    env?: ExecveEnv;
    input?: string;
    pty: boolean;
    capture: 'head' | 'tail';
  }) {
    return new Promise<{ text: string; details: ExecResultDetails }>(
      (resolve, reject) => {
        let stdoutCaptured: Buffer = Buffer.alloc(0) as Buffer;
        let stderrCaptured: Buffer = Buffer.alloc(0) as Buffer;
        let stdoutTotalBytes = 0;
        let stderrTotalBytes = 0;
        let outputTruncated = false;
        let errorTruncated = false;
        let noOutputTimedOut = false;
        let noOutputTimer: ReturnType<typeof setTimeout> | null = null;
        const { spawnCommand, spawnArgs, effectiveCommandLine } = pty
          ? wrapWithPty(command, args)
          : {
              spawnCommand: resolveBin(command),
              spawnArgs: args,
              effectiveCommandLine: commandLine,
            };

        const shouldTrackNoOutputTimeout =
          typeof noOutputTimeoutMs === 'number' &&
          Number.isFinite(noOutputTimeoutMs) &&
          noOutputTimeoutMs > 0;

        const sandboxed = shouldSandbox
          ? sandbox({
              command: spawnCommand,
              args: spawnArgs,
            })
          : { command: spawnCommand, args: spawnArgs };

        const child = spawn(sandboxed.command, sandboxed.args, {
          stdio: [stdin, 'pipe', 'pipe'],
          shell: false,
          detached,
          cwd,
          env: resolveEnv(env ?? {}),
        });

        onSpawn?.(child);

        if (stdin === 'pipe' && typeof input === 'string' && child.stdin) {
          child.stdin.write(input);
          child.stdin.end();
        }

        const clearNoOutputTimer = () => {
          if (!noOutputTimer) return;
          clearTimeout(noOutputTimer);
          noOutputTimer = null;
        };

        const armNoOutputTimer = () => {
          if (!shouldTrackNoOutputTimeout || settled) return;
          clearNoOutputTimer();
          noOutputTimer = setTimeout(() => {
            if (settled) return;
            noOutputTimedOut = true;
            killProcessSignal(child, 'SIGKILL');
          }, Math.floor(noOutputTimeoutMs));
          noOutputTimer.unref?.();
        };

        const finish = (result: {
          text: string;
          details: ExecResultDetails;
        }) => {
          cleanup();
          resolve(result);
        };

        const abort = () => {
          terminateProcessWithEscalation(child, 2000);
          cleanup();
          reject(new DOMException('Command aborted by user', 'AbortError'));
        };

        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          clearNoOutputTimer();
        };

        if (signal) {
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
        }

        armNoOutputTimer();

        child.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          armNoOutputTimer();
          stdoutTotalBytes += data.length;
          stdoutCaptured = captureBytes(
            stdoutCaptured,
            data,
            capture,
            MAX_CAPTURED_OUTPUT_BYTES
          );
          outputTruncated = stdoutTotalBytes > MAX_CAPTURED_OUTPUT_BYTES;
        });

        child.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          process.stderr.write(pc.red(text));
          armNoOutputTimer();
          stderrTotalBytes += data.length;
          stderrCaptured = captureBytes(
            stderrCaptured,
            data,
            capture,
            MAX_CAPTURED_OUTPUT_BYTES
          );
          errorTruncated = stderrTotalBytes > MAX_CAPTURED_OUTPUT_BYTES;
        });

        child.on('close', async (code, signal) => {
          if (settled) return;
          settled = true;
          const fullOutput = stdoutCaptured.toString('utf8');
          const fullError = stderrCaptured.toString('utf8');
          const combined =
            fullOutput + (fullError ? `\n[stderr]\n${fullError}` : '');

          if (noOutputTimedOut) {
            const details: ExecResultDetails = {
              background: false,
              commandLine: effectiveCommandLine,
              cwd,
              code,
              signal,
              termination: 'no-output-timeout',
              stdout: fullOutput,
              stderr: fullError,
              truncatedStdout: outputTruncated,
              truncatedStderr: errorTruncated,
              bytesStdoutTotal: stdoutTotalBytes,
              bytesStderrTotal: stderrTotalBytes,
            };
            const text =
              `Command killed due to no-output timeout (${Math.floor(
                noOutputTimeoutMs ?? 0
              )}ms)\n${combined}` +
              (outputTruncated || errorTruncated
                ? `\n\n[output truncated]\nCaptured up to ${MAX_CAPTURED_OUTPUT_BYTES} bytes of stdout and stderr each.`
                : '');
            resolve({ text, details });
            return;
          }

          const termination: ExecTermination =
            signal != null ? 'signal' : 'exit';
          const details: ExecResultDetails = {
            background: false,
            commandLine: effectiveCommandLine,
            cwd,
            code,
            signal,
            termination,
            stdout: fullOutput,
            stderr: fullError,
            truncatedStdout: outputTruncated,
            truncatedStderr: errorTruncated,
            bytesStdoutTotal: stdoutTotalBytes,
            bytesStderrTotal: stderrTotalBytes,
          };
          const text =
            (code !== 0 ? `Command exited with code ${code}\n` : '') +
            (combined.trim() === ''
              ? '(no output. exit code: ' + (code ?? 0) + ')'
              : combined) +
            (outputTruncated || errorTruncated
              ? `\n\n[output truncated]\nCaptured up to ${MAX_CAPTURED_OUTPUT_BYTES} bytes of stdout and stderr each.`
              : '');
          resolve({ text, details });
        });

        child.on('error', (error) => {
          const errorMsg = `Failed to start command: ${error.message}`;
          console.error(pc.red(errorMsg));
          finish({
            text: errorMsg,
            details: {
              background: false,
              commandLine: effectiveCommandLine,
              cwd,
              code: null,
              signal: null,
              termination: 'start-error',
              stdout: '',
              stderr: error.message,
              truncatedStdout: false,
              truncatedStderr: false,
              bytesStdoutTotal: 0,
              bytesStderrTotal: 0,
            },
          });
        });
      }
    );
  }
}

export function getExecTools(context: ToolContext): AgentTool[] {
  const defaultCwd = path.resolve(getWorkspacePath(context.config));
  const shouldSandbox = context.config.tools?.guard.enabled !== false;

  return [
    {
      name: 'execve',
      label: 'execve',
      description:
        'Run an OS command (argv-based, no shell). Prefer non-exec tools when possible.',
      parameters: Type.Object({
        command: Type.String({
          description:
            'Command to run (binary name or path). Executed argv-based with shell disabled.',
        }),
        args: Type.Array(
          Type.String({
            description: 'Arguments (argv) for the command',
          })
        ),
        background: Type.Boolean({
          description:
            'If true, start the command and return immediately. The final result is sent later as a background update. Use execve_stop to cancel.',
          default: true,
        }),
        cwd: Type.Optional(
          Type.String({
            description: 'Working directory to run the command in.',
          })
        ),
        env: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description:
              'Extra environment variables for the command (merged over the current process env).',
          })
        ),
        input: Type.Optional(
          Type.String({
            description:
              'Optional stdin text to provide to the command (non-interactive).',
          })
        ),
        pty: Type.Optional(
          Type.Boolean({
            description:
              'Run the command in a pseudo-terminal (PTY) when possible (for TTY-only CLIs).',
            default: false,
          })
        ),
        capture: Type.Optional(
          Type.Union([Type.Literal('head'), Type.Literal('tail')], {
            description:
              'Which part of output to capture when output is large: "head" (first bytes) or "tail" (last bytes). Default: head.',
          })
        ),
        noOutputTimeoutMs: Type.Optional(
          Type.Number({
            description:
              'Kill the command if it produces no stdout/stderr for this long (milliseconds). Timer resets on any output.',
            minimum: 1,
          })
        ),
      }),
      execute: async (_id, params, signal, _onUpdate) => {
        const {
          command,
          args,
          background,
          noOutputTimeoutMs,
          cwd,
          env,
          input,
          pty,
          capture,
        } = params as ExecveToolParams;

        const { text, details } = await runExec(
          { command, args },
          {
            signal,
            background,
            noOutputTimeoutMs,
            cwd: cwd ?? defaultCwd,
            env,
            input,
            pty,
            capture,
            shouldSandbox,
            onFinished: (result) => {
              context.onBackgroundUpdate({
                tool: 'execve',
                message: result,
              });
            },
            onError: (error) => {
              context.onBackgroundUpdate({
                tool: 'execve',
                message: error,
              });
            },
          }
        );

        return { content: [{ type: 'text' as const, text }], details };
      },
    },
    {
      name: 'execve_stop',
      label: 'execve stop',
      description: 'Stop a background execve run by run ID',
      parameters: Type.Object({
        runId: Type.String({
          description: 'Run ID returned by execve when background=true',
        }),
      }),
      execute: async (_id, params) => {
        const { runId } = params as ExecveStopToolParams;
        const entry = backgroundProcesses.get(runId) ?? null;
        if (!entry) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No running background execve process found for run ID ${runId}.`,
              },
            ],
            details: {},
          };
        }

        for (const child of entry.children) {
          terminateProcessWithEscalation(child, 2000);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Sent SIGTERM to background execve run ${runId} (pid: ${
                entry.children[0]?.pid ?? 'unknown'
              }). Will SIGKILL after 2000ms if it does not exit.\nCommand: ${entry.commandLine}`,
            },
          ],
          details: {},
        };
      },
    },
    {
      name: 'execve_pipeline',
      label: 'execve pipeline',
      description:
        'Run multiple commands connected by pipes (argv-based, no shell).',
      parameters: Type.Object({
        commands: Type.Array(
          Type.Object({
            command: Type.String({ description: 'Command to run' }),
            args: Type.Array(Type.String({ description: 'Arguments (argv)' })),
          }),
          { description: 'Pipeline steps in order (cmd1 | cmd2 | ...)' }
        ),
        background: Type.Boolean({
          description:
            'If true, start the pipeline and return immediately. The final result is sent later as a background update. Use execve_stop to cancel.',
          default: true,
        }),
        cwd: Type.Optional(
          Type.String({ description: 'Working directory for all commands.' })
        ),
        env: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description:
              'Extra environment variables for all commands (merged over current env).',
          })
        ),
        input: Type.Optional(
          Type.String({
            description:
              'Optional stdin text for the first command in the pipeline.',
          })
        ),
        mergeStderrMode: Type.Optional(
          Type.Union(
            [
              Type.Literal('next'),
              Type.Literal('collect-only'),
              Type.Literal('last-merge'),
            ],
            {
              description:
                'How to handle stderr in the pipeline. "collect-only" captures stderr but does not pipe it. "next" pipes each step’s stderr into the next step’s stdin (like "2>&1 |"). "last-merge" does not pipe stderr but merges it into the final returned stdout text.',
            }
          )
        ),
        capture: Type.Optional(
          Type.Union([Type.Literal('head'), Type.Literal('tail')], {
            description:
              'Which part of output to capture when output is large: "head" (first bytes) or "tail" (last bytes). Default: head.',
          })
        ),
        noOutputTimeoutMs: Type.Optional(
          Type.Number({
            description:
              'Kill the pipeline if it produces no stdout/stderr for this long (milliseconds). Timer resets on any output.',
            minimum: 1,
          })
        ),
      }),
      execute: async (_id, params, signal) => {
        const {
          commands,
          background,
          cwd,
          env,
          input,
          mergeStderrMode,
          capture,
          noOutputTimeoutMs,
        } = params as ExecvePipelineToolParams;

        const { text, details } = await runPipeline(commands, {
          signal,
          background,
          cwd: cwd ?? defaultCwd,
          env,
          input,
          mergeStderrMode,
          capture,
          noOutputTimeoutMs,
          shouldSandbox,
          onFinished: (result) => {
            context.onBackgroundUpdate({ tool: 'execve', message: result });
          },
          onError: (error) => {
            context.onBackgroundUpdate({ tool: 'execve', message: error });
          },
        });

        return { content: [{ type: 'text' as const, text }], details };
      },
    },
  ];
}

export function getExecInstructions(): string {
  return `
## Exec (OS commands)

You have access to three tools:

- \`execve\`: runs a command using argv (NO SHELL).
- \`execve_pipeline\`: runs multiple commands connected by pipes (argv-based, NO SHELL).
- \`execve_stop\`: stops a background \`execve\` / \`execve_pipeline\` run by run ID.

### \`execve\`

Use when you truly need an OS command. Prefer other tools (e.g. file tools, web tools) when possible.

**Important: this is argv-based (\`shell: false\`).**
This means the following shell features DO NOT work:

- Pipes/chaining/redirects: \`|\`, \`&&\`, \`;\`, \`>\`, \`>>\`, \`2>\`, \`<\`
- Globs/tilde/env expansion: \`*.ts\`, \`~/x\`, \`$HOME\`, \`$(cmd)\`
- Inline env prefixes: \`FOO=bar cmd ...\`

Because of that, pair \`execve\` with the Files tools instead of shell tricks:

- Replace redirects (\`>\`, \`>>\`) with \`write_file\` / \`append_file\`
- Replace \`cat file | tool\` with \`read_file\` + \`execve(input: ...)\`
- Replace globs (\`*.ts\`) with \`list_files(pattern: ...)\` to enumerate paths

### Sandbox constraints (sandbox-exec)

Commands run under a macOS sandbox profile with:

- Default-deny: filesystem writes are blocked.
- File reads are allowed (\`file-read*\`), so read-only operations on local files work.
- Network access is allowed (\`network*\`).

If you need to persist anything to disk (create/edit files), write it using the Files tools (e.g. \`write_file\`, \`append_file\`, \`patch_file\`) instead of relying on the command.

**Parameters**

- \`command\`: binary name/path (resolved via \`resolveBin\`), executed without a shell.
- \`args\`: argv array. Pass each token as a separate string.
- \`background\`:
  - \`false\`: wait for completion and return stdout/stderr.
  - \`true\`: return immediately with a run ID; the final result/error arrives later as a background update.
- \`pty\` (optional): when \`true\`, runs the command under a pseudo-terminal (PTY) for TTY-only CLIs (implemented via \`script\`). Prefer \`input\` for non-interactive stdin.
- \`capture\` (optional): \`"head"\` (default) captures the first bytes; \`"tail"\` captures the last bytes (ring-buffer). Useful when commands are noisy and the error is at the end.
- \`noOutputTimeoutMs\` (optional): kill the command if it produces no stdout/stderr for this long. Resets on any output.

**Stopping background runs**

If you started with either \`execve\` or \`execve_pipeline\` using \`background: true\`, keep the returned \`runId\`. To cancel:

- Call \`execve_stop\` with that \`runId\`.
- Stop uses SIGTERM and escalates to SIGKILL after ~2s if needed (best-effort).

**Choosing between background vs foreground**

- Use \`background: false\` for quick commands where you need the output to proceed.
- Use \`background: true\` for long-running work (builds, servers, indexing). If it might hang silently, set \`noOutputTimeoutMs\`.

**Common failure modes**

- “My glob didn’t expand”: pass explicit file paths (use file tools / list files first).
- “My pipeline didn’t work”: for \`|\` workflows use \`execve_pipeline\` with \`commands\`; otherwise run commands separately and feed outputs between steps.
- “It’s hanging”: use \`noOutputTimeoutMs\` and/or \`execve_stop\`.
- “Command not allowed”: the guard/allowlist blocked it; use an allowed alternative or ask for allowlist changes.

### \`execve_pipeline\`

Use when you need \`cmd1 | cmd2\`-style pipelines without a shell.

**Parameters**

- \`commands\`: array of steps, each { \`command\`, \`args\`} (argv tokens).
- \`background\`:
  - \`false\`: wait for completion and return output.
  - \`true\`: return immediately with a run ID; the final result/error arrives later as a background update (cancel with \`execve_stop\`).
- \`input\` (optional): stdin text for the first command in the pipeline.
- \`mergeStderrMode\` (optional): \`"next"\` / \`"collect-only"\` / \`"last-merge"\`.
- \`capture\` (optional): \`"head"\` (default) or \`"tail"\` when output is large.
- \`noOutputTimeoutMs\` (optional): kill the pipeline if it produces no stdout/stderr for this long.

### Missing tools you may want

If you repeatedly need any of the following, ask to add a dedicated tool instead of trying to force it through \`execve\`:

- **Structured FS writes**: a safe “write file” tool (rather than relying on shell redirects, which are unavailable).
`;
}

async function runPipeline(
  commands: { command: string; args: string[] }[],
  context: {
    signal?: AbortSignal;
    background: boolean;
    onFinished: (result: string) => void;
    onError: (error: string) => void;
    noOutputTimeoutMs?: number;
    cwd?: string;
    env?: ExecveEnv;
    input?: string;
    mergeStderrMode?: 'next' | 'collect-only' | 'last-merge';
    capture?: 'head' | 'tail';
    shouldSandbox: boolean;
  }
): Promise<{ text: string; details: ExecResultDetails }> {
  const {
    signal,
    background,
    onFinished,
    onError,
    noOutputTimeoutMs,
    cwd,
    env,
    input,
    mergeStderrMode = 'collect-only',
    capture = 'head',
    shouldSandbox,
  } = context;

  if (commands.length === 0) {
    return {
      text: 'No commands provided.',
      details: {
        background: false,
        commandLine: '',
        cwd,
        code: null,
        signal: null,
        termination: 'exit',
        stdout: '',
        stderr: 'No commands provided.',
        truncatedStdout: false,
        truncatedStderr: false,
        bytesStdoutTotal: 0,
        bytesStderrTotal: 0,
      },
    };
  }

  const commandLine = commands
    .map((c) => [c.command, ...c.args].join(' ').trim())
    .join(' | ');

  if (background) {
    registerShutdownHooksIfNeeded();
    const runId = nanoid(5);

    run({ detached: true, runId })
      .then((result) => {
        onFinished(
          `Result from execve_pipeline() call with Run ID ${runId}:\n\n---\n\n${result.text}`
        );
      })
      .catch((error) => {
        onError(
          `execve_pipeline() call with Run ID ${runId} threw an error:\n\n---\n\n${toErrorMessage(error)}`
        );
      });

    const pid = backgroundProcesses.get(runId)?.children[0]?.pid ?? null;
    const startedText = `Started pipeline in background with run ID ${runId}${
      pid ? ` (pid: ${pid})` : ''
    }\nPipeline: ${commandLine}`;
    return {
      text: startedText,
      details: {
        background: true,
        runId,
        pid: pid ?? undefined,
        commandLine,
        cwd,
        code: null,
        signal: null,
        termination: 'exit',
        stdout: '',
        stderr: '',
        truncatedStdout: false,
        truncatedStderr: false,
        bytesStdoutTotal: 0,
        bytesStderrTotal: 0,
      },
    };
  }

  return await run({ detached: false, runId: null });

  function run({
    detached,
    runId,
  }: {
    detached: boolean;
    runId: string | null;
  }) {
    return new Promise<{ text: string; details: ExecResultDetails }>(
      (resolve, reject) => {
        const resolvedEnv = resolveEnv(env ?? {});
        const children: ChildProcess[] = [];
        let settled = false;

        let stdoutCaptured: Buffer = Buffer.alloc(0) as Buffer;
        let stderrCaptured: Buffer = Buffer.alloc(0) as Buffer;
        let stdoutTotalBytes = 0;
        let stderrTotalBytes = 0;
        let outputTruncated = false;
        let errorTruncated = false;

        let noOutputTimedOut = false;
        let noOutputTimer: ReturnType<typeof setTimeout> | null = null;
        const shouldTrackNoOutputTimeout =
          typeof noOutputTimeoutMs === 'number' &&
          Number.isFinite(noOutputTimeoutMs) &&
          noOutputTimeoutMs > 0;

        const clearNoOutputTimer = () => {
          if (!noOutputTimer) return;
          clearTimeout(noOutputTimer);
          noOutputTimer = null;
        };

        const armNoOutputTimer = () => {
          if (!shouldTrackNoOutputTimeout || settled) return;
          clearNoOutputTimer();
          noOutputTimer = setTimeout(() => {
            if (settled) return;
            noOutputTimedOut = true;
            for (const child of children) {
              killProcessSignal(child, 'SIGKILL');
            }
          }, Math.floor(noOutputTimeoutMs));
          noOutputTimer.unref?.();
        };

        const abort = () => {
          for (const child of children) {
            terminateProcessWithEscalation(child, 2000);
          }
          cleanup();
          reject(new DOMException('Command aborted by user', 'AbortError'));
        };

        const cleanup = () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          clearNoOutputTimer();
        };

        if (signal) {
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
        }

        try {
          for (let index = 0; index < commands.length; index += 1) {
            const step = commands[index]!;
            const binPath = resolveBin(step.command);

            const sandboxed = shouldSandbox
              ? sandbox({
                  command: binPath,
                  args: step.args,
                })
              : { command: binPath, args: step.args };

            const child = spawn(sandboxed.command, sandboxed.args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              shell: false,
              detached,
              cwd,
              env: resolvedEnv,
            });
            children.push(child);
          }
        } catch (error) {
          cleanup();
          reject(error);
          return;
        }

        if (typeof runId === 'string') {
          backgroundProcesses.set(runId, {
            runId,
            children,
            startedAtIso: new Date().toISOString(),
            commandLine,
          });
          let remaining = children.length;
          for (const child of children) {
            child.once('close', () => {
              remaining -= 1;
              if (remaining <= 0) {
                backgroundProcesses.delete(runId);
              }
            });
          }
        }

        for (let index = 0; index < children.length - 1; index += 1) {
          const fromChild = children[index]!;
          const toChild = children[index + 1]!;
          if (fromChild.stdout && toChild.stdin) {
            // Avoid premature close when multiple sources feed stdin.
            fromChild.stdout.pipe(toChild.stdin, { end: false });
            let endedCount = 0;
            const maybeEnd = () => {
              endedCount += 1;
              if (endedCount >= (mergeStderrMode === 'next' ? 2 : 1)) {
                try {
                  toChild.stdin?.end();
                } catch {
                  // ignore
                }
              }
            };
            fromChild.stdout.once('end', maybeEnd);

            if (mergeStderrMode === 'next' && fromChild.stderr) {
              fromChild.stderr.pipe(toChild.stdin, { end: false });
              fromChild.stderr.once('end', maybeEnd);
            }
          }
        }

        const firstChild = children[0]!;
        if (typeof input === 'string' && firstChild.stdin) {
          firstChild.stdin.write(input);
          firstChild.stdin.end();
        } else if (firstChild.stdin) {
          firstChild.stdin.end();
        }

        const lastChild = children[children.length - 1]!;

        armNoOutputTimer();

        for (const child of children) {
          child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            process.stderr.write(pc.red(text));
            armNoOutputTimer();
            stderrTotalBytes += data.length;
            stderrCaptured = captureBytes(
              stderrCaptured,
              data,
              capture,
              MAX_CAPTURED_OUTPUT_BYTES
            );
            errorTruncated = stderrTotalBytes > MAX_CAPTURED_OUTPUT_BYTES;

            if (mergeStderrMode === 'last-merge') {
              stdoutTotalBytes += data.length;
              stdoutCaptured = captureBytes(
                stdoutCaptured,
                data,
                capture,
                MAX_CAPTURED_OUTPUT_BYTES
              );
              outputTruncated = stdoutTotalBytes > MAX_CAPTURED_OUTPUT_BYTES;
            }
          });

          child.on('error', (error) => {
            cleanup();
            reject(new Error(`Failed to start command: ${error.message}`));
          });
        }

        lastChild.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          armNoOutputTimer();
          stdoutTotalBytes += data.length;
          stdoutCaptured = captureBytes(
            stdoutCaptured,
            data,
            capture,
            MAX_CAPTURED_OUTPUT_BYTES
          );
          outputTruncated = stdoutTotalBytes > MAX_CAPTURED_OUTPUT_BYTES;
        });

        lastChild.on('close', (code, signal) => {
          if (settled) return;
          settled = true;
          clearNoOutputTimer();

          const fullOutput = stdoutCaptured.toString('utf8');
          const fullError = stderrCaptured.toString('utf8');
          const combined =
            fullOutput + (fullError ? `\n[stderr]\n${fullError}` : '');

          if (noOutputTimedOut) {
            const details: ExecResultDetails = {
              background: false,
              commandLine,
              cwd,
              code,
              signal,
              termination: 'no-output-timeout',
              stdout: fullOutput,
              stderr: fullError,
              truncatedStdout: outputTruncated,
              truncatedStderr: errorTruncated,
              bytesStdoutTotal: stdoutTotalBytes,
              bytesStderrTotal: stderrTotalBytes,
            };
            const text =
              `Pipeline killed due to no-output timeout (${Math.floor(
                noOutputTimeoutMs ?? 0
              )}ms)\n${combined}` +
              (outputTruncated || errorTruncated
                ? `\n\n[output truncated]\nCaptured up to ${MAX_CAPTURED_OUTPUT_BYTES} bytes of stdout and stderr each.`
                : '');
            resolve({ text, details });
            return;
          }

          const termination: ExecTermination =
            signal != null ? 'signal' : 'exit';
          const details: ExecResultDetails = {
            background: false,
            commandLine,
            cwd,
            code,
            signal,
            termination,
            stdout: fullOutput,
            stderr: fullError,
            truncatedStdout: outputTruncated,
            truncatedStderr: errorTruncated,
            bytesStdoutTotal: stdoutTotalBytes,
            bytesStderrTotal: stderrTotalBytes,
          };
          const text =
            (code !== 0 ? `Pipeline exited with code ${code}\n` : '') +
            (combined.trim() === '' ? '(no output. exit code: 0)' : combined) +
            (outputTruncated || errorTruncated
              ? `\n\n[output truncated]\nCaptured up to ${MAX_CAPTURED_OUTPUT_BYTES} bytes of stdout and stderr each.`
              : '');
          resolve({ text, details });
        });
      }
    );
  }
}

function resolveEnv(extraEnv: ExecveEnv): NodeJS.ProcessEnv {
  const mergedEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DYLD_')) {
      continue;
    }
    if (key === 'PATH') {
      continue;
    }
    mergedEnv[key] = value;
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    if (key.startsWith('DYLD_')) {
      continue;
    }
    if (key === 'PATH') {
      continue;
    }
    mergedEnv[key] = String(value);
  }

  mergedEnv.PATH = SAFE_PATH;
  return mergedEnv;
}

function registerShutdownHooksIfNeeded() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const shutdown = () => {
    for (const { children } of backgroundProcesses.values()) {
      for (const child of children) {
        terminateProcessWithEscalation(child, 2000);
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', shutdown);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function killProcessSignal(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM'
) {
  if (!child.pid) return;

  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // fall back to direct kill below
  }

  try {
    child.kill(signal);
  } catch {
    // process may already be gone
  }
}

function terminateProcessWithEscalation(
  child: ChildProcess,
  termGraceMs = 2000
) {
  if (!child.pid) return;

  let killTimer: ReturnType<typeof setTimeout> | null = null;

  const clearKillTimer = () => {
    if (!killTimer) return;
    clearTimeout(killTimer);
    killTimer = null;
  };

  child.once('close', clearKillTimer);

  killProcessSignal(child, 'SIGTERM');

  killTimer = setTimeout(() => {
    if (!child.pid) return;
    killProcessSignal(child, 'SIGKILL');
  }, termGraceMs);

  killTimer.unref?.();
}
