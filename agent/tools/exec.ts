import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn } from 'child_process';
import { isSafe } from './utilities/guard/guard';
import config from '../../.greg';
import { isCommandAllowed } from './utilities/safe-commands';
import pc from 'picocolors';

export async function runExec(
  params: { command: string },
  signal: AbortSignal
): Promise<string> {
  const { command } = params;
  return new Promise<string>((resolve, reject) => {
    const output: string[] = [];
    const errorOutput: string[] = [];

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const child = spawn(cmd, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    child.unref();

    const finish = (result: string) => {
      cleanup();
      resolve(result);
    };

    const abort = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // process may already be gone
      }
      cleanup();
      reject(new DOMException('Command aborted by user', 'AbortError'));
    };

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
    };

    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output.push(text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(pc.red(text));
      errorOutput.push(text);
    });

    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      const fullOutput = output.join('');
      const fullError = errorOutput.join('');
      let combined = fullOutput + (fullError ? `\n[stderr]\n${fullError}` : '');

      if (code !== 0) {
        resolve(`Command exited with code ${code}\n${combined}`);
      } else {
        const isAllowed = isCommandAllowed(command);
        const commandOptions =
          config.tools.guard?.allowlist?.exec?.[cmd] ?? null;

        if (
          config.tools.guard?.enabled &&
          !commandOptions?.trusted &&
          !isAllowed
        ) {
          console.log(`[Guard] Running guard on output for "${cmd}".`);

          const result = await isSafe(combined, {
            use:
              commandOptions?.trusted === false
                ? commandOptions?.use
                : config.tools.guard?.use,
          });

          console.log(
            `[Guard] Done running guard on output for "${cmd}" (took ${result.performance}). Flagged as ${result.safe ? 'safe' : `unsafe. Reason: ${result.reason}`}.`
          );

          if (result.safe === false) {
            combined = result.message;
          }
        }

        resolve(combined || '(no output)');
      }
    });

    child.on('error', (error) => {
      const errorMsg = `Failed to start command: ${error.message}`;
      console.error(pc.red(errorMsg));
      finish(errorMsg);
    });
  });
}

export const tools: AgentTool[] = [
  {
    name: 'exec',
    label: 'exec',
    description: 'Run a command in the terminal.',
    parameters: Type.Object({
      command: Type.String({ description: 'The command to run' }),
    }),
    execute: async (_id, params, signal, _onUpdate) => {
      const { command } = params as { command: string };
      const text = await runExec({ command }, signal);
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  },
];
