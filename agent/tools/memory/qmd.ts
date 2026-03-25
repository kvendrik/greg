import { spawn } from 'child_process';
import { resolve, join } from 'path';
import { createStore, DEFAULT_MULTI_GET_MAX_BYTES } from '@tobilu/qmd';
import type { QMDStore, SearchResult } from '@tobilu/qmd';
import { createLogger } from '../../../utilities/logger';

const logger = createLogger('QMD');

export type SearchOutputFormat = 'json' | 'files';

export type VsearchOptions = {
  limit: number | undefined;
  minScore: number | undefined;
  format: SearchOutputFormat | undefined;
};

export type HybridSearchOptions = {
  limit: number | undefined;
  minScore: number | undefined;
  format: SearchOutputFormat | undefined;
};

export type GetOptions = {
  startLine: number | undefined;
  maxLines: number | undefined;
};

type RunResult = { stdout: string; stderr: string; code: number };

const RUN_QMD_TIMEOUT_MS = 600_000;

/**
 * QMD client bound to a specific collection name and description.
 * Uses the QMD SDK for search/get/multiGet (in-process); background
 * update/embed still use the CLI for fire-and-forget support.
 */
export class QMD {
  private readonly collectionName: string;
  private readonly collectionDescription: string;
  private readonly mask: string;
  private readonly workspacePath: string;

  constructor({
    collectionName,
    collectionDescription,
    mask,
    workspacePath,
  }: {
    collectionName: string;
    collectionDescription: string;
    mask?: string;
    workspacePath: string;
  }) {
    this.collectionName = collectionName;
    this.collectionDescription = collectionDescription;
    this.mask = mask ?? '**/*.md';
    this.workspacePath = workspacePath;
  }

  static async healthy(): Promise<boolean> {
    if (process.env.TEST_ENV) {
      return true;
    }

    const result = await runQmd(['status']);

    if (result.code !== 0) {
      logger.error(
        `QMD health check failed:\n${result.stderr || result.stdout}`
      );
      return false;
    }

    return true;
  }

  async ready(): Promise<void> {
    const dbPath = resolve(join(this.workspacePath, 'qmd.sqlite'));
    process.env.INDEX_PATH = dbPath;

    const healthy = await QMD.healthy();
    if (!healthy) {
      throw new Error('QMD is not healthy');
    }
    await this.ensureCollection(this.collectionName, { mask: this.mask });
    await this.updateAndEmbed({ background: true });
  }

  /**
   * Ensure the QMD collection exists; if not, add it and register context.
   */
  async ensureCollection(
    collectionPath: string,
    options: { mask: string } = { mask: this.mask }
  ): Promise<void> {
    const store = await this.getStore();
    const collections = await store.listCollections();
    if (collections.some((c) => c.name === this.collectionName)) return;

    await store.addCollection(this.collectionName, {
      path: resolve(collectionPath),
      pattern: options.mask,
    });
    await store.addContext(
      this.collectionName,
      '/',
      this.collectionDescription
    );
  }

  /**
   * Fetch multiple documents by path list (comma-separated names).
   * Files larger than maxBytes are skipped.
   */
  async multiGet(
    paths: string[],
    options: { maxBytes: number | undefined } = { maxBytes: undefined }
  ): Promise<string> {
    const store = await this.getStore();
    const pattern = paths
      .map((p) => `qmd://${this.collectionName}/${p}`)
      .join(', ');
    const { docs, errors } = await store.multiGet(pattern, {
      includeBody: true,
      maxBytes: options.maxBytes ?? DEFAULT_MULTI_GET_MAX_BYTES,
    });
    const files = docs.map((r) => {
      if (r.skipped) {
        return {
          filepath: r.doc.filepath,
          displayPath: r.doc.displayPath,
          title: '',
          body: '',
          skipped: true as const,
          skipReason: r.skipReason,
        };
      }
      return {
        filepath: r.doc.filepath,
        displayPath: r.doc.displayPath,
        title: r.doc.title,
        body: r.doc.body ?? '',
        context: r.doc.context ?? undefined,
        skipped: false as const,
      };
    });
    const out = JSON.stringify(files);
    if (errors.length > 0) {
      return JSON.stringify({ documents: files, errors });
    }
    return out;
  }

  /**
   * Vector search over the collection. Returns JSON (or files-style list)
   * formatted for agents. Empty results can mean index not embedded yet.
   */
  async vsearch(
    searchQuery: string,
    options: VsearchOptions = {
      limit: undefined,
      minScore: undefined,
      format: undefined,
    }
  ): Promise<string> {
    const store = await this.getStore();
    const minScore = options.minScore ?? 0.3;

    const results = await store.searchVector(searchQuery, {
      collection: this.collectionName,
      limit: options.limit ?? 10,
    });
    const filtered = results.filter((r) => r.score >= minScore);

    if ((options.format ?? 'json') === 'files') {
      return formatAsFileList(filtered);
    }
    return formatSearchResults(filtered.map(toFormattable), searchQuery);
  }

  /**
   * Hybrid search (BM25 + vector + query expansion + reranking) over the
   * collection. Best quality; use for "find a specific fact."
   */
  async hybridSearch(
    searchQuery: string,
    options: HybridSearchOptions = {
      limit: undefined,
      minScore: undefined,
      format: undefined,
    }
  ): Promise<string> {
    const store = await this.getStore();

    const results = await store.search({
      query: searchQuery,
      collection: this.collectionName,
      limit: options.limit ?? 10,
      minScore: options.minScore ?? 0,
    });

    if ((options.format ?? 'json') === 'files') {
      return formatAsFileList(results);
    }
    return formatSearchResults(
      results.map((r) => ({
        displayPath: r.displayPath,
        title: r.title,
        score: r.score,
        docid: r.docid,
        context: r.context,
        bestChunk: r.bestChunk,
      })),
      searchQuery
    );
  }

  /**
   * BM25 keyword search only (fast, no embeddings). Use for exact names/IDs.
   */
  async search(
    searchQuery: string,
    options: { limit: number | undefined } = { limit: undefined }
  ): Promise<string> {
    const store = await this.getStore();
    const results = await store.searchLex(searchQuery, {
      collection: this.collectionName,
      limit: options.limit ?? 20,
    });
    return formatSearchResults(results.map(toFormattable), searchQuery);
  }

  /**
   * Get a single document by docid (e.g. #79462a), with optional line range.
   */
  async get(
    docid: string,
    options: GetOptions = { startLine: undefined, maxLines: undefined }
  ): Promise<string> {
    const store = await this.getStore();
    const normalized = docid.startsWith('#') ? docid : `#${docid}`;
    const body = await store.getDocumentBody(normalized, {
      fromLine: options.startLine,
      maxLines: options.maxLines,
    });
    if (body === null) throw new Error(`Document not found: ${docid}`);
    return body;
  }

  async getStore(): Promise<QMDStore> {
    const dbPath = resolve(join(this.workspacePath, 'qmd.sqlite'));
    process.env.INDEX_PATH = dbPath;

    let promise = storePromises.get(dbPath);
    if (!promise) {
      promise = createStore({ dbPath }).catch((err: unknown) => {
        storePromises.delete(dbPath);
        throw err;
      });
      storePromises.set(dbPath, promise);
    }
    return promise;
  }

  /**
   * Refresh the index after file changes. When called with
   * `{ background: true }`, starts update + embed in the background
   * without blocking the caller (uses CLI for fire-and-forget).
   */
  async updateAndEmbed(
    options: { background: boolean | undefined } = { background: undefined }
  ): Promise<void> {
    const collectionName = this.collectionName;
    logger.info(`[${collectionName}] Updating and embedding...`);

    if (options.background) {
      void runQmd(['update', '--collection', collectionName], {
        cwd: undefined,
        background: true,
      });
      void runQmd(['embed', '--collection', collectionName], {
        cwd: undefined,
        background: true,
      });
      return;
    }

    const updateResult = await runQmd([
      'update',
      '--collection',
      collectionName,
    ]);
    if (updateResult.code !== 0) {
      throw new Error(
        `qmd update failed: ${updateResult.stderr || updateResult.stdout}`
      );
    }
    const embedResult = await runQmd(['embed', '--collection', collectionName]);
    if (embedResult.code !== 0) {
      throw new Error(
        `qmd embed failed: ${embedResult.stderr || embedResult.stdout}`
      );
    }
  }
}

function toFormattable(r: SearchResult): FormattableResult {
  return {
    displayPath: r.displayPath,
    title: r.title,
    score: r.score,
    docid: r.docid,
    context: r.context,
    bestChunk: undefined,
  };
}

/**
 * Run the qmd CLI via bun (no shell). Used only for health checks, update,
 * and embed. Times out after 10 minutes so a hung process does not block
 * indefinitely.
 *
 * When `background` is true, the child process is started and the promise
 * resolves immediately without waiting for completion (fire-and-forget).
 */
function runQmd(
  args: string[],
  options: { cwd: string | undefined; background: boolean | undefined } = {
    cwd: undefined,
    background: undefined,
  }
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', 'qmd', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd ?? process.cwd(),
      shell: false,
    });

    if (options.background) {
      child.unref();
      child.on('error', (err) => {
        console.error('[qmd] background run failed to start:', err);
      });
      resolve({ stdout: '', stderr: '', code: 0 });
      return;
    }

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        stdout,
        stderr: (stderr || '').trimEnd() + '\nqmd timed out after 10 minutes.',
        code: 1,
      });
    }, RUN_QMD_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        code: code ?? (signal ? 1 : 0),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr: stderr || err.message,
        code: 1,
      });
    });
  });
}

const storePromises = new Map<string, Promise<QMDStore>>();

type FormattableResult = {
  displayPath: string;
  title: string;
  score: number;
  docid: string;
  context: string | null;
  bestChunk: string | undefined;
};

function formatSearchResults(
  results: FormattableResult[],
  query: string
): string {
  const mapped = results.map((r) => {
    const entry: Record<string, unknown> = {
      displayPath: r.displayPath,
      title: r.title,
      score: r.score,
      docid: r.docid,
    };
    if (r.context) entry.context = r.context;
    if (r.bestChunk) entry.snippet = r.bestChunk;
    return entry;
  });
  return JSON.stringify({ query, results: mapped });
}

function formatAsFileList(results: { displayPath: string }[]): string {
  return results.map((r) => r.displayPath).join('\n');
}
