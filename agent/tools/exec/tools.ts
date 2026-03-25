import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import path from 'node:path';
import type { ToolContext } from '../../types';
import { getWorkspacePath } from '../../utilities';
import { resolveBin } from '../utilities/resolve-bin';
import { sandbox } from './policy/sandbox';
import {
  run,
  runPipeline,
  stopBackgroundRun,
  type BackgroundUpdate,
  type CommandSpec,
} from './runner';

export type { BackgroundUpdate };

export type ExecveToolParams = {
  command: string;
  args: string[];
  background: boolean;
  input: string | undefined;
  pty: boolean | undefined;
};

type ExecveStopToolParams = {
  runId: string;
};

export type ExecvePipelineToolParams = {
  commands: { command: string; args: string[] }[];
  background: boolean;
  input: string | undefined;
};

function wrapWithPty(command: string, args: string[]): CommandSpec {
  const scriptPath = resolveBin('script');
  const binPath = resolveBin(command);
  return {
    command: scriptPath,
    args: ['-q', '/dev/null', binPath, ...args],
  };
}

function prepareCommand(
  spec: CommandSpec,
  guardEnabled: boolean,
  config: ToolContext['config']
): CommandSpec {
  const binPath = resolveBin(spec.command);
  const resolved = { command: binPath, args: spec.args };
  if (!guardEnabled) return resolved;
  return sandbox(resolved, config);
}

export function getExecTools(context: ToolContext): AgentTool[] {
  const defaultCwd = path.resolve(getWorkspacePath(context.config));
  const guardEnabled = context.config.tools.guard.enabled;
  process.chdir(defaultCwd);

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
      }),
      execute: async (_id, params, signal, _onUpdate) => {
        const { command, args, background, input, pty } =
          params as ExecveToolParams;

        const spec = pty
          ? wrapWithPty(command, args)
          : { command: resolveBin(command), args };

        const prepared = guardEnabled ? sandbox(spec, context.config) : spec;

        const text = await run(prepared, {
          signal,
          background,
          stdin: input,
          onFinished: (result) => {
            context.onBackgroundUpdate({ tool: 'execve', message: result });
          },
          onError: (error) => {
            context.onBackgroundUpdate({ tool: 'execve', message: error });
          },
        });

        return { content: [{ type: 'text' as const, text }], details: {} };
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
      execute: (_id, params) => {
        const { runId } = params as ExecveStopToolParams;
        const found = stopBackgroundRun(runId);

        if (!found) {
          return Promise.resolve({
            content: [
              {
                type: 'text' as const,
                text: `No running background execve process found for run ID ${runId}.`,
              },
            ],
            details: {},
          });
        }

        return Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: `Sent SIGTERM to background run ${runId}. Will SIGKILL after 2000ms if it does not exit.`,
            },
          ],
          details: {},
        });
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
        input: Type.Optional(
          Type.String({
            description:
              'Optional stdin text for the first command in the pipeline.',
          })
        ),
      }),
      execute: async (_id, params, signal) => {
        const { commands, background, input } =
          params as ExecvePipelineToolParams;

        const prepared = commands.map((cmd) =>
          prepareCommand(cmd, guardEnabled, context.config)
        );

        const text = await runPipeline(prepared, {
          signal,
          background,
          stdin: input,
          onFinished: (result) => {
            context.onBackgroundUpdate({ tool: 'execve', message: result });
          },
          onError: (error) => {
            context.onBackgroundUpdate({ tool: 'execve', message: error });
          },
        });

        return { content: [{ type: 'text' as const, text }], details: {} };
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
- A Chromium/Codex-style \`sysctl-read\` allowlist so JIT runtimes (e.g. Bun) can start; without it they may exit immediately with no output.

\`/usr/bin/open\` is **not** wrapped in sandbox-exec: Launch Services needs IPC the profile does not grant, and wrapping it breaks opening URLs/files in the default app.

If you need to persist anything to disk (create/edit files), write it using the Files tools (e.g. \`write_file\`, \`append_file\`, \`patch_file\`) instead of relying on the command.

**Parameters**

- \`command\`: binary name/path (resolved via \`resolveBin\`), executed without a shell.
- \`args\`: argv array. Pass each token as a separate string.
- \`background\`:
  - \`false\`: wait for completion and return stdout/stderr.
  - \`true\`: return immediately with a run ID; the final result/error arrives later as a background update.
- \`pty\` (optional): when \`true\`, runs the command under a pseudo-terminal (PTY) for TTY-only CLIs (implemented via \`script\`). Prefer \`input\` for non-interactive stdin.

**Stopping background runs**

If you started with either \`execve\` or \`execve_pipeline\` using \`background: true\`, keep the returned \`runId\`. To cancel:

- Call \`execve_stop\` with that \`runId\`.
- Stop uses SIGTERM and escalates to SIGKILL after ~2s if needed (best-effort).

**Choosing between background vs foreground**

- Use \`background: false\` for quick commands where you need the output to proceed.
- Use \`background: true\` for long-running work (builds, servers, indexing).

**Common failure modes**

- "My glob didn't expand": pass explicit file paths (use file tools / list files first).
- "My pipeline didn't work": for \`|\` workflows use \`execve_pipeline\` with \`commands\`; otherwise run commands separately and feed outputs between steps.
- "It's hanging": use \`execve_stop\`.
- "Command not allowed": the guard/allowlist blocked it; use an allowed alternative or ask for allowlist changes.

### \`execve_pipeline\`

Use when you need \`cmd1 | cmd2\`-style pipelines without a shell.

**Parameters**

- \`commands\`: array of steps, each { \`command\`, \`args\`} (argv tokens).
- \`background\`:
  - \`false\`: wait for completion and return output.
  - \`true\`: return immediately with a run ID; the final result/error arrives later as a background update (cancel with \`execve_stop\`).
- \`input\` (optional): stdin text for the first command in the pipeline.

### Missing tools you may want

If you repeatedly need any of the following, ask to add a dedicated tool instead of trying to force it through \`execve\`:

- **Structured FS writes**: a safe "write file" tool (rather than relying on shell redirects, which are unavailable).
`;
}
