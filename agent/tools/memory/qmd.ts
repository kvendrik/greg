import { spawn } from 'child_process';
import config from '../../../.greg';

const COLLECTION_NAME = config.id + '-chats';

type RunResult = { stdout: string; stderr: string; code: number };

/**
 * Run the qmd CLI via bun (no shell). Returns a promise that resolves when the
 * process exits. Execution is non-blocking.
 */
function runQmd(
  args: string[],
  options?: { cwd?: string }
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', 'qmd', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options?.cwd ?? process.cwd(),
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => {
      resolve({
        stdout,
        stderr,
        code: code ?? (signal ? 1 : 0),
      });
    });
    child.on('error', (err) => {
      resolve({
        stdout,
        stderr: stderr || err.message,
        code: 1,
      });
    });
  });
}

/**
 * Ensures QMD CLI is available and the collection is set up. Call with the path
 * to the chats directory (e.g. workspace chats path). Throws if QMD is not
 * installed or fails to run.
 */
export async function ensureQmdInstalledAndSetUp(
  chatsPath: string
): Promise<void> {
  const listResult = await runQmd(['collection', 'list']);
  if (listResult.code !== 0) {
    const out = listResult.stderr || listResult.stdout;
    throw new Error(
      `QMD is not installed or failed to run. Ensure @tobilu/qmd is installed (bun install) and the qmd CLI runs. ${out ? `Output: ${out}` : ''}`
    );
  }
  await ensureCollection(chatsPath);
}

/**
 * Ensure the QMD collection exists; if not, add it and register context.
 * Safe for paths with spaces/special chars (no shell).
 */
export async function ensureCollection(chatsPath: string): Promise<void> {
  const listResult = await runQmd(['collection', 'list']);
  const listOutput = listResult.stdout + listResult.stderr;
  const hasCollection =
    listResult.code === 0 &&
    listOutput
      .split(/\r?\n/)
      .some((line) => line.trim().includes(COLLECTION_NAME));

  if (!hasCollection) {
    const addResult = await runQmd([
      'collection',
      'add',
      chatsPath,
      '--name',
      COLLECTION_NAME,
      '--mask',
      '**/*.md',
    ]);

    const addOutput = addResult.stderr || addResult.stdout;
    const alreadyExists = /already exists|collection already exists/i.test(
      addOutput
    );

    if (addResult.code !== 0 && !alreadyExists) {
      console.error('[qmd] collection add failed:', addOutput);
      return;
    }

    const contextResult = await runQmd([
      'context',
      'add',
      `qmd://${COLLECTION_NAME}`,
      'PA Agent Long Term Memory',
    ]);

    if (contextResult.code !== 0) {
      console.error(
        '[qmd] context add failed:',
        contextResult.stderr || contextResult.stdout
      );
    }
  }
}

/**
 * Fetch multiple documents by path list (comma-separated names). Returns stdout.
 */
export async function multiGet(paths: string[]): Promise<string> {
  const pathsArg = paths.join(', ');
  const result = await runQmd([
    'multi-get',
    pathsArg,
    '--collection',
    COLLECTION_NAME,
    '--json',
  ]);
  if (result.code !== 0) {
    throw new Error(`qmd multi-get failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * Vector search over the collection. Returns stdout (JSON).
 */
export async function vsearch(searchQuery: string): Promise<string> {
  const result = await runQmd([
    'vsearch',
    searchQuery,
    '--collection',
    COLLECTION_NAME,
    '--json',
  ]);
  if (result.code !== 0) {
    throw new Error(`qmd vsearch failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export type GetOptions = { startLine?: number; maxLines?: number };

/**
 * Get a single document by docid (e.g. #79462a), with optional line range.
 */
export async function get(
  docid: string,
  options: GetOptions = {}
): Promise<string> {
  const docidArg =
    options.startLine != null ? `${docid}:${options.startLine}` : docid;
  const args: string[] = ['get', docidArg];
  if (options.maxLines != null) {
    args.push('-l', String(options.maxLines));
  }
  args.push('--collection', COLLECTION_NAME, '--json');

  const result = await runQmd(args);
  if (result.code !== 0) {
    throw new Error(`qmd get failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * Run update + embed for the collection (e.g. after saving a note). Fire-and-forget.
 */
export function runUpdateAndEmbed(): void {
  const child = spawn(
    'bun run qmd update --collection agent-chats && bun run qmd embed --collection agent-chats',
    [],
    { stdio: 'ignore', cwd: process.cwd(), shell: true }
  );
  child.unref();
}
