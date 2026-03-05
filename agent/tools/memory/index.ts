import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
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

function getChatsPath(): string {
  return join(getWorkspacePath(), 'chats');
}

function getUserPath(): string {
  return join(getWorkspacePath(), 'USER.md');
}

function getIdentityPath(): string {
  return join(getWorkspacePath(), 'IDENTITY.md');
}

if (!fs.existsSync(getWorkspacePath())) {
  fs.mkdirSync(getWorkspacePath(), { recursive: true });
}

if (!fs.existsSync(getUserPath())) {
  fs.writeFileSync(getUserPath(), '');
}

if (!fs.existsSync(getIdentityPath())) {
  fs.copyFileSync(DEFAULT_IDENTITY_PATH, getIdentityPath());
}

async function ensureWorkspaceExists(): Promise<void> {
  const chatsPath = getChatsPath();

  if (!fs.existsSync(chatsPath)) {
    fs.mkdirSync(chatsPath, { recursive: true });
  }

  await ensureCollection(chatsPath);
}

const getRecentConversationNotesTool: AgentTool = {
  name: 'get_recent_conversation_notes',
  label: 'get recent conversation notes',
  description: 'Get the most recent conversation notes.',
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
    await ensureWorkspaceExists();
    const limit = Math.max(1, Math.min(50, max_notes));

    const files = fs.readdirSync(getChatsPath());
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
      mtime: fs.statSync(join(getChatsPath(), f)).mtimeMs,
    }));

    withMtime.sort((a, b) => b.mtime - a.mtime);

    const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
    let text: string;
    try {
      text = await multiGet(dayFiles);
    } catch (err) {
      text =
        'Error fetching conversation notes: ' +
        (err instanceof Error ? err.message : String(err));
    }
    return { content: [{ type: 'text' as const, text }], details: {} };
  },
};

const searchConversationNotesTool: AgentTool = {
  name: 'search_past_conversations',
  label: 'search past conversations',
  description: 'Search through past conversations.',
  parameters: Type.Object({
    search_query: Type.String({ description: 'The query to search for' }),
  }),
  execute: async (_id, params, signal) => {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { search_query } = params as { search_query: string };
    await ensureWorkspaceExists();
    let text: string;
    try {
      text = await vsearch(search_query);
    } catch (err) {
      text =
        'Error searching conversations: ' +
        (err instanceof Error ? err.message : String(err));
    }
    return { content: [{ type: 'text' as const, text }], details: {} };
  },
};

const getConversationNoteTool: AgentTool = {
  name: 'get_past_conversation',
  label: 'get past conversation',
  description: 'Get a single conversation by docid',
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
    await ensureWorkspaceExists();
    try {
      const text = await qmdGet(docid, {
        startLine: start_line,
        maxLines: max_lines,
      });
      return { content: [{ type: 'text' as const, text }], details: {} };
    } catch (err: unknown) {
      const text =
        'Error getting conversation note: ' +
        (err instanceof Error ? err.message : String(err));
      return { content: [{ type: 'text' as const, text }], details: {} };
    }
  },
};

const updateUserMemoryTool: AgentTool = {
  name: 'save_user_memory',
  label: 'save user memory',
  description: `Update USER.md with persistent facts about the user. Call whenever the user shares something about themselves (name, preferences, context). Pass the complete updated content (merge with existing so information stays accurate).`,
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
    await ensureWorkspaceExists();
    fs.writeFileSync(getUserPath(), content, 'utf8');
    return {
      content: [{ type: 'text' as const, text: `${getUserPath()} updated.` }],
      details: {},
    };
  },
};

const updateIdentityTool: AgentTool = {
  name: 'save_identity',
  label: 'save identity',
  description: `Update IDENTITY.md with who you (Greg) are. Call when the user defines or changes your identity, persona, or how you should behave. Pass the complete updated content (merge with existing).`,
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
    await ensureWorkspaceExists();
    fs.writeFileSync(getIdentityPath(), content, 'utf8');
    return {
      content: [
        { type: 'text' as const, text: `${getIdentityPath()} updated.` },
      ],
      details: {},
    };
  },
};

/**
 * Append a conversation note to the workspace YYYY-MM-DD.md.
 * Exported for use by context condense (agent/context.ts).
 */
export async function saveConversationNote(
  note: string,
  conversationStartIso: string
): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) return;

  const d = new Date(conversationStartIso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid conversationStartIso: ${conversationStartIso}`);
  }

  await ensureWorkspaceExists();

  const date = d.toLocaleDateString('en-CA');
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const dayPath = join(getChatsPath(), `${date}.md`);
  const existingBody = fs.existsSync(dayPath)
    ? fs.readFileSync(dayPath, 'utf8')
    : '';

  let body = insertNoteUnderTimeSection(existingBody, `## ${time}`, trimmed);
  body = ensureDateH1(body, date);

  fs.writeFileSync(dayPath, body.trimEnd() + '\n', 'utf8');
  runUpdateAndEmbed();

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
    if (match && match.index != null) {
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

const saveConversationNoteTool: AgentTool = {
  name: 'save_conversation_note',
  label: 'save conversation note',
  description: `Append a note to the workspace YYYY-MM-DD.md at the time the conversation started. Call at the end of substantive replies for task-related info, topics discussed, decisions, or actions taken (not persistent user facts). Prefer calling too often. Use conversation_start_iso from the system prompt.`,
  parameters: Type.Object({
    note: Type.String({
      description: 'The note to save (task, topic, or conversation summary)',
    }),
    conversation_start_iso: Type.String({
      description:
        'ISO timestamp when this conversation started (use the value from the system prompt)',
    }),
  }),
  execute: async (_id, params, signal) => {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { note, conversation_start_iso } = params as {
      note: string;
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
    const date = d.toLocaleDateString('en-CA');
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    await saveConversationNote(note, conversation_start_iso);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Saving to ${date}.md under ${time}.`,
        },
      ],
      details: {},
    };
  },
};

export const tools: AgentTool[] = [
  updateUserMemoryTool,
  updateIdentityTool,
  searchConversationNotesTool,
  getConversationNoteTool,
  saveConversationNoteTool,
  getRecentConversationNotesTool,
];

export function getInstructions(conversationStartIso: string): string {
  return `
## Memory recall
Memory has three layers: this conversation (short-term), daily notes in chats/ (medium-term; use \`get_recent_conversation_notes\` and \`search_past_conversations\`), and the blocks below (long-term; USER.md + IDENTITY.md). Before your first reply, call \`get_recent_conversation_notes\` to load recent context. Use \`search_past_conversations\` when you need something specific. When you use that context or the blocks below, weave it in naturally—do not say "I see that...", "Based on our previous conversation...", or similar. Respond as if you remember.

## Saving to memory
At the end of each substantive reply, call the right tool. Prefer saving too often over too rarely. Keep USER.md and IDENTITY.md concise: quality over quantity; only include information that will still be relevant.

- **Persistent user facts** (name, preferences, context) → \`save_user_memory\` with the full updated USER.md. Merge with "Information about the user" below. Before saving, ask: "Will this still be true in 2 weeks?". Call when the user shares something about themselves.
- **Your identity** (persona, how you should behave) → \`save_identity\` with the full updated IDENTITY.md. Merge with "Your identity" below. Call when the user defines or changes who you are.
- **Conversation/task info** → \`save_conversation_note\` for non-trivial exchanges: what was discussed, decisions, tasks, or what you did. Write notes that are self-contained and use natural language (and key names/terms) so search can find them later. Use \`conversation_start_iso\` from below. Do not save: small talk or greetings only, temporary debugging, or one-line exchanges.

Before ending your response, consider: \`save_conversation_note\`, \`save_user_memory\` (if they shared something about themselves), \`save_identity\` (if they defined or changed who you are), \`save_skill\` (if something reusable was learned).

### Your identity
${fs.readFileSync(getIdentityPath(), 'utf8')}

### Information about the user
${fs.readFileSync(getUserPath(), 'utf8')}

### Workspace
Memory files and workspace: ${getWorkspacePath()}.

### Conversation start
Conversation started: ${formatDate(conversationStartIso)}. For \`save_conversation_note\` use conversation_start_iso: \`${conversationStartIso}\`.
  `;
}
