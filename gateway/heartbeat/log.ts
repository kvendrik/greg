import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HeartbeatRunLogEntry } from './types';
import { getWorkspacePath } from '../../agent/utilities';
import { get as getConfig } from '../../config';

const RUNS_FILENAME = 'heartbeat/runs.jsonl';
const DEFAULT_MAX_BYTES = 500_000;
const DEFAULT_KEEP_LINES = 500;

const config = await getConfig();
const runsPath = join(getWorkspacePath(config), RUNS_FILENAME);

export async function get(
  limit: number = 100
): Promise<HeartbeatRunLogEntry[]> {
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

export async function append(entry: HeartbeatRunLogEntry): Promise<void> {
  await mkdir(dirname(runsPath), { recursive: true });
  await appendFile(runsPath, JSON.stringify(entry) + '\n', 'utf8');

  const runLogConfig = {
    maxBytes: config.heartbeat?.runLog?.maxBytes ?? DEFAULT_MAX_BYTES,
    keepLines: config.heartbeat?.runLog?.keepLines ?? DEFAULT_KEEP_LINES,
  };

  await prune(runLogConfig);
}

async function prune({
  maxBytes,
  keepLines,
}: {
  maxBytes: number;
  keepLines: number;
}): Promise<void> {
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
}
