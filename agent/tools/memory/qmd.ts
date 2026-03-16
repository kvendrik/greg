import { spawn } from 'child_process';
import {
  createStore,
  enableProductionMode,
  getRealPath,
  vectorSearchQuery,
  hybridQuery,
  searchFTS,
  DEFAULT_MULTI_GET_MAX_BYTES,
} from '@tobilu/qmd/dist/store.js';

// Allow default DB path (~/.cache/qmd/index.sqlite) when INDEX_PATH is not set.
// Tests that need an isolated DB set INDEX_PATH in beforeAll (e.g. memory.tests.ts).
enableProductionMode();

import type { SearchResult } from '@tobilu/qmd/dist/store.js';
import {
  getCollection,
  addCollection,
  addContext,
} from '@tobilu/qmd/dist/collections.js';
import {
  documentsToJson,
  searchResultsToJson,
  searchResultsToFiles,
} from '@tobilu/qmd/dist/formatter.js';
import { withLLMSession } from '@tobilu/qmd/dist/llm.js';
import { createLogger } from '../../../utilities/logger';

const logger = createLogger('QMD');

export type SearchOutputFormat = 'json' | 'files';

export type VsearchOptions = {
  limit?: number;
  minScore?: number;
  format?: SearchOutputFormat;
};

export type HybridSearchOptions = {
  limit?: number;
  minScore?: number;
  format?: SearchOutputFormat;
};

export type GetOptions = { startLine?: number; maxLines?: number };

type RunResult = { stdout: string; stderr: string; code: number };

const RUN_QMD_TIMEOUT_MS = 600_000; // 10 min for update/embed (embed can be slow)

/**
 * Run the qmd CLI via bun (no shell). Used only for update and embed; read
 * operations use the QMD library for in-process performance. Times out after
 * 10 minutes so a hung process does not block indefinitely.
 *
 * When `background` is true, the child process is started and the promise
 * resolves immediately without waiting for completion (fire-and-forget).
 */
function runQmd(
  args: string[],
  options?: { cwd?: string; background?: boolean }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', 'qmd', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options?.cwd ?? process.cwd(),
      shell: false,
    });

    if (options?.background) {
      // Fire-and-forget: allow the process to continue independently and
      // resolve immediately without waiting for output or exit. Still log
      // spawn errors so failures are visible in logs.
      child.unref();
      // child.stdout?.on('data', (chunk) => {
      //   console.error('[qmd]', chunk.toString());
      // });
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

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
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

/** Lazy-created QMD store (same DB as CLI default index). */
let store: ReturnType<typeof createStore> | null = null;

function getStore(): ReturnType<typeof createStore> {
  if (!store) store = createStore();
  return store;
}

/**
 * QMD client bound to a specific collection name and description.
 * Uses the QMD library for search/get/multiGet (in-process); only update and
 * embed run via the CLI. Optional workspaceRoot is stored for future use.
 */
export class QMD {
  constructor(
    private readonly collectionName: string,
    private readonly collectionDescription: string,
    private readonly workspaceRoot?: string
  ) {}

  static async healthy(): Promise<boolean> {
    const result = await runQmd(['status']);
    if (result.code !== 0) {
      logger.error(
        `QMD health check failed:\n${result.stderr || result.stdout}`
      );
      return false;
    }
    return true;
  }

  /**
   * Ensure the QMD collection exists; if not, add it and register context.
   * Uses the library's collections API (no CLI).
   */
  async ensureCollection(
    collectionPath: string,
    options?: { mask?: string }
  ): Promise<void> {
    const collectionName = this.collectionName;
    const mask = options?.mask ?? '**/*.md';

    if (getCollection(collectionName)) {
      return;
    }

    const absolutePath = getRealPath(collectionPath);

    addCollection(collectionName, absolutePath, mask);
    addContext(collectionName, '/', this.collectionDescription);
  }

  /**
   * Fetch multiple documents by path list (comma-separated names). Uses the
   * library; returns JSON string. Files larger than maxBytes are skipped.
   */
  async multiGet(
    paths: string[],
    options?: { maxBytes?: number }
  ): Promise<string> {
    const collectionName = this.collectionName;
    const qmdStore = getStore();
    const pattern = paths.map((p) => `qmd://${collectionName}/${p}`).join(', ');
    const maxBytes = options?.maxBytes ?? DEFAULT_MULTI_GET_MAX_BYTES;
    const { docs, errors } = qmdStore.findDocuments(pattern, {
      includeBody: true,
      maxBytes,
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
        title: r.doc.title ?? '',
        body: r.doc.body ?? '',
        context: r.doc.context ?? undefined,
        skipped: false as const,
      };
    });
    const out = documentsToJson(files);
    if (errors.length > 0) {
      return JSON.stringify({
        documents: JSON.parse(out),
        errors,
      });
    }
    return out;
  }

  /**
   * Vector search over the collection. Uses the library with withLLMSession
   * (in-process, no CLI spawn). Returns JSON (or files-style list) formatted
   * for agents per QMD docs. Empty results can mean index not embedded yet.
   */
  async vsearch(
    searchQuery: string,
    options?: VsearchOptions
  ): Promise<string> {
    const collectionName = this.collectionName;
    const qmdStore = getStore();
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0.3;
    const format = options?.format ?? 'json';

    const results = await withLLMSession(async () => {
      return vectorSearchQuery(qmdStore, searchQuery, {
        collection: collectionName,
        limit,
        minScore,
      });
    });

    if (format === 'files') {
      return searchResultsToFiles(results as unknown as SearchResult[]);
    }
    return searchResultsToJson(results as unknown as SearchResult[], {
      query: searchQuery,
    });
  }

  /**
   * Hybrid search (BM25 + vector + query expansion + reranking) over the
   * collection. Best quality per QMD docs; use for "find a specific fact."
   */
  async hybridSearch(
    searchQuery: string,
    options?: HybridSearchOptions
  ): Promise<string> {
    const collectionName = this.collectionName;
    const qmdStore = getStore();
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;
    const format = options?.format ?? 'json';

    const results = await withLLMSession(async () => {
      return hybridQuery(qmdStore, searchQuery, {
        collection: collectionName,
        limit,
        minScore,
      });
    });

    if (format === 'files') {
      return searchResultsToFiles(results as unknown as SearchResult[]);
    }
    const withChunkPos = results.map((r) => ({
      ...r,
      chunkPos: r.bestChunkPos,
    }));
    return searchResultsToJson(withChunkPos as unknown as SearchResult[], {
      query: searchQuery,
    });
  }

  /**
   * BM25 keyword search only (fast, no embeddings). Use for exact names/IDs.
   */
  search(searchQuery: string, options?: { limit?: number }): string {
    const qmdStore = getStore();
    const limit = options?.limit ?? 20;
    const results = qmdStore.searchFTS(searchQuery, limit, this.collectionName);
    return searchResultsToJson(results, { query: searchQuery });
  }

  /**
   * Get a single document by docid (e.g. #79462a), with optional line range.
   * Uses the library (no CLI).
   */
  async get(docid: string, options: GetOptions = {}): Promise<string> {
    const qmdStore = getStore();
    const normalized = docid.startsWith('#') ? docid : `#${docid}`;
    const doc = qmdStore.findDocumentByDocid(normalized);
    if (!doc) {
      throw new Error(`Document not found: ${docid}`);
    }
    const body = qmdStore.getDocumentBody(
      { filepath: doc.filepath },
      options.startLine,
      options.maxLines
    );
    return body ?? '';
  }

  /**
   * Refresh the index after file changes: update reads files from disk and
   * updates the document store + FTS5 index; embed then generates vector
   * embeddings for semantic search. Both are required. Still uses the CLI
   * (update/embed are not exposed as a library API). Run from the workspace
   * directory so the CLI sees the correct files; workspaceRoot is kept for
   * future use (e.g. explicit cwd when CLI supports it safely).
   *
   * When called with `{ background: true }`, starts update + embed in the
   * background without blocking the caller.
   */
  async updateAndEmbed(options?: { background?: boolean }): Promise<void> {
    const collectionName = this.collectionName;
    const background = options?.background ?? false;

    logger.info(`[${collectionName}] Updating and embedding...`);

    if (background) {
      // Fire-and-forget maintenance: do not await long-running CLI work.
      void runQmd(['update', '--collection', collectionName], {
        background: true,
      });
      void runQmd(['embed', '--collection', collectionName], {
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
