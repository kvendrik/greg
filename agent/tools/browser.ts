import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { AgentConfig, ToolContext } from '../types';

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

function readRecordProp(record: object, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return (record as Record<string, unknown>)[key];
}

function formatBrowserResultValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[Unserializable result]';
  }
}

function getProc(config: AgentConfig): {
  proc: ChildProcess;
  rl: readline.Interface;
} {
  const browserConfig = config.tools.browser ?? null;

  if (!browserConfig) {
    throw new Error('Browser tool is not configured (config.tools.browser).');
  }

  const currentProc = proc;
  const currentRl = rl;
  const needsSpawn =
    currentProc === null ||
    currentRl === null ||
    currentProc.exitCode !== null;

  if (needsSpawn) {
    const newProc = spawn('uv', ['run', 'scripts/browser-use.py'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, BROWSER_USE_API_KEY: browserConfig.key },
      detached: true, // New process group so we can kill the whole tree (uv → python → browser) on abort
    });

    const newRl = readline.createInterface({ input: newProc.stdout });

    newProc.on('exit', (code) => {
      console.error(`[browser-agent] exited with code ${code}`);
      proc = null;
      rl = null;
    });

    proc = newProc;
    rl = newRl;
    return { proc: newProc, rl: newRl };
  }

  return { proc: currentProc, rl: currentRl };
}

export function runBrowserTask(
  task: string,
  signal: AbortSignal,
  config: AgentConfig
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { proc: child, rl: readLine } = getProc(config);
    const childStdin = child.stdin;

    const onLine = (line: string): void => {
      removeListeners();
      try {
        const raw: unknown = JSON.parse(line);
        if (typeof raw !== 'object' || raw === null) {
          reject(new Error(`Failed to parse response: ${line}`));
          return;
        }
        const statusUnknown = readRecordProp(raw, 'status');
        if (typeof statusUnknown !== 'string') {
          reject(new Error(`Failed to parse response: ${line}`));
          return;
        }
        if (statusUnknown === 'error') {
          const resultUnknown = readRecordProp(raw, 'result');
          const errText =
            typeof resultUnknown === 'string'
              ? resultUnknown
              : formatBrowserResultValue(resultUnknown);
          reject(new Error(errText));
          return;
        }
        if (
          statusUnknown === 'aborted' ||
          statusUnknown === 'nothing_to_abort'
        ) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const resultUnknown = readRecordProp(raw, 'result');
        const resultText =
          typeof resultUnknown === 'string'
            ? normalizeSpacing(resultUnknown)
            : formatBrowserResultValue(resultUnknown);
        resolve(' ' + resultText);
      } catch {
        reject(new Error(`Failed to parse response: ${line}`));
      }
    };

    const onAbort = (): void => {
      removeListeners();
      try {
        if (childStdin !== null) {
          childStdin.write(
            JSON.stringify({ action: 'abort' }) + '\n',
            () => {}
          );
        }
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

    const removeListeners = (): void => {
      signal.removeEventListener('abort', onAbort);
      readLine.removeListener('line', onLine);
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    readLine.once('line', onLine);

    if (childStdin === null) {
      removeListeners();
      reject(new Error('Browser subprocess stdin is not available.'));
      return;
    }
    childStdin.write(JSON.stringify({ task }) + '\n', (err) => {
      if (err) {
        removeListeners();
        reject(err);
      }
    });
  });
}

export function getBrowserTools(context: ToolContext): AgentTool[] {
  const config = context.config;
  return config.tools.browser
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
                signal ?? new AbortController().signal,
                config
              );
              return {
                content: [{ type: 'text' as const, text }],
                details: {},
              };
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
}

export function cleanup(): void {
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

export function getBrowserInstructions(): string {
  return `
## Browser Automation

When using the \`run_browser_task\` tool, you MUST first read the browser-usage skill.
`;
}
