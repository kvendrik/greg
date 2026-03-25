import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.join(import.meta.dirname, '..', '..');

const firstChatPrompt =
  "System: Hey Greg! This is the user's first time interacting with you. Greet them, introduce yourself, and get to know them so you can update your user memory.";

export function onboard(): void {
  spawnSync(
    'bun',
    [
      'run',
      path.join(projectRoot, 'bin/greg.ts'),
      'tui',
      '-p',
      firstChatPrompt,
    ],
    {
      stdio: 'inherit',
      cwd: projectRoot,
      env: { ...process.env },
    }
  );
}

if (import.meta.main) {
  onboard();
}
