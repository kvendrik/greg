import { mkdtemp, mkdir, rm, unlink } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentConfig } from '../../../types';
import { load, saveConversationNote } from '..';

const DEFAULT_ISO = '2024-01-02T10:15:00.000Z';

function createMockConfig(workspace: string): AgentConfig {
  return {
    id: 'test',
    workspace,
    models: [],
    tools: { guard: { enabled: true, ask: false } },
  } as AgentConfig;
}

async function createTempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memory-workspace-'));
}

async function cleanupTempWorkspace(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

function getTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return tool;
}

function toolText(result: { content: unknown[] }): string {
  const first = result.content[0];
  return first != null && typeof first === 'object' && 'text' in first
    ? String((first as { text: string }).text)
    : '';
}

function textContainsOneOf(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

describe('memory', () => {
  let qmdTestDir: string;
  const envBefore = { QMD_CONFIG_DIR: process.env.QMD_CONFIG_DIR, INDEX_PATH: process.env.INDEX_PATH };

  beforeAll(async () => {
    qmdTestDir = join(tmpdir(), 'qmd-memory-test-' + Date.now());
    await mkdir(qmdTestDir, { recursive: true });
    process.env.QMD_CONFIG_DIR = qmdTestDir;
    process.env.INDEX_PATH = join(qmdTestDir, 'index.sqlite');
  });

  afterAll(async () => {
    if (qmdTestDir) {
      await rm(qmdTestDir, { recursive: true, force: true }).catch(() => {});
    }
    if (envBefore.QMD_CONFIG_DIR !== undefined) {
      process.env.QMD_CONFIG_DIR = envBefore.QMD_CONFIG_DIR;
    } else {
      delete process.env.QMD_CONFIG_DIR;
    }
    if (envBefore.INDEX_PATH !== undefined) {
      process.env.INDEX_PATH = envBefore.INDEX_PATH;
    } else {
      delete process.env.INDEX_PATH;
    }
  });

  describe('load()', () => {
    it('exposes memory tools with simple names', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const names = tools.map((t) => t.name).sort();

        expect(names).toContain('memory_recent');
        expect(names).toContain('memory_search');
        expect(names).toContain('memory_summarize');
        expect(names).toContain('memory_get');
        expect(names).toContain('memory_user_get');
        expect(names).toContain('memory_user_set');
        expect(names).toContain('memory_identity_get');
        expect(names).toContain('memory_identity_set');
        expect(names).toContain('memory_note');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_user_* tools', () => {
    it('memory_user_get and memory_user_set roundtrip USER.md', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const userSet = getTool(tools, 'memory_user_set');
        const userGet = getTool(tools, 'memory_user_get');

        const content = 'name: Koen\nprefers: concise bullets\n';

        await userSet.execute('test', { content }, undefined);
        const result = await userGet.execute('test', {}, undefined);
        expect(toolText(result)).toBe(content);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_identity_* tools', () => {
    it('memory_identity_get and memory_identity_set roundtrip IDENTITY.md', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const identitySet = getTool(tools, 'memory_identity_set');
        const identityGet = getTool(tools, 'memory_identity_get');

        const content = '# Identity\nYou are a focused coding agent.\n';

        await identitySet.execute('test', { content }, undefined);
        const result = await identityGet.execute('test', {}, undefined);
        expect(toolText(result)).toBe(content);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('saveConversationNote()', () => {
    it('writes into dated file with heading', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const note = 'We decided to use PostgreSQL.';
        await saveConversationNote(note, DEFAULT_ISO, config);

        const notesDir = join(workspace, 'notes');
        const dateFile = join(notesDir, '2024-01-02.md');
        const exists = await fs
          .access(dateFile)
          .then(() => true)
          .catch(() => false);

        expect(exists).toBe(true);

        const body = await fs.readFile(dateFile, 'utf8');
        expect(body).toContain('# 2024-01-02');
        expect(body).toContain('## 10:15');
        expect(body).toContain(note);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('load() instructions', () => {
    it('references new memory_* tool names', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { instructions } = await load(config, DEFAULT_ISO);

        expect(instructions).toContain('memory_recent');
        expect(instructions).toContain('memory_search');
        expect(instructions).toContain('memory_summarize');
        expect(instructions).toContain('memory_user_get');
        expect(instructions).toContain('memory_user_set');
        expect(instructions).toContain('memory_identity_get');
        expect(instructions).toContain('memory_identity_set');
        expect(instructions).toContain('memory_note');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('includes scope and search_mode hint for memory_search', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { instructions } = await load(config, DEFAULT_ISO);
        expect(instructions).toContain('scope');
        expect(instructions).toContain('search_mode');
        expect(instructions).toContain('notes');
        expect(instructions).toContain('keyword');
        expect(instructions).toContain('hybrid');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_recent', () => {
    it('returns friendly message when notes dir is empty', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, '2024-01-02T10:15:00.000Z');
        const recent = getTool(tools, 'memory_recent');

        const result = await recent.execute('test', {}, undefined);
        expect(toolText(result)).toBe('No recent conversation notes.');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('returns content or structured response when notes exist', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        await saveConversationNote('We chose PostgreSQL.', DEFAULT_ISO, config);
        const { tools } = await load(config, DEFAULT_ISO);
        const recent = getTool(tools, 'memory_recent');
        const result = await recent.execute('test', { max_notes: 5 }, undefined);
        const text = toolText(result);

        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
        expect(textContainsOneOf(text, ['PostgreSQL', 'documents', 'Error fetching'])).toBe(true);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_search', () => {
    it('returns friendly message when search_query is empty', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, '2024-01-02T10:15:00.000Z');
        const search = getTool(tools, 'memory_search');

        const result = await search.execute('test', { search_query: '   ' }, undefined);
        expect(toolText(result)).toContain('No search query provided');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('runs with scope notes and returns string (no throw)', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, '2024-01-02T10:15:00.000Z');
        const search = getTool(tools, 'memory_search');

        const result = await search.execute(
          'test',
          { search_query: 'something', scope: 'notes', search_mode: 'keyword' },
          undefined
        );
        const text = toolText(result);
        expect(typeof text).toBe('string');
        expect(textContainsOneOf(text, ['No matching notes found', 'From notes', 'Try scope'])).toBe(
          true
        );
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('runs with scope both and search_mode keyword', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, '2024-01-02T10:15:00.000Z');
        const search = getTool(tools, 'memory_search');

        const result = await search.execute(
          'test',
          { search_query: 'test', scope: 'both', search_mode: 'keyword' },
          undefined
        );
        expect(typeof toolText(result)).toBe('string');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_get', () => {
    it('returns friendly message when docid is empty', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, '2024-01-02T10:15:00.000Z');
        const get = getTool(tools, 'memory_get');

        const result = await get.execute('test', { docid: '   ' }, undefined);
        const text = toolText(result);
        expect(text).toContain('No docid provided');
        expect(text).toContain('memory_recent');
        expect(text).toContain('memory_search');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('returns error message when docid is not found', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, '2024-01-02T10:15:00.000Z');
        const get = getTool(tools, 'memory_get');

        const result = await get.execute('test', { docid: '#nonexistent99' }, undefined);
        expect(toolText(result)).toContain('Error getting note or transcript');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_user_get when USER.md missing', () => {
    it('returns friendly message and suggests memory_user_set', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        await unlink(join(workspace, 'USER.md'));
        const result = await getTool(tools, 'memory_user_get').execute('test', {}, undefined);
        const text = toolText(result);
        expect(text).toContain('USER.md not found');
        expect(text).toContain('memory_user_set');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_identity_get when IDENTITY.md missing', () => {
    it('returns friendly message and suggests memory_identity_set', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        await unlink(join(workspace, 'IDENTITY.md'));
        const result = await getTool(tools, 'memory_identity_get').execute('test', {}, undefined);
        const text = toolText(result);
        expect(text).toContain('IDENTITY.md not found');
        expect(text).toContain('memory_identity_set');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_summarize', () => {
    it('returns friendly message when no topic and no notes', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const summarize = getTool(tools, 'memory_summarize');
        const result = await summarize.execute('test', {}, undefined);
        expect(toolText(result)).toBe('No past conversation notes available to summarize.');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('returns string when topic given (may be empty results or matches)', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const summarize = getTool(tools, 'memory_summarize');
        const result = await summarize.execute(
          'test',
          { topic: 'xyznonexistenttopic123' },
          undefined
        );
        const text = toolText(result);
        expect(typeof text).toBe('string');
        expect(
          textContainsOneOf(text, [
            'No notes or session transcripts found for this topic',
            'From notes',
            'From session',
            'search failed',
            'Search failed',
          ])
        ).toBe(true);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('returns text when notes exist', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const note = 'We discussed deployment strategy.';
        await saveConversationNote(note, DEFAULT_ISO, config);
        const { tools } = await load(config, DEFAULT_ISO);
        const summarize = getTool(tools, 'memory_summarize');
        const result = await summarize.execute(
          'test',
          { topic: 'deployment', max_notes: 5 },
          undefined
        );
        const text = toolText(result);
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_note', () => {
    it('returns friendly message on invalid ISO timestamp', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const noteTool = getTool(tools, 'memory_note');
        const result = await noteTool.execute(
          'test',
          { note: 'Some note', conversation_start_iso: 'not-a-timestamp' },
          undefined
        );
        const text = toolText(result);
        expect(text).toContain('Could not save note');
        expect(text).toContain('invalid conversation_start_iso');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('returns friendly message when note is empty or whitespace', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const noteTool = getTool(tools, 'memory_note');
        const result = await noteTool.execute(
          'test',
          { note: '   ', conversation_start_iso: DEFAULT_ISO },
          undefined
        );
        expect(toolText(result)).toBe('No content to save.');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('saves note without category and returns success message', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const noteTool = getTool(tools, 'memory_note');
        const iso = '2024-01-02T14:30:00.000Z';
        const result = await noteTool.execute(
          'test',
          { note: 'Follow up on deployment.', conversation_start_iso: iso },
          undefined
        );
        const text = toolText(result);
        expect(text).toContain('Saved note');
        expect(text).toContain('2024-01-02');
        expect(text).toContain('14:30');
        const body = await fs.readFile(join(workspace, 'notes', '2024-01-02.md'), 'utf8');
        expect(body).toContain('Follow up on deployment.');
        expect(body).not.toContain('**[decision]**');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('prefixes note with category marker when provided', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const { tools } = await load(config, DEFAULT_ISO);
        const noteTool = getTool(tools, 'memory_note');
        const note = 'We decided to use SQLite for local dev.';
        await noteTool.execute(
          'test',
          { note, category: 'decision', conversation_start_iso: DEFAULT_ISO },
          undefined
        );
        const body = await fs.readFile(join(workspace, 'notes', '2024-01-02.md'), 'utf8');
        expect(body).toContain('**[decision]** We decided to use SQLite for local dev.');
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });
});

