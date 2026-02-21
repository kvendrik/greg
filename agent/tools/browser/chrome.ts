import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import CDP from 'chrome-remote-interface';
import { getWorkspacePath } from '../../utilities';

const CHROME_EXECUTABLE =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const state: {
  port: number;
  childProcess: ReturnType<typeof spawn> | null;
} = {
  port: 0,
  childProcess: null,
};

export type CDPClient = Awaited<ReturnType<typeof CDP>>;

export async function getCDPClient(): Promise<CDPClient> {
  state.port = state.port || 9222;
  const cdpOpts = { host: '127.0.0.1' as const, port: state.port };
  let targets: CDP.Target[] = [];
  const existing = await CDP.List(cdpOpts).catch(() => null);

  if (existing && existing.length > 0) {
    targets = existing;
  } else {
    const userDataDir = resolveUserDataDir();
    removeStaleSingletonLock(userDataDir);

    const chromeArgs = [
      '--headless=new',
      `--remote-debugging-port=${state.port}`,
      // `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-features=Translate,MediaRouter',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--password-store=basic',
      '--headless=new',
      '--disable-gpu', // often breaks headless on macOS
      '--disable-blink-features=AutomationControlled',
      'about:blank',
    ];

    console.log(
      `Running ${CHROME_EXECUTABLE.replace(/ /g, '\\ ')} ${chromeArgs.join(' ')}\n\n`
    );

    const spawnOnce = () =>
      spawn(CHROME_EXECUTABLE, chromeArgs, {
        env: {
          ...process.env,
          HOME: os.homedir(),
        },
      });

    const localStatePath = path.join(userDataDir, 'Local State');
    const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
    const needsBootstrap =
      !fs.existsSync(localStatePath) || !fs.existsSync(preferencesPath);

    state.childProcess = spawnOnce();

    if (needsBootstrap) {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(localStatePath) && fs.existsSync(preferencesPath))
          break;
        await new Promise((r) => setTimeout(r, 200));
      }
      state.childProcess?.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 500));
      state.childProcess = spawnOnce();
    }

    const readyDeadline = Date.now() + 20_000;
    const initialDelay = 3_000;
    await new Promise((r) => setTimeout(r, initialDelay));

    while (Date.now() < readyDeadline) {
      if (await isChromeReachable(state.port)) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!(await isChromeReachable(state.port))) {
      state.childProcess?.kill('SIGKILL');
      throw new Error('Chrome did not become reachable in time');
    }

    targets = await CDP.List(cdpOpts);
  }

  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) {
    throw new Error('No page target found');
  }

  const client = await CDP({
    ...cdpOpts,
    target: pageTarget,
  });

  return client;
}

function resolveUserDataDir(): string {
  return path.join(getWorkspacePath(), 'browser', 'data');
}

function removeStaleSingletonLock(userDataDir: string): void {
  const lockPath = path.join(userDataDir, 'SingletonLock');
  if (fs.existsSync(lockPath)) {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // ignore
    }
  }
}

async function isChromeReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
