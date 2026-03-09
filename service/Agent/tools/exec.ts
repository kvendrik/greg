import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn } from 'child_process';
import { isSafe, available as isGuardAvailable } from './utilities/guard/guard';
import type { AgentConfig } from '../types';
import { evaluatePolicy } from './utilities/guard/policy/policy';
import { getAllowlistForCommand } from './utilities/guard/policy/allowlist';
import pc from 'picocolors';

export async function runExec(
  params: { command: string },
  signal: AbortSignal,
  config: AgentConfig,
  options: {
    addToTranscript: (content: string) => void;
  }
): Promise<string> {
  const { command } = params;

  const policy = await evaluatePolicy('exec', { command }, config, options);

  if (!policy.allowed) {
    return policy.reason;
  }

  return new Promise<string>((resolve, reject) => {
    const output: string[] = [];
    const errorOutput: string[] = [];

    const child = spawn(command, [], {
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
        const guardUse = config.tools.guard?.use ?? 'all';
        const { trusted } = getAllowlistForCommand(command, config);
        if ((await isGuardAvailable(config)) && !trusted) {
          const result = await isSafe(config, combined, {
            name: command.split(' ')[0],
            use: guardUse,
          });

          if (!result.safe) {
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

export function getExecTools(
  config: AgentConfig,
  options: {
    addToTranscript: (content: string) => void;
  }
): AgentTool[] {
  return [
    {
      name: 'exec',
      label: 'exec',
      description: 'Run a command in the terminal.',
      parameters: Type.Object({
        command: Type.String({ description: 'The command to run' }),
      }),
      execute: async (_id, params, signal, _onUpdate) => {
        const { command } = params as { command: string };
        const text = await runExec(
          { command },
          signal ?? new AbortController().signal,
          config,
          options
        );
        return { content: [{ type: 'text' as const, text }], details: {} };
      },
    },
  ];
}
