import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentConfig } from '../../../types';
import { getInstructions, getTools, saveConversationNote } from '..';

function createMockConfig(workspace: string): AgentConfig {
  return {
    id: 'test',
    workspace,
    port: '0',
    models: [],
    tools: {},
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

describe('memory', () => {
  describe('getTools()', () => {
    it('exposes memory tools with simple names', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const tools = getTools(config);
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
        const tools = getTools(config);
        const userSet = getTool(tools, 'memory_user_set');
        const userGet = getTool(tools, 'memory_user_get');

        const content = 'name: Koen\nprefers: concise bullets\n';

        await userSet.execute('test', { content }, undefined);
        const result = await userGet.execute('test', {}, undefined);

        const text = (result.content[0] as { text: string }).text;
        expect(text).toBe(content);
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
        const tools = getTools(config);
        const identitySet = getTool(tools, 'memory_identity_set');
        const identityGet = getTool(tools, 'memory_identity_get');

        const content = '# Identity\nYou are a focused coding agent.\n';

        await identitySet.execute('test', { content }, undefined);
        const result = await identityGet.execute('test', {}, undefined);

        const text = (result.content[0] as { text: string }).text;
        expect(text).toBe(content);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });

  describe('memory_note tool', () => {
    it('returns friendly message on invalid ISO timestamp', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const tools = getTools(config);
        const noteTool = getTool(tools, 'memory_note');

        const result = await noteTool.execute(
          'test',
          { note: 'Some note', conversation_start_iso: 'not-a-timestamp' },
          undefined
        );

        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('Could not save note');
        expect(text).toContain('invalid conversation_start_iso');
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
        const iso = '2024-01-02T10:15:00.000Z';
        const note = 'We decided to use PostgreSQL.';

        await saveConversationNote(note, iso, config);

        const chatsDir = join(workspace, 'chats');
        const dateFile = join(chatsDir, '2024-01-02.md');
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

  describe('getInstructions()', () => {
    it('references new memory_* tool names', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const iso = '2024-01-02T10:15:00.000Z';
        const instructions = getInstructions(iso, config);

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
  });

  describe('memory_note structuring and summarize tool', () => {
    it('prefixes note with category marker when provided', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const tools = getTools(config);
        const noteTool = getTool(tools, 'memory_note');

        const iso = '2024-01-02T10:15:00.000Z';
        const note = 'We decided to use SQLite for local dev.';

        await noteTool.execute(
          'test',
          { note, category: 'decision', conversation_start_iso: iso },
          undefined
        );

        const dateFile = join(workspace, 'chats', '2024-01-02.md');
        const body = await fs.readFile(dateFile, 'utf8');

        expect(body).toContain(
          '**[decision]** We decided to use SQLite for local dev.'
        );
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });

    it('memory_summarize returns text when notes exist', async () => {
      const workspace = await createTempWorkspace();
      const config = createMockConfig(workspace);

      try {
        const iso = '2024-01-02T10:15:00.000Z';
        const note = 'We discussed deployment strategy.';
        await saveConversationNote(note, iso, config);

        const tools = getTools(config);
        const summarize = getTool(tools, 'memory_summarize');

        const result = await summarize.execute(
          'test',
          { topic: 'deployment', max_notes: 5 },
          undefined
        );

        const text = (result.content[0] as { text: string }).text;
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      } finally {
        await cleanupTempWorkspace(workspace);
      }
    });
  });
});

