import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn } from 'child_process';
import type { ToolContext } from '../types';
import { evaluatePolicy } from './utilities/policy';
import pc from 'picocolors';

export async function runExec(
  params: { command: string },
  signal: AbortSignal,
  context: ToolContext
): Promise<string> {
  const { command } = params;

  const policy = await evaluatePolicy('exec', { command }, context);

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
        resolve(
          combined.trim() === ''
            ? '(no output. exit code: ' + code + ')'
            : combined
        );
      }
    });

    child.on('error', (error) => {
      const errorMsg = `Failed to start command: ${error.message}`;
      console.error(pc.red(errorMsg));
      finish(errorMsg);
    });
  });
}

export function getExecTools(context: ToolContext): AgentTool[] {
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
          context
        );
        return { content: [{ type: 'text' as const, text }], details: {} };
      },
    },
  ];
}
