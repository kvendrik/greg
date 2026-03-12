import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HeartbeatRunLogEntry } from './types';

const RUNS_FILENAME = 'heartbeat/runs.jsonl';
const DEFAULT_MAX_BYTES = 500_000;
const DEFAULT_KEEP_LINES = 500;

export async function getLastHeartbeatRun(
  workspacePath: string
): Promise<HeartbeatRunLogEntry | null> {
  const runs = await getHeartbeatRuns(workspacePath, 1);
  return runs.length > 0 ? runs[runs.length - 1] : null;
}

export async function getHeartbeatRuns(
  workspacePath: string,
  limit: number = 100
): Promise<HeartbeatRunLogEntry[]> {
  const runsPath = `${workspacePath}/${RUNS_FILENAME}`;
  try {
    const raw = await readFile(runsPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) return [];
    const take = Math.max(0, Math.min(limit, lines.length));
    const slice = lines.slice(-take);
    return slice.map((line) => JSON.parse(line) as HeartbeatRunLogEntry);
  } catch {
    return [];
  }
}

export async function appendHeartbeatRun(
  workspacePath: string,
  entry: HeartbeatRunLogEntry,
  runLogConfig?: { maxBytes?: number; keepLines?: number }
): Promise<void> {
  const runsPath = `${workspacePath}/${RUNS_FILENAME}`;
  await mkdir(dirname(runsPath), { recursive: true });
  await appendFile(runsPath, JSON.stringify(entry) + '\n', 'utf8');
  await pruneHeartbeatRuns(workspacePath, runLogConfig);
}

export async function pruneHeartbeatRuns(
  workspacePath: string,
  runLogConfig?: { maxBytes?: number; keepLines?: number }
): Promise<void> {
  const runsPath = `${workspacePath}/${RUNS_FILENAME}`;
  const maxBytes = runLogConfig?.maxBytes ?? DEFAULT_MAX_BYTES;
  const keepLines = runLogConfig?.keepLines ?? DEFAULT_KEEP_LINES;
  try {
    const raw = await readFile(runsPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) return;
    const totalBytes = Buffer.byteLength(raw, 'utf8');
    if (totalBytes <= maxBytes) return;
    const kept = lines.slice(-keepLines);
    await writeFile(
      runsPath,
      kept.join('\n') + (kept.length > 0 ? '\n' : ''),
      'utf8'
    );
  } catch {
    // file missing or unreadable
  }
}
