import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn } from 'child_process';
import { isSafe, available as isGuardAvailable } from './utilities/guard/guard';
import type { AgentConfig } from '../types';
import {
  getAllowlistForCommand,
  saveAlwaysAllowPreferenceForCommand,
} from './utilities/allowlist';
import { sendMessage } from '../../../clients/telegram/utilities';
import pc from 'picocolors';

/** First token of a segment, respecting single/double quotes. */
function firstToken(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return '';
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  const match = trimmed.match(/^([^\s|&;]+)/);
  return match ? match[1] : (trimmed.split(/\s/)[0] ?? '');
}

/** First token of each pipeline/chain segment (split by |, &&, ||, ;). */
function commandTokens(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];
  const segments = trimmed.split(/\s*(?:&&|\|\||\||;)\s*/);
  return segments.map((seg) => firstToken(seg)).filter(Boolean);
}

export async function runExec(
  params: { command: string },
  signal: AbortSignal,
  config: AgentConfig
): Promise<string> {
  const { command } = params;
  const options = getAllowlistForCommand(command, config);

  if (config.tools.guard?.enabled && !options.allow) {
    const reply = await sendMessage(
      `💂 Greg is asking to run a command.\n\n\`\`\`\n${command}\n\`\`\`\n\n/yes /no /always`,
      {
        awaitReply: true,
      }
    );

    if (reply !== '/yes' && reply !== '/always') {
      return Promise.resolve(
        `Command not allowed: ${command}. Permission was denied by the user. User replied: "${reply}".`
      );
    }

    if (reply === '/always') {
      await saveAlwaysAllowPreferenceForCommand(command, config);
    }
  }

  return new Promise<string>((resolve, reject) => {
    const output: string[] = [];
    const errorOutput: string[] = [];

    const trimmed = command.trim();
    const commands = commandTokens(trimmed);

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
        if ((await isGuardAvailable(config)) && !options.trusted) {
          const result = await isSafe(config, combined, {
            name: commands[0],
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

export function getExecTools(config: AgentConfig): AgentTool[] {
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
          config
        );
        return { content: [{ type: 'text' as const, text }], details: {} };
      },
    },
  ];
}
