import { spawn, type ChildProcess } from 'child_process';
import { nanoid } from 'nanoid';
import pc from 'picocolors';

export type CommandSpec = {
  command: string;
  args: string[];
};

type RunContext = {
  signal: AbortSignal | undefined;
  background: boolean;
  onFinished: (result: string) => void;
  onError: (error: string) => void;
  stdin: string | undefined;
};

export type BackgroundUpdate = {
  tool: 'execve';
  message: string;
};

const MAX_CAPTURED_BYTES = 200_000;
const NO_OUTPUT_TIMEOUT_MS = 60_000;
const SAFE_PATH =
  '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin';

interface BackgroundProcess {
  runId: string;
  children: ChildProcess[];
  commandLine: string;
}

const backgroundProcesses = new Map<string, BackgroundProcess>();
let shutdownHooksRegistered = false;

export async function run(
  command: CommandSpec,
  context: RunContext
): Promise<string> {
  const commandLine = [command.command, ...command.args].join(' ').trim();

  if (context.background) {
    registerShutdownHooks();
    const runId = nanoid(5);

    spawnAndCapture({
      children: [command],
      commandLine,
      runId,
      signal: context.signal,
      stdin: context.stdin,
      detached: true,
    })
      .then((output) => {
        context.onFinished(
          `Result from execve() call with Run ID ${runId}:\n\n---\n\n${output}`
        );
      })
      .catch((error: unknown) => {
        context.onError(
          `execve() call with Run ID ${runId} threw an error:\n\n---\n\n${toErrorMessage(error)}`
        );
      });

    const pid = backgroundProcesses.get(runId)?.children[0]?.pid ?? null;
    return `Started command in background with run ID ${runId}${
      pid ? ` (pid: ${pid})` : ''
    }\nCommand: ${commandLine}`;
  }

  return spawnAndCapture({
    children: [command],
    commandLine,
    runId: null,
    signal: context.signal,
    stdin: context.stdin,
    detached: false,
  });
}

export async function runPipeline(
  commands: CommandSpec[],
  context: RunContext
): Promise<string> {
  if (commands.length === 0) {
    return 'No commands provided.';
  }

  const commandLine = commands
    .map((cmd) => [cmd.command, ...cmd.args].join(' ').trim())
    .join(' | ');

  if (context.background) {
    registerShutdownHooks();
    const runId = nanoid(5);

    spawnAndCapture({
      children: commands,
      commandLine,
      runId,
      signal: context.signal,
      stdin: context.stdin,
      detached: true,
    })
      .then((output) => {
        context.onFinished(
          `Result from execve_pipeline() call with Run ID ${runId}:\n\n---\n\n${output}`
        );
      })
      .catch((error: unknown) => {
        context.onError(
          `execve_pipeline() call with Run ID ${runId} threw an error:\n\n---\n\n${toErrorMessage(error)}`
        );
      });

    const pid = backgroundProcesses.get(runId)?.children[0]?.pid ?? null;
    return `Started pipeline in background with run ID ${runId}${
      pid ? ` (pid: ${pid})` : ''
    }\nPipeline: ${commandLine}`;
  }

  return spawnAndCapture({
    children: commands,
    commandLine,
    runId: null,
    signal: context.signal,
    stdin: context.stdin,
    detached: false,
  });
}

export function stopBackgroundRun(runId: string): boolean {
  const entry = backgroundProcesses.get(runId);
  if (!entry) return false;

  for (const child of entry.children) {
    terminateWithEscalation(child);
  }
  return true;
}

function spawnAndCapture(params: {
  children: CommandSpec[];
  commandLine: string;
  runId: string | null;
  signal: AbortSignal | undefined;
  stdin: string | undefined;
  detached: boolean;
}): Promise<string> {
  const { commandLine, runId, signal, stdin, detached } = params;
  const isPipeline = params.children.length > 1;

  return new Promise<string>((resolve, reject) => {
    let stdoutBuf = Buffer.alloc(0) as Buffer;
    let stderrBuf = Buffer.alloc(0) as Buffer;
    let stdoutTotal = 0;
    let stderrTotal = 0;
    let timedOut = false;
    let settled = false;
    let noOutputTimer: ReturnType<typeof setTimeout> | null = null;

    const children: ChildProcess[] = [];

    const clearTimer = (): void => {
      if (!noOutputTimer) return;
      clearTimeout(noOutputTimer);
      noOutputTimer = null;
    };

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      clearTimer();
    };

    const abort = (): void => {
      for (const child of children) {
        terminateWithEscalation(child);
      }
      cleanup();
      reject(new DOMException('Command aborted by user', 'AbortError'));
    };

    const armTimer = (): void => {
      if (settled) return;
      clearTimer();
      noOutputTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        for (const child of children) {
          killProcess(child, 'SIGKILL');
        }
      }, NO_OUTPUT_TIMEOUT_MS);
      noOutputTimer.unref();
    };

    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }

    const env = resolveEnv();
    const stdinMode = isPipeline
      ? 'pipe'
      : typeof stdin === 'string'
        ? 'pipe'
        : detached
          ? 'ignore'
          : 'inherit';

    for (const spec of params.children) {
      const child = spawn(spec.command, spec.args, {
        stdio: [isPipeline ? 'pipe' : stdinMode, 'pipe', 'pipe'],
        shell: false,
        detached,
        env,
      });
      children.push(child);
    }

    if (typeof runId === 'string') {
      backgroundProcesses.set(runId, { runId, children, commandLine });
      let remaining = children.length;
      for (const child of children) {
        child.once('close', () => {
          remaining -= 1;
          if (remaining <= 0) backgroundProcesses.delete(runId);
        });
      }
    }

    if (isPipeline) {
      for (let idx = 0; idx < children.length - 1; idx += 1) {
        const from = children[idx];
        const to = children[idx + 1];
        if (from.stdout && to.stdin) {
          from.stdout.pipe(to.stdin, { end: false });
          from.stdout.once('end', () => {
            try {
              to.stdin?.end();
            } catch {
              // already closed
            }
          });
        }
      }

      const firstChild = children[0];
      if (typeof stdin === 'string' && firstChild.stdin) {
        firstChild.stdin.write(stdin);
        firstChild.stdin.end();
      } else if (firstChild.stdin) {
        firstChild.stdin.end();
      }
    } else {
      const child = children[0];
      if (typeof stdin === 'string' && child.stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      }
    }

    armTimer();

    const lastChild = children[children.length - 1];

    lastChild.stdout?.on('data', (data: Buffer) => {
      armTimer();
      stdoutTotal += data.length;
      stdoutBuf = captureTail(stdoutBuf, data, MAX_CAPTURED_BYTES);
    });

    for (const child of children) {
      child.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(pc.red(data.toString()));
        armTimer();
        stderrTotal += data.length;
        stderrBuf = captureTail(stderrBuf, data, MAX_CAPTURED_BYTES);
      });

      child.on('error', (error) => {
        const msg = `Failed to start command: ${error.message}`;
        console.error(pc.red(msg));
        cleanup();
        if (isPipeline) {
          reject(new Error(msg));
        } else {
          resolve(msg);
        }
      });
    }

    lastChild.on('close', (code, sig) => {
      if (settled) return;
      cleanup();

      const stdout = stdoutBuf.toString('utf8');
      const stderr = stderrBuf.toString('utf8');
      const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      const truncated = stdoutTotal > MAX_CAPTURED_BYTES || stderrTotal > MAX_CAPTURED_BYTES;
      const truncationNote = truncated
        ? `\n\n[output truncated]\nCaptured up to ${MAX_CAPTURED_BYTES} bytes of stdout and stderr each.`
        : '';
      const label = isPipeline ? 'Pipeline' : 'Command';

      if (timedOut) {
        resolve(
          `${label} killed due to no-output timeout (${NO_OUTPUT_TIMEOUT_MS}ms)\n${combined}${truncationNote}`
        );
        return;
      }

      if (sig != null) {
        resolve(`${label} killed by signal ${sig}\n${combined}${truncationNote}`);
        return;
      }

      const prefix = code !== 0 ? `${label} exited with code ${code}\n` : '';
      const body =
        combined.trim() === ''
          ? `(no output. exit code: ${code ?? 0})`
          : combined;
      resolve(`${prefix}${body}${truncationNote}`);
    });
  });
}

function captureTail(current: Buffer, chunk: Buffer, maxBytes: number): Buffer {
  const combined = Buffer.concat([current, chunk]) as Buffer;
  return combined.length > maxBytes
    ? (combined.subarray(combined.length - maxBytes))
    : combined;
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const shutdown = (): void => {
    for (const { children } of backgroundProcesses.values()) {
      for (const child of children) {
        terminateWithEscalation(child);
      }
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', shutdown);
}

function resolveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DYLD_') || key === 'PATH') continue;
    env[key] = value;
  }
  env.PATH = SAFE_PATH;
  return env;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function killProcess(child: ChildProcess, sig: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) return;

  try {
    process.kill(-child.pid, sig);
    return;
  } catch {
    // fall back to direct kill
  }

  try {
    child.kill(sig);
  } catch {
    // already gone
  }
}

function terminateWithEscalation(child: ChildProcess, graceMs = 2000): void {
  if (!child.pid) return;

  killProcess(child, 'SIGTERM');

  const timer = setTimeout(() => {
    if (!child.pid) return;
    killProcess(child, 'SIGKILL');
  }, graceMs);
  timer.unref();

  child.once('close', () => {
    clearTimeout(timer);
  });
}
