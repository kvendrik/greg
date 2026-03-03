import { spawn } from 'child_process';
import pc from 'picocolors';
import { randomUUID } from 'node:crypto';
import config from '../.greg';
import { thread, type Thread as ThreadBase } from './thread';
import { startServer } from './server';

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

export function start() {
  console.log(pc.green('📮 Starting server...'));
  startServer();

  console.log(pc.green('📮 Starting job scheduler...'));
  execScript(['jobs', 'schedule']);

  if (config.clients?.telegram) {
    console.log(pc.green('📮 Starting Telegram client...'));
    execScript(['clients:telegram']);
  } else {
    console.log(pc.green('✉️  Ready to chat. Run \`greg cli\` to interact...'));
  }
}

function execScript(args: string[]) {
  return spawn(`bun`, ['run', ...args], {
    stdio: 'inherit',
  });
}
