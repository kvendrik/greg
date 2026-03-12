import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ExecutePromptFn, HeartbeatOptions } from './types';
import { appendHeartbeatRun, getLastHeartbeatRun } from './run-log';
import { isWithinActiveHours } from './active-hours';
import { isHeartbeatPaused } from './paused';
import { createLogger } from '../../utilities/logger';

const logger = createLogger('heartbeat');

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_ACK_MAX_CHARS = 300;

const DEFAULT_HEARTBEAT_INSTRUCTION = `You are running a heartbeat check. Follow the checklist below strictly. Do not infer or repeat old tasks from prior chats.
If nothing needs attention, respond with exactly: HEARTBEAT_OK
Otherwise respond with only the alert text for the user (no preamble).`;

export function resolveWorkspacePath(workspace: string): string {
  if (workspace.startsWith('~/') || workspace === '~') {
    return join(homedir(), workspace.slice(1));
  }
  return workspace;
}

async function validateWorkspacePath(workspacePath: string): Promise<boolean> {
  try {
    const st = await stat(workspacePath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export function startHeartbeat(
  config: {
    workspace: string;
    options?: Omit<HeartbeatOptions, 'enabled'>;
  },
  executePrompt: ExecutePromptFn
): () => void {
  const { workspace, options } = config;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const workspacePath = resolveWorkspacePath(workspace);
  const heartbeatPath = join(workspacePath, HEARTBEAT_FILENAME);
  const ackMaxChars = options?.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS;
  const instruction =
    options?.prompt && options?.prompt.trim().length > 0
      ? options?.prompt.trim()
      : DEFAULT_HEARTBEAT_INSTRUCTION;
  const target = options?.target ?? 'last';
  const runLogConfig =
    options?.runLog != null
      ? {
          maxBytes: options?.runLog.maxBytes,
          keepLines: options?.runLog.keepLines,
        }
      : undefined;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let shuttingDown = false;

  async function runHeartbeat(): Promise<void> {
    if (shuttingDown) return;
    if (running) {
      console.info('[heartbeat] Skipping run: previous run still in progress.');
      scheduleNext();
      return;
    }

    if (await isHeartbeatPaused(workspacePath)) {
      scheduleNext();
      return;
    }

    if (options?.activeHours && !isWithinActiveHours(options.activeHours)) {
      scheduleNext();
      return;
    }

    running = true;
    const startedAt = new Date().toISOString();
    let body: string;
    try {
      body = await readFile(heartbeatPath, 'utf8');
    } catch {
      body = '';
    }
    const content = body.trim();

    if (content === '') {
      logger.info(
        '[heartbeat] No heartbeat checklist found. Skipping heartbeat.'
      );
      return;
    }

    const prompt =
      content.length > 0
        ? `${instruction}\n\n---\n\n${content}`
        : `${instruction}\n\n(No checklist items; respond HEARTBEAT_OK if nothing else needs attention.)`;

    try {
      await executePrompt(prompt, {
        target,
        ackMaxChars,
      });
      await appendHeartbeatRun(
        workspacePath,
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          success: true,
        },
        runLogConfig
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[heartbeat] Run failed: ${message}`);
      await appendHeartbeatRun(
        workspacePath,
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          success: false,
          error: message,
        },
        runLogConfig
      );
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

  (async () => {
    const valid = await validateWorkspacePath(workspacePath);
    if (!valid) {
      console.warn(
        `[heartbeat] Workspace path invalid or not a directory: ${workspacePath}. Heartbeat disabled.`
      );
      return;
    }
    if (shuttingDown) return;

    const lastRun = await getLastHeartbeatRun(workspacePath);

    // OpenClaw-style: jitter only affects the first scheduled run after a cold start.
    // Default jitter is 10% of the interval, clamped to the interval, unless explicitly set.
    const configuredJitterMs =
      options?.jitterMs !== undefined
        ? options.jitterMs
        : Math.floor(intervalMs * 0.1);
    const maxJitterMs = Math.max(0, Math.min(configuredJitterMs, intervalMs));
    const jitterDelayMs =
      maxJitterMs > 0 ? Math.floor(Math.random() * maxJitterMs) : 0;

    let baseDelayMs: number;

    if (!lastRun) {
      // No history: schedule first run at roughly "now + interval" plus optional jitter,
      // so we do not immediately fire on startup.
      baseDelayMs = intervalMs;
    } else {
      const lastFinishedAtMs = Date.parse(lastRun.finishedAt);
      if (Number.isNaN(lastFinishedAtMs)) {
        // Corrupt timestamp; fall back to treating this as no history.
        baseDelayMs = intervalMs;
      } else {
        const nextPlannedAtMs = lastFinishedAtMs + intervalMs;
        const nowMs = Date.now();
        baseDelayMs = Math.max(0, nextPlannedAtMs - nowMs);
      }
    }

    const delay = baseDelayMs + jitterDelayMs;
    console.info(
      `[heartbeat] Starting (interval ${intervalMs / 1000}s${
        jitterDelayMs > 0 ? `, first run jitter ${jitterDelayMs}ms` : ''
      }).`
    );
    timeoutId = setTimeout(runHeartbeat, delay);
  })();

  return () => {
    shuttingDown = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}
