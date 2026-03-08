import { spawn, spawnSync } from 'child_process';
import pc from 'picocolors';
import { randomUUID } from 'node:crypto';
import config from '../.greg';
import { thread, type Thread as ThreadBase } from './thread';
import { startServer } from './server';
import { available as isGuardAvailable } from './tools/utilities/guard/guard';

type Thread = ThreadBase & { id: string; delete: () => void };

const threads = new Map<string, Thread>();

export async function createThread(): Promise<Thread> {
  const t = {
    ...(await thread()),
    id: randomUUID(),
    delete() {
      this.abort();
      threads.delete(this.id);
    },
  };
  threads.set(t.id, t);
  return t;
}

export function getThread(id: string): Thread | null {
  return threads.get(id);
}

export async function start() {
  console.log(pc.green('📮 Starting server...'));
  startServer();

  console.log(pc.green('📮 Starting job scheduler...'));
  execScript(['jobs', 'schedule']);

  if (config.tools.guard?.enabled && !(await isGuardAvailable())) {
    throw new Error(
      'Guard is not running. Run `greg guard start` to start it.'
    );
  }
}

function execScript(args: string[]) {
  const proc = spawn(`bun`, ['run', ...args], {
    stdio: 'inherit',
  });

  proc.on('exit', (code) => {
    if (code !== 0) {
      console.error(pc.red(`Failed to execute script: ${args.join(' ')}`));
      process.exit(code);
    }
  });
}
