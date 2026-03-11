import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ClassifierStartOptions = {
  port?: number;
  env?: NodeJS.ProcessEnv;
};

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }

  // On POSIX, kill the whole process group if possible.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process may already have exited.
    }
  }
}

export function start(options?: ClassifierStartOptions): () => void {
  const binaryName = process.platform === 'win32' ? 'classifier.exe' : 'classifier';
  const binaryPath = path.join(__dirname, binaryName);

  const args: string[] = ['--http'];
  if (options?.port !== undefined) {
    args.push('-port', String(options.port));
  }

  const child = spawn(binaryPath, args, {
    cwd: __dirname,
    env: { ...process.env, ...(options?.env ?? {}) },
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });

  // Allow the child to continue running independently.
  child.unref();

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;

    // Best-effort graceful termination.
    try {
      if (child.exitCode === null) {
        killProcessTree(child);
      }
    } catch {
      // Ignore errors when the process is already gone or cannot be signalled.
    }
  };

  return stop;
}

