import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';

let proc: ChildProcess | null = null;
let rl: readline.Interface | null = null;

function getProc(): { proc: ChildProcess; rl: readline.Interface } {
  if (!proc || proc.exitCode !== null) {
    proc = spawn('uv', ['run', '--env-file=.env', 'scripts/browser-use.py'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    rl = readline.createInterface({ input: proc.stdout! });

    proc.on('exit', (code) => {
      console.error(`[browser-agent] exited with code ${code}`);
      proc = null;
      rl = null;
    });
  }

  return { proc, rl: rl! };
}

function runBrowserTask(task: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const { proc, rl } = getProc();

    const onLine = (line: string) => {
      cleanup();
      try {
        const msg = JSON.parse(line);
        if (msg.status === 'error') reject(new Error(msg.result));
        else if (msg.status === 'aborted' || msg.status === 'nothing_to_abort')
          reject(new DOMException('Aborted', 'AbortError'));
        else resolve(msg.result);
      } catch (e) {
        reject(new Error(`Failed to parse response: ${line}`));
      }
    };

    const onAbort = () => {
      cleanup();
      proc.stdin!.write(JSON.stringify({ action: 'abort' }) + '\n', () => {});
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      rl.removeListener('line', onLine);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    rl.once('line', onLine);

    proc.stdin!.write(JSON.stringify({ task }) + '\n', (err) => {
      if (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

export function create(signal: AbortSignal): BetaRunnableTool {
  return {
    name: 'run_browser_task',
    description:
      'Runs a task in a persistent browser session. The browser stays alive between calls so you can chain tasks that build on each other.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task to perform in the browser.',
        },
      },
      required: ['task'],
    },
    parse: (c) => c as { task: string },
    run: async ({ task }) => runBrowserTask(task, signal),
  };
}

export function cleanup() {
  proc?.kill();
  proc = null;
  rl = null;
}
