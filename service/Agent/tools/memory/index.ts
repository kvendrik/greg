import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type { AgentConfig } from '../../types';
import { formatDate, getWorkspacePath } from '../../utilities';
import {
  ensureCollection,
  get as qmdGet,
  multiGet,
  runUpdateAndEmbed,
  vsearch,
} from './qmd';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_IDENTITY_PATH = join(__dirname, 'defaults', 'IDENTITY.md');

function getChatsPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'chats');
}

function getUserPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'USER.md');
}

function getIdentityPath(config: AgentConfig): string {
  return join(getWorkspacePath(config), 'IDENTITY.md');
}

function ensureWorkspaceExistsSync(config: AgentConfig): void {
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
  const chatsPath = getChatsPath(config);
  if (!fs.existsSync(chatsPath)) {
    fs.mkdirSync(chatsPath, { recursive: true });
  }
}

async function ensureWorkspaceExists(config: AgentConfig): Promise<void> {
  ensureWorkspaceExistsSync(config);
  await ensureCollection(getChatsPath(config), config);
}

function createGetRecentConversationNotesTool(
  config: AgentConfig
): AgentTool {
  return {
    name: 'memory_recent',
    label: 'memory: recent',
    description:
      'Get recent conversation notes from the last few days (medium-term memory).',
    parameters: Type.Object({
      max_notes: Type.Optional(
        Type.Number({
          description:
            'Max number of recent days to fetch notes for (each day file can contain multiple notes)',
        })
      ),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const max_notes = (params as { max_notes?: number }).max_notes ?? 3;
      await ensureWorkspaceExists(config);
      const limit = Math.max(1, Math.min(50, max_notes));
      const chatsPath = getChatsPath(config);
      const files = fs.readdirSync(chatsPath);
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
        mtime: fs.statSync(join(chatsPath, f)).mtimeMs,
      }));

      withMtime.sort((a, b) => b.mtime - a.mtime);

      const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
      let text: string;
      try {
        text = await multiGet(dayFiles, config);
      } catch (err) {
        text =
          'Error fetching conversation notes: ' +
          (err instanceof Error ? err.message : String(err));
      }
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  };
}

function createSearchConversationNotesTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_search',
    label: 'memory: search',
    description:
      'Search through past conversations using semantic + keyword search.',
    parameters: Type.Object({
      search_query: Type.String({ description: 'The query to search for' }),
    }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { search_query } = params as { search_query: string };
      await ensureWorkspaceExists(config);
      let text: string;
      try {
        text = await vsearch(search_query, config);
      } catch (err) {
        text =
          'Error searching conversations: ' +
          (err instanceof Error ? err.message : String(err));
      }
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  };
}

function createSummarizeConversationNotesTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_summarize',
    label: 'memory: summarize',
    description:
      'Collect recent or topic-focused notes so you can summarize past conversations in your own words.',
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({
          description:
            'Optional topic or query to focus on (uses semantic search when provided)',
        })
      ),
      max_notes: Type.Optional(
        Type.Number({
          description:
            'Approximate max number of recent day files to include (1-10).',
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

      await ensureWorkspaceExists(config);

      let text: string;
      try {
        if (topic && topic.trim()) {
          // Let QMD pick the most relevant snippets for the topic.
          text = await vsearch(topic, config);
        } else {
          const limit = Math.max(1, Math.min(10, max_notes ?? 3));
          const chatsPath = getChatsPath(config);
          const files = fs.readdirSync(chatsPath);
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
            mtime: fs.statSync(join(chatsPath, f)).mtimeMs,
          }));

          withMtime.sort((a, b) => b.mtime - a.mtime);

          const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
          text = await multiGet(dayFiles, config);
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

function createGetConversationNoteTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_get',
    label: 'memory: get',
    description: 'Get a single past conversation note by docid.',
    parameters: Type.Object({
      docid: Type.String({
        description:
          'The docid of the memory entry to get (Starts with a hash symbol. Example: #79462a)',
      }),
      start_line: Type.Optional(
        Type.Number({
          description: 'Line number to start from (0 is the first line)',
        })
      ),
      max_lines: Type.Optional(
        Type.Number({ description: 'Max number of lines to return' })
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
      await ensureWorkspaceExists(config);
      try {
        const text = await qmdGet(
          docid,
          { startLine: start_line, maxLines: max_lines },
          config
        );
        return { content: [{ type: 'text' as const, text }], details: {} };
      } catch (err: unknown) {
        const text =
          'Error getting conversation note: ' +
          (err instanceof Error ? err.message : String(err));
        return { content: [{ type: 'text' as const, text }], details: {} };
      }
    },
  };
}

function createUpdateUserMemoryTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_user_set',
    label: 'memory: user set',
    description: `Replace USER.md with persistent facts about the user. Call when the user shares or changes something about themselves (name, preferences, context). Always send the complete updated content (merge with existing so information stays accurate).`,
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
      await ensureWorkspaceExists(config);
      const userPath = getUserPath(config);
      fs.writeFileSync(userPath, content, 'utf8');
      return {
        content: [{ type: 'text' as const, text: `${userPath} updated.` }],
        details: {},
      };
    },
  };
}

function createUpdateIdentityTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_identity_set',
    label: 'memory: identity set',
    description: `Replace IDENTITY.md with who you are. Call when the user defines or changes your identity, persona, or how you should behave. Always send the complete updated content (merge with existing).`,
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
      await ensureWorkspaceExists(config);
      const identityPath = getIdentityPath(config);
      fs.writeFileSync(identityPath, content, 'utf8');
      return {
        content: [
          { type: 'text' as const, text: `${identityPath} updated.` },
        ],
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

  await ensureWorkspaceExists(config);

  const date = d.toLocaleDateString('en-CA');
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const dayPath = join(getChatsPath(config), `${date}.md`);
  const existingBody = fs.existsSync(dayPath)
    ? fs.readFileSync(dayPath, 'utf8')
    : '';

  let body = insertNoteUnderTimeSection(existingBody, `## ${time}`, trimmed);
  body = ensureDateH1(body, date);

  fs.writeFileSync(dayPath, body.trimEnd() + '\n', 'utf8');
  runUpdateAndEmbed(config);

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

function createSaveConversationNoteTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_note',
    label: 'memory: note',
    description: `Append a brief note to chats/YYYY-MM-DD.md at the time the conversation started. Call at the end of substantive replies when a decision was made, a plan was agreed, or a multi-step task moved forward (not for small talk or one-off debug). Use conversation_start_iso from the system prompt.`,
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
          err instanceof Error ? err.message : 'Unknown error while saving note.';
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

function createGetUserMemoryTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_user_get',
    label: 'memory: user get',
    description: 'Read the current USER.md persistent user memory.',
    parameters: Type.Object({}),
    execute: async (_id, _params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      await ensureWorkspaceExists(config);
      const userPath = getUserPath(config);
      const text = fs.readFileSync(userPath, 'utf8');
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  };
}

function createGetIdentityTool(config: AgentConfig): AgentTool {
  return {
    name: 'memory_identity_get',
    label: 'memory: identity get',
    description: 'Read the current IDENTITY.md (who you are and how to behave).',
    parameters: Type.Object({}),
    execute: async (_id, _params, signal) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      await ensureWorkspaceExists(config);
      const identityPath = getIdentityPath(config);
      const text = fs.readFileSync(identityPath, 'utf8');
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  };
}

export function getTools(config: AgentConfig): AgentTool[] {
  return [
    createUpdateUserMemoryTool(config),
    createGetUserMemoryTool(config),
    createUpdateIdentityTool(config),
    createGetIdentityTool(config),
    createSearchConversationNotesTool(config),
    createSummarizeConversationNotesTool(config),
    createGetConversationNoteTool(config),
    createSaveConversationNoteTool(config),
    createGetRecentConversationNotesTool(config),
  ];
}

export function getInstructions(
  conversationStartIso: string,
  config: AgentConfig
): string {
  ensureWorkspaceExistsSync(config);
  return `
## Memory recall
Memory has three layers: this conversation (short-term), daily notes in chats/ (medium-term; use \`memory_recent\`, \`memory_search\`, \`memory_summarize\`, and \`memory_get\`), and the blocks below (long-term; USER.md + IDENTITY.md).

When you need past context:

- Use \`memory_recent\` to load the last few days of notes for ongoing/project conversations (skip it for clearly one-off questions).
- Use \`memory_search\` when you are looking for specific information (IDs, decisions, tasks, names) that likely lives in past notes.
- Use \`memory_summarize\` when you want a compact bundle of notes around a topic so that you can summarize them yourself in your reply.
- Use \`memory_get\` when you already know a specific note \`docid\` and only need that one entry (optionally a slice via \`start_line\` / \`max_lines\`).

When you use recalled context or the blocks below, weave it in naturally—do not say "I see that...", "Based on our previous conversation...", or similar. Respond as if you remember.

## Saving to memory
At the end of substantive replies, decide whether anything is worth saving. Save when a decision or plan is made, the user shares a durable preference or identity detail, or a multi-step task moves forward. Do not save pure small talk, one-off debugging, or trivial clarifications. Keep USER.md and IDENTITY.md concise: quality over quantity; only include information that will still be relevant.

- **Persistent user facts** (name, preferences, context) → \`memory_user_set\` with the full updated USER.md. When in doubt, first read the current file with \`memory_user_get\`. Merge with "Information about the user" below. Before saving, ask: "Will this still be true in 2 weeks?". Call when the user shares or corrects something about themselves.
- **Your identity** (persona, how you should behave) → \`memory_identity_set\` with the full updated IDENTITY.md. When in doubt, first read the current file with \`memory_identity_get\`. Merge with "Your identity" below. Call when the user defines or changes who you are.
- **Conversation/task info** → \`memory_note\` for non-trivial exchanges: what was discussed, decisions, tasks, or what you did. Set the \`category\` parameter when possible (\`decision\`, \`task\`, \`summary\`, or \`context\`) so future search and summarization work better. Write notes that are self-contained and use natural language (and key names/terms) so search can find them later. Use \`conversation_start_iso\` from below. Do not save: small talk or greetings only, temporary debugging, or one-line exchanges.

Before ending your response, quickly check: \`memory_note\` (for decisions/plans), \`memory_user_set\` (if they shared or corrected something about themselves), \`memory_identity_set\` (if they defined or changed who you are), \`save_skill\` (if something reusable was learned).

### Your identity
${fs.readFileSync(getIdentityPath(config), 'utf8')}

### Information about the user
${fs.readFileSync(getUserPath(config), 'utf8')}

### Workspace
Memory files and workspace: ${getWorkspacePath(config)}.

### Conversation start
Conversation started: ${formatDate(conversationStartIso)}. For \`memory_note\` use conversation_start_iso: \`${conversationStartIso}\`.
  `;
}
