import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentConfig } from '../../types';
import { getJobsPath } from './store';

const RUNS_FILENAME = 'runs/runs.jsonl';
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_KEEP_LINES = 2000;

export interface RunLogEntry {
  jobId: string;
  // ISO timestamp of when the job started
  startedAt: string;
  // ISO timestamp of when the job finished
  finishedAt: string;
  // whether the job succeeded
  success: boolean;
  // error message if the job failed (empty string when success)
  error: string;
  // path to the session log file on disk.
  // job sessions are created with format job:${jobId}
  // so the session log file is stored at ${workspace}/sessions/job:${jobId}.jsonl
  sessionLog: string;
}

/** Path to the JSONL run log; lives next to the jobs file (e.g. …/cron/runs/runs.jsonl). */
function getRunsPath(config: AgentConfig): string {
  const jobsPath = getJobsPath(config);
  return `${dirname(jobsPath)}/${RUNS_FILENAME}`;
}

function getRunLogConfig(config: AgentConfig): {
  maxBytes: number;
  keepLines: number;
} {
  const runLog = config.cron?.runLog;
  return {
    maxBytes: runLog?.maxBytes ?? DEFAULT_MAX_BYTES,
    keepLines: runLog?.keepLines ?? DEFAULT_KEEP_LINES,
  };
}

export async function appendRun(
  config: AgentConfig,
  entry: RunLogEntry
): Promise<void> {
  const path = getRunsPath(config);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf8');
  await pruneRuns(config);
}

export async function pruneRuns(config: AgentConfig): Promise<void> {
  const path = getRunsPath(config);
  const { maxBytes, keepLines } = getRunLogConfig(config);
  try {
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) return;
    const totalBytes = Buffer.byteLength(raw, 'utf8');
    if (totalBytes <= maxBytes) return;
    const kept = lines.slice(-keepLines);
    await writeFile(
      path,
      kept.join('\n') + (kept.length > 0 ? '\n' : ''),
      'utf8'
    );
  } catch {
    // file missing or unreadable, nothing to prune
  }
}

export function getRunsPathForRead(config: AgentConfig): string {
  return getRunsPath(config);
}

/** Reads the last N run log entries. Returns oldest-first; missing or invalid file yields []. */
export async function readRuns(
  config: AgentConfig,
  limit = 50
): Promise<RunLogEntry[]> {
  const path = getRunsPath(config);
  try {
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    const entries: RunLogEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        if (raw?.jobId != null && raw?.startedAt != null) {
          entries.push({
            jobId: String(raw.jobId),
            startedAt: String(raw.startedAt),
            finishedAt: String(raw.finishedAt ?? ''),
            success: Boolean(raw.success),
            error: typeof raw.error === 'string' ? raw.error : '',
            sessionLog: typeof raw.sessionLog === 'string' ? raw.sessionLog : '',
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}
