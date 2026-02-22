import type { Tool } from './types';
import { spawn } from 'child_process';
import pc from 'picocolors';

export const runTerminalCommandTool: Tool<{ command: string }> = {
  spec: {
    name: 'exec',
    description: 'Run a command in the terminal.',
    input_schema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          description: 'The command to run',
        },
      },
    },
  },
  handler: async ({ command }) => {
    return new Promise((resolve) => {
      const output: string[] = [];
      const errorOutput: string[] = [];

      // Parse command and arguments
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      console.info(pc.cyan(`\n[exec] Running: ${command}\n`));

      const child = spawn(cmd, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true,
      });

      // Stream stdout live
      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(text);
        output.push(text);
      });

      // Stream stderr live
      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stderr.write(pc.red(text));
        errorOutput.push(text);
      });

      child.on('close', (code) => {
        const fullOutput = output.join('');
        const fullError = errorOutput.join('');
        const combined = fullOutput + (fullError ? `\n[stderr]\n${fullError}` : '');
        
        if (code !== 0) {
          resolve({
            content: `Command exited with code ${code}\n${combined}`,
          });
        } else {
          resolve({ content: combined || '(no output)' });
        }
      });

      child.on('error', (error) => {
        const errorMsg = `Failed to start command: ${error.message}`;
        console.error(pc.red(errorMsg));
        resolve({ content: errorMsg });
      });
    });
  },
};
