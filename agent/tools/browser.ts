import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';

import config from '../../.greg';

let proc: ChildProcess | null = null;
let rl: readline.Interface | null = null;

/**
 * Kill the browser subprocess tree. On Unix we kill the process group (child was
 * spawned with detached: true so it leads its own group). On Windows process
 * groups are not supported, so we only kill the direct child.
 */
function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }
  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }
  // Negative PID targets the process group (POSIX). The child was spawned with
  // detached: true so it leads its own group; this kills uv, python, and browser.
  process.kill(-child.pid, 'SIGTERM');
}

/** Ensure space after sentence-ending punctuation so concatenated fragments read correctly. */
function normalizeSpacing(text: string): string {
  return text
    .replace(/\.([A-Za-z])/g, '. $1')
    .replace(/!([A-Za-z])/g, '! $1')
    .replace(/\?([A-Za-z])/g, '? $1');
}

function getProc(): { proc: ChildProcess; rl: readline.Interface } {
  const browserConfig = config.tools.browser;
  if (!browserConfig) {
    throw new Error('Browser tool is not configured (config.tools.browser).');
  }
  if (proc?.exitCode !== null) {
    proc = spawn('uv', ['run', 'scripts/browser-use.py'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, BROWSER_USE_API_KEY: browserConfig.key },
      detached: true, // New process group so we can kill the whole tree (uv → python → browser) on abort
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

export function runBrowserTask(
  task: string,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { proc: child, rl: readLine } = getProc();

    const onLine = (line: string) => {
      removeListeners();
      try {
        const msg = JSON.parse(line);
        if (msg.status === 'error') reject(new Error(msg.result));
        else if (msg.status === 'aborted' || msg.status === 'nothing_to_abort')
          reject(new DOMException('Aborted', 'AbortError'));
        else
          resolve(
            ' ' +
              (typeof msg.result === 'string'
                ? normalizeSpacing(msg.result)
                : String(msg.result ?? ''))
          );
      } catch {
        reject(new Error(`Failed to parse response: ${line}`));
      }
    };

    const onAbort = () => {
      removeListeners();
      try {
        child.stdin!.write(
          JSON.stringify({ action: 'abort' }) + '\n',
          () => {}
        );
      } catch {
        // stdin may already be closed
      }
      try {
        killProcessTree(child);
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // Process may already be gone
        }
      }
      proc = null;
      rl = null;
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const removeListeners = () => {
      signal.removeEventListener('abort', onAbort);
      readLine.removeListener('line', onLine);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    readLine.once('line', onLine);

    child.stdin!.write(JSON.stringify({ task }) + '\n', (err) => {
      if (err) {
        removeListeners();
        reject(err);
      }
    });
  });
}

export const tools: AgentTool[] = config.tools.browser
  ? [
      {
        name: 'run_browser_task',
        label: 'run browser task',
        description:
          'Runs one task in a persistent browser session. Send one clear action per call (e.g. "Open klm.nl" or "Search for flights"); do not send multi-step instructions in a single task. The browser stays alive between calls so you can chain steps.',
        parameters: Type.Object({
          task: Type.String({
            description: 'The task to perform in the browser.',
          }),
        }),
        execute: async (_id, params, signal, _onUpdate) => {
          const { task } = params as { task: string };
          try {
            const text = await runBrowserTask(
              task,
              signal ?? new AbortController().signal
            );
            return { content: [{ type: 'text' as const, text }], details: {} };
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              return {
                content: [
                  { type: 'text' as const, text: '(Task was aborted.)' },
                ],
                details: {},
              };
            }
            throw err;
          }
        },
      },
    ]
  : [];

export function cleanup() {
  if (proc !== null) {
    try {
      killProcessTree(proc);
    } catch {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may already be gone
      }
    }
  }
  proc = null;
  rl = null;
}

export const instructions = `
## Browser Automation

When using the \`run_browser_task\` tool, you MUST first read the browser-usage skill.
`;
