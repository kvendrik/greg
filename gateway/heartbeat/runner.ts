import { readFile, exists } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutePromptFn, HeartbeatOptions } from './types';
import * as log from './log';
import { isWithinActiveHours } from './active-hours';
import { isPaused } from './paused';
import { createLogger } from '../../utilities/logger';
import { getWorkspacePath } from '../../agent/utilities';
import config from '../../.greg';

const logger = createLogger('heartbeat');

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const DEFAULT_HEARTBEAT_INSTRUCTION = `You are running a heartbeat check. Follow the checklist below strictly. Do not infer or repeat old tasks from prior chats.
If nothing needs attention, respond with exactly: HEARTBEAT_OK
Otherwise respond with only the alert text for the user (no preamble).`;

const workspacePath = getWorkspacePath(config);
const heartbeatPath = join(workspacePath, HEARTBEAT_FILENAME);

export async function start(
  execute: ExecutePromptFn,
  options?: Omit<HeartbeatOptions, 'enabled'>
): Promise<() => void> {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;

  const systemPrompt =
    options?.prompt && options?.prompt.trim().length > 0
      ? options?.prompt.trim()
      : DEFAULT_HEARTBEAT_INSTRUCTION;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let shuttingDown = false;

  logger.info(`Starting (interval ${intervalMs / 1000}s.`);
  timeoutId = setTimeout(runHeartbeat, intervalMs);

  return () => {
    shuttingDown = true;
    clearTimeout(timeoutId!);
  };

  async function runHeartbeat(): Promise<void> {
    if (shuttingDown) return;

    if (running) {
      logger.info('Skipping run: previous run still in progress.');
      scheduleNext();
      return;
    }

    if (await isPaused()) {
      scheduleNext();
      return;
    }

    if (options?.activeHours && !isWithinActiveHours(options.activeHours)) {
      scheduleNext();
      return;
    }

    running = true;

    const startedAt = new Date().toISOString();
    const heartbeatPrompt = (await exists(heartbeatPath))
      ? (await readFile(heartbeatPath, 'utf8')).trim()
      : '';

    if (heartbeatPrompt === '') {
      logger.info(
        '[heartbeat] No heartbeat checklist found. Skipping heartbeat.'
      );
      return;
    }

    const prompt = `${systemPrompt}\n\n---\n\n${heartbeatPrompt}`;

    try {
      await execute(prompt);
      await log.append({
        startedAt,
        finishedAt: new Date().toISOString(),
        success: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[heartbeat] Run failed: ${message}`);
      await log.append({
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        error: message,
      });
    } finally {
      running = false;
    }

    if (!shuttingDown) {
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    if (shuttingDown) return;
    timeoutId = setTimeout(runHeartbeat, intervalMs);
  }
}
