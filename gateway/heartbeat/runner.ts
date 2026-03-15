import { readFile, exists } from 'node:fs/promises';
import { join } from 'node:path';
import type { HeartbeatOptions } from './types';
import * as log from './log';
import { isWithinActiveHours } from './active-hours';
import { isPaused } from './paused';
import { createLogger } from '../../utilities/logger';
import { getWorkspacePath } from '../../agent/utilities';
import * as sessions from '../sessions/sessions';
import pc from 'picocolors';
import { get as getConfig } from '../../config';

const logger = createLogger('heartbeat');

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';
const DEFAULT_INTERVAL = 30; // 30 minutes

const config = await getConfig();
const heartbeatPath = join(getWorkspacePath(config), HEARTBEAT_FILENAME);

function getInstructions(intervalMinutes: number) {
  return `
## Heartbeat Run
- You are running a heartbeat check. This is a system check that runs every ${intervalMinutes} minutes.
- Follow the user’s checklist below strictly.
- Do not infer or repeat old tasks from prior chats.
- If nothing needs attention, do not respond with any text.
- Otherwise respond with only the alert text for the user (no preamble).
- Do not give updates to the user while you work through the checklist.
- If the user says something like "last time we spoke" then do not include heartbeat runs in your assessment of when the last time you spoke was.
- Heartbeat instructions live in ${heartbeatPath}. The user might ask you to update them in their instructions.
`;
}

export class Heartbeat {
  private readonly intervalMs: number;
  private readonly systemPrompt: string;
  private readonly activeHours: HeartbeatOptions['activeHours'] | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private running = false;
  private shuttingDown = false;

  constructor(options?: Omit<HeartbeatOptions, 'enabled'>) {
    this.intervalMs = (options?.interval ?? DEFAULT_INTERVAL) * 60 * 1000;
    this.activeHours = options?.activeHours ?? null;

    this.systemPrompt =
      options?.prompt && options?.prompt.trim().length > 0
        ? options?.prompt.trim()
        : getInstructions(options?.interval ?? DEFAULT_INTERVAL);
  }

  start() {
    this.started = true;
    this.schedule();
  }

  stop() {
    this.shuttingDown = true;
    clearTimeout(this.timeoutId!);
  }

  async run(): Promise<void> {
    if (this.shuttingDown) return;

    if (this.running) {
      logger.info('Skipping run: previous run still in progress.');
      this.schedule();
      return;
    }

    if (await isPaused()) {
      logger.info(`Heartbeat is paused. Skipping run.`);
      this.schedule();
      return;
    }

    if (this.activeHours && !isWithinActiveHours(this.activeHours)) {
      logger.info(`Not within active hours. Skipping run.`);
      this.schedule();
      return;
    }

    this.running = true;

    const startedAt = new Date().toISOString();
    const heartbeatPrompt = (await exists(heartbeatPath))
      ? (await readFile(heartbeatPath, 'utf8')).trim()
      : '';

    if (heartbeatPrompt === '') {
      logger.info('No heartbeat checklist found. Skipping heartbeat.');
      return;
    }

    const prompt = `${this.systemPrompt}\n\n---\n\n${heartbeatPrompt}`;

    logger.info(`Running heartbeat...\n\n${prompt}\n\n`);
    const { success, error } = await this.runPrompt(prompt);

    logger.info(`Heartbeat result... \nsuccess=${success}\nerror="${error}"`);
    await log.append({
      startedAt,
      finishedAt: new Date().toISOString(),
      success,
      error,
    });

    this.running = false;

    if (!this.shuttingDown) {
      this.schedule();
    }
  }

  private async runPrompt(
    prompt: string
  ): Promise<{ success: boolean; error?: string }> {
    logger.info('Running heartbeat prompt...');

    const session = await sessions.load('main');

    return new Promise<{
      success: boolean;
      error?: string;
    }>(async (resolve) => {
      await session.prompt(
        { content: prompt, images: [] },
        {
          channelId: null,
          callbacks: {
            onError: (error) => {
              console.error(pc.red(error));
              resolve({ success: false, error });
            },
          },
        }
      );
      resolve({ success: true, error: undefined });
    });
  }

  private schedule(): void {
    if (this.shuttingDown || !this.started) return;
    logger.info(`Next heartbeat in ${this.intervalMs / 1000 / 60} minutes.`);
    this.timeoutId = setTimeout(this.run.bind(this), this.intervalMs);
  }
}
