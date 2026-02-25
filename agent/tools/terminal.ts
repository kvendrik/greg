import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { spawn } from 'child_process';
import pc from 'picocolors';

export function createExecTool(signal: AbortSignal): BetaRunnableTool {
  return {
    name: 'exec',
    description: 'Run a command in the terminal.',
    input_schema: {
      type: 'object' as const,
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          description: 'The command to run',
        },
      },
    },
    parse: (content: unknown) => content as { command: string },
    run: async ({ command }: { command: string }) => {
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
          signal.removeEventListener('abort', abort);
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
          process.stdout.write(pc.gray(text));
          output.push(text);
        });

        child.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          process.stderr.write(pc.red(text));
          errorOutput.push(text);
        });

        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          const fullOutput = output.join('');
          const fullError = errorOutput.join('');
          const combined =
            fullOutput + (fullError ? `\n[stderr]\n${fullError}` : '');

          if (code !== 0) {
            resolve(`Command exited with code ${code}\n${combined}`);
          } else {
            resolve(combined || '(no output)');
          }
        });

        child.on('error', (error) => {
          const errorMsg = `Failed to start command: ${error.message}`;
          console.error(pc.red(errorMsg));
          finish(errorMsg);
        });
      });
    },
  };
}
