import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { AgentConfig } from '../../types';
import { formatDate, getWorkspacePath } from '../../utilities';
import { QMD } from './qmd';
import { createLogger } from '../../../utilities/logger';

const logger = createLogger('Memory');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_IDENTITY_PATH = join(__dirname, 'defaults', 'IDENTITY.md');

function getNotesPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'notes');
}

function getSessionsPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'sessions');
}

function getUserPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'USER.md');
}

function getIdentityPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'IDENTITY.md');
}

function createNotesQmd(config: AgentConfig): QMD {
  return new QMD({
    collectionName: `${config.id}-notes`,
    collectionDescription:
      'Daily conversation notes (notes/YYYY-MM-DD.md). Use for recent context and summarization.',
    mask: '**/*.md',
    workspacePath: getWorkspacePath(config),
  });
}

function createSessionsQmd(config: AgentConfig): QMD {
  return new QMD({
    collectionName: `${config.id}-sessions`,
    collectionDescription:
      'Session transcripts (sessions/*.jsonl). Past conversation turns and decisions.',
    mask: '**/*.jsonl',
    workspacePath: getWorkspacePath(config),
  });
}

function createMemoryRecentTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_recent',
    label: 'memory: recent',
    description:
      'Retrieve the last N days of daily notes (notes/YYYY-MM-DD.md) in reverse chronological order. Use when you need recent context for an ongoing conversation or project. Do not use when looking for a specific fact or topic—use memory_search instead.',
    parameters: Type.Object({
      max_notes: Type.Optional(
        Type.Number({
          description:
            'Number of most recent day files to include (default 3, max 50)',
        })
      ),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const max_notes = (params as { max_notes?: number }).max_notes ?? 3;

      const limit = Math.max(1, Math.min(50, max_notes));
      const notesPath = getNotesPath(config);
      let notesDirOk = false;
      try {
        notesDirOk =
          fs.existsSync(notesPath) && fs.statSync(notesPath).isDirectory();
      } catch {
        notesDirOk = false;
      }
      if (!notesDirOk) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No recent conversation notes (notes directory not available).',
            },
          ],
          details: {},
        };
      }
      let files: string[];
      try {
        files = fs.readdirSync(notesPath);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Could not read notes directory.',
            },
          ],
          details: {},
        };
      }
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      if (mdFiles.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No recent conversation notes.' },
          ],
          details: {},
        };
      }

      const withMtime = mdFiles.map((f) => ({
        name: f,
        mtime: fs.statSync(join(notesPath, f)).mtimeMs,
      }));

      withMtime.sort((a, b) => b.mtime - a.mtime);

      const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
      const qmd = createNotesQmd(config);
      let text: string;
      try {
        text = await qmd.multiGet(dayFiles);
      } catch (err) {
        text =
          'Error fetching conversation notes: ' +
          (err instanceof Error ? err.message : String(err));
      }
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  };
}

function createMemorySearchTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_search',
    label: 'memory: search',
    description:
      'Find past notes and session transcripts that match a query. Use when you need a specific fact, name, decision, task, or topic. Use scope to choose where: notes (daily notes, condensed from sessions—default, try first), sessions (raw transcripts), or both. If notes return nothing useful, call again with sessions or both. Do not use for "recent context"—use memory_recent instead. Performance: keyword = fastest (no LLM), semantic = moderate (embedding), hybrid = slowest (expansion + rerank) but best quality.',
    parameters: Type.Object({
      search_query: Type.String({
        description: 'What to look for (e.g. a name, decision, or topic)',
      }),
      scope: Type.Optional(
        Type.Union(
          [
            Type.Literal('notes', {
              description:
                'Search daily notes only (notes/YYYY-MM-DD.md). Default. Use first—notes are condensed from sessions. Fastest when you only need notes.',
            }),
            Type.Literal('sessions', {
              description:
                'Search session transcripts only (sessions/*.jsonl). Use when the fact was not in notes or you need raw conversation detail.',
            }),
            Type.Literal('both', {
              description:
                'Search both notes and session transcripts in one call. Use when you want everything at once or after notes did not contain the answer.',
            }),
          ],
          {
            description:
              'Where to search: notes (default, try first), sessions (if not in notes), or both. Omit for notes.',
          }
        )
      ),
      search_mode: Type.Optional(
        Type.Union(
          [
            Type.Literal('keyword', {
              description:
                'BM25 full-text only. Fastest—no embedding or LLM. Use when the user or notes use exact phrases, names, project IDs, or known terms. Precise for keyword match.',
            }),
            Type.Literal('semantic', {
              description:
                'Vector search only. Moderate—runs embedding + vector search. Use when you are looking by meaning or paraphrase (e.g. "how we chose the database") and may not know the exact wording.',
            }),
            Type.Literal('hybrid', {
              description:
                'BM25 + vector + query expansion + reranking. Slowest—expansion, FTS, vector, and reranker—but best quality. Use when unsure or when the query could match by both keywords and meaning. Default.',
            }),
          ],
          {
            description:
              'How to match. Performance: keyword (fastest), semantic (moderate), hybrid (slowest, best). Omit for hybrid.',
          }
        )
      ),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { search_query, search_mode, scope } = params as {
        search_query: string;
        search_mode?: 'keyword' | 'semantic' | 'hybrid';
        scope?: 'notes' | 'sessions' | 'both';
      };
      const query = typeof search_query === 'string' ? search_query.trim() : '';
      if (!query) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No search query provided. Use search_query to say what to look for.',
            },
          ],
          details: {},
        };
      }
      const mode = search_mode ?? 'hybrid';
      const searchScope = scope ?? 'notes';

      const notesQmd = createNotesQmd(config);
      const sessionsQmd = createSessionsQmd(config);
      const parts: string[] = [];

      const searchNotes = async (): Promise<string> => {
        if (mode === 'keyword') {
          return notesQmd.search(query);
        }
        if (mode === 'semantic') {
          return notesQmd.vsearch(query);
        }
        return notesQmd.hybridSearch(query);
      };

      const searchSessions = async (): Promise<string> => {
        if (mode === 'keyword') {
          return sessionsQmd.search(query);
        }
        if (mode === 'semantic') {
          return sessionsQmd.vsearch(query);
        }
        return sessionsQmd.hybridSearch(query);
      };

      try {
        if (searchScope === 'notes' || searchScope === 'both') {
          const notesResult = await searchNotes();
          if (notesResult.trim()) {
            parts.push('## From notes\n' + notesResult.trim());
          }
        }
      } catch (err) {
        parts.push(
          'Notes search failed: ' +
            (err instanceof Error ? err.message : String(err))
        );
      }

      try {
        if (searchScope === 'sessions' || searchScope === 'both') {
          const sessionsResult = await searchSessions();
          if (sessionsResult.trim()) {
            parts.push('## From session transcripts\n' + sessionsResult.trim());
          }
        }
      } catch (err) {
        parts.push(
          'Session transcripts search failed: ' +
            (err instanceof Error ? err.message : String(err))
        );
      }

      const text =
        parts.length > 0
          ? parts.join('\n\n')
          : searchScope === 'both'
            ? 'No matching notes or session transcripts found.'
            : searchScope === 'notes'
              ? 'No matching notes found. Try scope "sessions" or "both" for session transcripts.'
              : 'No matching session transcripts found.';
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  };
}

function createMemorySummarizeTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_summarize',
    label: 'memory: summarize',
    description:
      'Gather notes and session transcripts (by topic) or recent days of notes only; return raw text so you can recap or summarize in your reply. Use when you want to summarize past conversations; use memory_search when you need to find one specific fact.',
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({
          description:
            'Optional topic to focus on (semantic search); omit to use recent days only',
        })
      ),
      max_notes: Type.Optional(
        Type.Number({
          description:
            'When no topic: number of recent day files (1–10, default 3)',
        })
      ),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { topic, max_notes } = params as {
        topic?: string;
        max_notes?: number;
      };

      const notesQmd = createNotesQmd(config);
      const sessionsQmd = createSessionsQmd(config);
      let text: string;
      try {
        if (topic && topic.trim()) {
          const parts: string[] = [];
          try {
            const notesResult = await notesQmd.vsearch(topic.trim());
            if (notesResult.trim())
              parts.push('## From notes\n' + notesResult.trim());
          } catch (err) {
            parts.push(
              'Notes search failed: ' +
                (err instanceof Error ? err.message : String(err))
            );
          }
          try {
            const sessionsResult = await sessionsQmd.vsearch(topic.trim());
            if (sessionsResult.trim()) {
              parts.push(
                '## From session transcripts\n' + sessionsResult.trim()
              );
            }
          } catch (err) {
            parts.push(
              'Session transcripts search failed: ' +
                (err instanceof Error ? err.message : String(err))
            );
          }
          text =
            parts.length > 0
              ? parts.join('\n\n')
              : 'No notes or session transcripts found for this topic.';
        } else {
          const limit = Math.max(1, Math.min(10, max_notes ?? 3));
          const notesPath = getNotesPath(config);
          let notesDirOk = false;
          try {
            notesDirOk =
              fs.existsSync(notesPath) && fs.statSync(notesPath).isDirectory();
          } catch {
            notesDirOk = false;
          }
          if (!notesDirOk) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'No past conversation notes available to summarize.',
                },
              ],
              details: {},
            };
          }
          let files: string[];
          try {
            files = fs.readdirSync(notesPath);
          } catch {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Could not read notes directory.',
                },
              ],
              details: {},
            };
          }
          const mdFiles = files.filter((f) => f.endsWith('.md'));

          if (mdFiles.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'No past conversation notes available to summarize.',
                },
              ],
              details: {},
            };
          }

          const withMtime = mdFiles.map((f) => ({
            name: f,
            mtime: fs.statSync(join(notesPath, f)).mtimeMs,
          }));

          withMtime.sort((a, b) => b.mtime - a.mtime);

          const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
          text = await notesQmd.multiGet(dayFiles);
        }
      } catch (err) {
        text =
          'Error collecting notes for summarization: ' +
          (err instanceof Error ? err.message : String(err));
      }

      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
        details: {},
      };
    },
  };
}

function createMemoryGetTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_get',
    label: 'memory: get',
    description:
      'Fetch one note or transcript snippet by its docid (e.g. #79462a). Use only when you already have a docid from a previous memory_recent, memory_search, or memory_summarize result. Searches both daily notes and session transcripts.',
    parameters: Type.Object({
      docid: Type.String({
        description: 'The docid (e.g. #79462a from a prior result)',
      }),
      start_line: Type.Optional(
        Type.Number({
          description: 'Line number to start from (0 = first line)',
        })
      ),
      max_lines: Type.Optional(
        Type.Number({ description: 'Maximum number of lines to return' })
      ),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { docid, start_line, max_lines } = params as {
        docid: string;
        start_line?: number;
        max_lines?: number;
      };

      const trimmedDocid = typeof docid === 'string' ? docid.trim() : '';
      if (!trimmedDocid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No docid provided. Use a docid from a previous memory_recent, memory_search, or memory_summarize result (e.g. #79462a).',
            },
          ],
          details: {},
        };
      }
      const options = { startLine: start_line, maxLines: max_lines };

      try {
        const notesQmd = createNotesQmd(config);
        const text = await notesQmd.get(trimmedDocid, options);
        return { content: [{ type: 'text' as const, text }], details: {} };
      } catch {
        // Try sessions collection when docid is not in notes.
      }

      try {
        const sessionsQmd = createSessionsQmd(config);
        const text = await sessionsQmd.get(trimmedDocid, options);
        return { content: [{ type: 'text' as const, text }], details: {} };
      } catch (err: unknown) {
        const text =
          'Error getting note or transcript: ' +
          (err instanceof Error ? err.message : String(err));
        return { content: [{ type: 'text' as const, text }], details: {} };
      }
    },
  };
}

function createMemoryUserSetTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_user_set',
    label: 'memory: user set',
    description:
      'Write or replace USER.md (persistent facts about the user). Call when the user shares or corrects something about themselves. Read current content with memory_user_get first, then merge and send the full updated content.',
    parameters: Type.Object({
      content: Type.String({
        description:
          'The full content for USER.md (include all existing facts plus updates)',
      }),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { content } = params as { content: string };

      const userPath = getUserPath(config);
      fs.writeFileSync(userPath, content, 'utf8');
      return {
        content: [{ type: 'text' as const, text: `${userPath} updated.` }],
        details: {},
      };
    },
  };
}

function createMemoryIdentitySetTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_identity_set',
    label: 'memory: identity set',
    description:
      'Write or replace IDENTITY.md (your identity, persona, and how to behave). Call when the user defines or changes who you are. Read current content with memory_identity_get first, then merge and send the full updated content.',
    parameters: Type.Object({
      content: Type.String({
        description:
          'The full content for IDENTITY.md (include all existing identity info plus updates)',
      }),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { content } = params as { content: string };

      const identityPath = getIdentityPath(config);
      fs.writeFileSync(identityPath, content, 'utf8');
      return {
        content: [{ type: 'text' as const, text: `${identityPath} updated.` }],
        details: {},
      };
    },
  };
}

/**
 * Append a conversation note to the workspace YYYY-MM-DD.md.
 * Exported for use by context condense (agent/context.ts).
 */
export async function saveConversationNote(
  note: string,
  conversationStartIso: string,
  config: AgentConfig
): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;

  const d = new Date(conversationStartIso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid conversationStartIso: ${conversationStartIso}`);
  }

  const date = d.toLocaleDateString('en-CA');
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const notesPath = getNotesPath(config);
  const dayPath = join(notesPath, `${date}.md`);
  fs.mkdirSync(notesPath, { recursive: true });
  const existingBody = fs.existsSync(dayPath)
    ? fs.readFileSync(dayPath, 'utf8')
    : '';

  let body = insertNoteUnderTimeSection(existingBody, `## ${time}`, trimmed);
  body = ensureDateH1(body, date);

  fs.writeFileSync(dayPath, body.trimEnd() + '\n', 'utf8');

  function ensureDateH1(body: string, date: string): string {
    const h1 = `# ${date}`;
    if (body.startsWith(h1)) return body;
    const withoutH1 = body.replace(/^\s*# .*$/m, '').trimStart();
    return h1 + '\n\n' + (withoutH1 || '');
  }

  function insertNoteUnderTimeSection(
    body: string,
    timeHeading: string,
    note: string
  ): string {
    const escaped = timeHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\n)(${escaped})(?:\\s|$)`, 'm');
    const match = body.match(re);
    if (match?.index != null) {
      const insertAt =
        match.index + (body[match.index] === '\n' ? 1 : 0) + timeHeading.length;
      return (
        body.slice(0, insertAt) + '\n\n' + note + '\n\n' + body.slice(insertAt)
      );
    }
    const prefix = body ? body + '\n\n' : '';
    return prefix + timeHeading + '\n\n' + note + '\n\n';
  }
}

function createMemoryNoteTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_note',
    label: 'memory: note',
    description:
      'Save a note to daily notes (append to YYYY-MM-DD.md). Use at the end of substantive replies when something is worth remembering (decisions, plans, task progress). Not for retrieval—use memory_recent or memory_search to read notes.',
    parameters: Type.Object({
      note: Type.String({
        description: 'The note to save (task, topic, or conversation summary)',
      }),
      category: Type.Optional(
        Type.Union([
          Type.Literal('decision'),
          Type.Literal('task'),
          Type.Literal('summary'),
          Type.Literal('context'),
        ])
      ),
      conversation_start_iso: Type.String({
        description:
          'ISO timestamp when this conversation started (use the value from the system prompt)',
      }),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { note, category, conversation_start_iso } = params as {
        note: string;
        category?: 'decision' | 'task' | 'summary' | 'context';
        conversation_start_iso: string;
      };
      const trimmed = note.trim();
      if (!trimmed) {
        return {
          content: [{ type: 'text' as const, text: 'No content to save.' }],
          details: {},
        };
      }

      const d = new Date(conversation_start_iso);
      if (Number.isNaN(d.getTime())) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Could not save note: invalid conversation_start_iso "${conversation_start_iso}".`,
            },
          ],
          details: {},
        };
      }

      const prefix =
        category != null ? `**[${category}]** ${trimmed}` : trimmed;

      const date = d.toLocaleDateString('en-CA');
      const time = d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      try {
        await saveConversationNote(prefix, conversation_start_iso, config);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Saved note to ${date}.md under ${time}.`,
            },
          ],
          details: {},
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unknown error while saving note.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error saving note: ${message}`,
            },
          ],
          details: {},
        };
      }
    },
  };
}

function createMemoryUserGetTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_user_get',
    label: 'memory: user get',
    description:
      'Read USER.md (persistent facts about the user). Use when you need current user context or before updating with memory_user_set.',
    parameters: Type.Object({}),
    execute: async (_id, _params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const userPath = getUserPath(config);
      if (!fs.existsSync(userPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'USER.md not found. Use memory_user_set to add user information.',
            },
          ],
          details: {},
        };
      }
      try {
        const text = fs.readFileSync(userPath, 'utf8');
        return { content: [{ type: 'text' as const, text }], details: {} };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Could not read USER.md: ' +
                (err instanceof Error ? err.message : String(err)),
            },
          ],
          details: {},
        };
      }
    },
  };
}

function createMemoryIdentityGetTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_identity_get',
    label: 'memory: identity get',
    description:
      'Read IDENTITY.md (your identity, persona, and how to behave). Use when you need your current identity or before updating with memory_identity_set.',
    parameters: Type.Object({}),
    execute: async (_id, _params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const identityPath = getIdentityPath(config);
      if (!fs.existsSync(identityPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'IDENTITY.md not found. Use memory_identity_set to set your identity.',
            },
          ],
          details: {},
        };
      }
      try {
        const text = fs.readFileSync(identityPath, 'utf8');
        return { content: [{ type: 'text' as const, text }], details: {} };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Could not read IDENTITY.md: ' +
                (err instanceof Error ? err.message : String(err)),
            },
          ],
          details: {},
        };
      }
    },
  };
}

function buildTools(config: AgentConfig): AgentTool[] {
  return [
    createMemoryUserSetTool(config),
    createMemoryUserGetTool(config),
    createMemoryIdentitySetTool(config),
    createMemoryIdentityGetTool(config),
    createMemorySearchTool(config),
    createMemorySummarizeTool(config),
    createMemoryGetTool(config),
    createMemoryNoteTool(config),
    createMemoryRecentTool(config),
  ];
}

function buildInstructions(
  conversationStartIso: string,
  config: AgentConfig
): string {
  return `
## Memory: when to use which tool

**Retrieval (reading):**
- Need **recent context** for an ongoing conversation or project? → \`memory_recent\` (last N days of daily notes). Skip for one-off questions.
- Looking for a **specific fact**, name, decision, or topic? → \`memory_search\` (searches notes and/or session transcripts). Do not use for "recent context." Prefer **scope: notes** first (daily notes, condensed from sessions); if you don't find it there, call again with **scope: sessions** or **scope: both**. **search_mode**: **keyword** for exact phrases/names/IDs—fastest; **semantic** for meaning/paraphrases—moderate; **hybrid** (default) when unsure—slowest but best quality.
- Want to **recap or summarize** past conversations in your reply? → \`memory_summarize\` (gathers notes and session transcripts by topic, or recent days of notes; you summarize). Use \`memory_search\` when you need one specific fact, not a bundle to summarize.
- Already have a **docid** (e.g. #79462a) from a prior result? → \`memory_get\` to fetch that note or transcript snippet (searches both notes and sessions). Use \`memory_recent\` / \`memory_search\` / \`memory_summarize\` first to discover docids.
- Need **USER.md** or **IDENTITY.md**? They are in the blocks below. Use \`memory_user_get\` or \`memory_identity_get\` only if you need to re-read them before updating.

Weave recalled context in naturally—do not say "I see that...", "Based on our previous conversation...", or similar. Respond as if you remember.

**Saving (writing):**
- **User facts** (name, preferences, context) → \`memory_user_set\`. Read with \`memory_user_get\` first, merge with "Information about the user" below. Call when the user shares or corrects something about themselves. Ask: "Will this still be true in 2 weeks?"
- **Your identity** (persona, behavior) → \`memory_identity_set\`. Read with \`memory_identity_get\` first, merge with "Your identity" below. Call when the user defines or changes who you are.
- **Conversation/task notes** → \`memory_note\`. Use at the end of substantive replies when a decision, plan, or task progress is worth remembering. Set \`category\` (\`decision\`, \`task\`, \`summary\`, \`context\`) when possible. Use \`conversation_start_iso\` from below. Do not save small talk, one-off debugging, or trivial exchanges.

Before ending your response: \`memory_note\` (decisions/plans), \`memory_user_set\` (they shared/corrected something about themselves), \`memory_identity_set\` (they defined/changed who you are), \`save_skill\` (something reusable learned).

### Your identity
${(function () {
  try {
    return fs.existsSync(getIdentityPath(config))
      ? fs.readFileSync(getIdentityPath(config), 'utf8')
      : '(IDENTITY.md not found. Use memory_identity_set to set.)';
  } catch {
    return '(Could not read IDENTITY.md.)';
  }
})()}

### Information about the user
${(function () {
  try {
    return fs.existsSync(getUserPath(config))
      ? fs.readFileSync(getUserPath(config), 'utf8')
      : '(USER.md not found. Use memory_user_set to add.)';
  } catch {
    return '(Could not read USER.md.)';
  }
})()}

### Workspace
Memory files and workspace: ${getWorkspacePath(config)}.

### Conversation start
Conversation started: ${formatDate(conversationStartIso)}. For \`memory_note\` use conversation_start_iso: \`${conversationStartIso}\`.
  `;
}

export async function load(
  config: AgentConfig,
  conversationStartIso: string
): Promise<{
  tools: AgentTool[];
  instructions: string;
}> {
  const workspacePath = getWorkspacePath(config);

  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  if (!fs.existsSync(getUserPath(config))) {
    fs.writeFileSync(getUserPath(config), '');
  }

  if (!fs.existsSync(getIdentityPath(config))) {
    fs.copyFileSync(DEFAULT_IDENTITY_PATH, getIdentityPath(config));
  }

  const notesPath = getNotesPath(config);

  if (!fs.existsSync(notesPath)) {
    fs.mkdirSync(notesPath, { recursive: true });
  }

  const sessionsPath = getSessionsPath(config);

  if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
  }

  logger.info('Loading session notes collection...');
  const notesQmd = createNotesQmd(config);
  await notesQmd.ready();

  logger.info('Loading session logs collection...');
  const sessionsQmd = createSessionsQmd(config);
  await sessionsQmd.ready();

  return {
    tools: buildTools(config),
    instructions: buildInstructions(conversationStartIso, config),
  };
}
