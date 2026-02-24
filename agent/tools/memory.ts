import { execSync } from 'child_process';
import fs from 'node:fs';
import { join } from 'path';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { formatDate, getWorkspacePath } from '../utilities';

const COLLECTION_NAME = 'agent-chats';

function getChatsPath(): string {
  return join(getWorkspacePath(), 'chats');
}

function getMemoryPath(): string {
  return join(getWorkspacePath(), 'MEMORY.md');
}

function ensureWorkspaceExists() {
  const workspacePath = getWorkspacePath();
  const chatsPath = getChatsPath();

  if (!fs.existsSync(workspacePath))
    fs.mkdirSync(workspacePath, { recursive: true });

  if (!fs.existsSync(chatsPath)) {
    fs.mkdirSync(chatsPath, { recursive: true });
  }

  try {
    execSync(
      `bun run qmd collection list | grep -q ${COLLECTION_NAME} || (bun run qmd collection add ${chatsPath} --name ${COLLECTION_NAME} && bun run qmd context add qmd://${COLLECTION_NAME} "PA Agent Long Term Memory")`,
      { shell: '/bin/bash', stdio: 'pipe' }
    );
  } catch (e) {
    console.error('stdout:', e.stdout?.toString());
    console.error('stderr:', e.stderr?.toString());
  }
}

const getRecentConversationNotesRunnable: BetaRunnableTool = {
  name: 'get_recent_conversation_notes',
  description: 'Get the most recent conversation notes.',
  input_schema: {
    type: 'object',
    required: [],
    properties: {
      max_notes: {
        type: 'number',
        description:
          'Max number of recent days to fetch notes for (each day file can contain multiple notes)',
        default: 3,
      },
    },
  },
  parse: (c) => c as { max_notes?: number },
  run: async ({ max_notes = 3 }) => {
    ensureWorkspaceExists();
    const limit = Math.max(1, Math.min(50, max_notes));

    const files = fs.readdirSync(getChatsPath());
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      return 'No recent conversation notes.';
    }

    const withMtime = mdFiles.map((f) => ({
      name: f,
      mtime: fs.statSync(join(getChatsPath(), f)).mtimeMs,
    }));

    withMtime.sort((a, b) => b.mtime - a.mtime);

    const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
    const paths = dayFiles.join(', ');

    const result = execSync(
      `bun run qmd multi-get "${paths}" --collection ${COLLECTION_NAME} --json`
    );

    return result.toString();
  },
};

const searchConversationNotesRunnable: BetaRunnableTool = {
  name: 'search_past_conversations',
  description: 'Search through past conversations.',
  input_schema: {
    type: 'object',
    required: ['search_query'],
    properties: {
      search_query: {
        type: 'string',
        description: 'The query to search for',
      },
    },
  },
  parse: (c) => c as { search_query: string },
  run: async ({ search_query }) => {
    ensureWorkspaceExists();
    return execSync(
      `bun run qmd vsearch "${search_query}" --collection ${COLLECTION_NAME} --json`
    ).toString();
  },
};

const getConversationNoteRunnable: BetaRunnableTool = {
  name: 'get_past_conversation',
  description: 'Get a single conversation by docid',
  input_schema: {
    type: 'object',
    required: ['docid'],
    properties: {
      docid: {
        type: 'string',
        description:
          'The docid of the memory entry to get (Starts with a hash symbol. Example: #79462a)',
      },
      start_line: {
        type: 'number',
        description: 'Line number to start from (0 is the first line)',
      },
      max_lines: {
        type: 'number',
        description: 'Max number of lines to return',
      },
    },
  },
  parse: (c) => c as { docid: string; start_line?: string; max_lines?: string },
  run: async ({ docid, start_line, max_lines }) => {
    ensureWorkspaceExists();
    try {
      const result = execSync(
        `bun run qmd get \\${docid}${start_line ? `:${start_line}` : ''}${max_lines ? ` -l ${max_lines}` : ''} --collection ${COLLECTION_NAME} --json`
      );
      return result.toString();
    } catch (err: unknown) {
      return (
        'Error getting conversation note: ' +
        (err instanceof Error ? err.message : String(err))
      );
    }
  },
};

const updateUserMemoryRunnable: BetaRunnableTool = {
  name: 'save_user_memory',
  description: `Update ${getMemoryPath()} with persistent facts about the user. Call whenever the user shares something about themselves (name, preferences, context). Pass the complete updated content (merge with existing so information stays accurate).`,
  input_schema: {
    type: 'object',
    required: ['content'],
    properties: {
      content: {
        type: 'string',
        description:
          'The full content for MEMORY.md (include all existing facts plus updates)',
      },
    },
  },
  parse: (c) => c as { content: string },
  run: async ({ content }) => {
    ensureWorkspaceExists();
    fs.writeFileSync(getMemoryPath(), content, 'utf8');
    return `${getMemoryPath()} updated.`;
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

  ensureWorkspaceExists();

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
  execSync(`bun run agent:memory:index`);

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

const saveConversationNoteRunnable: BetaRunnableTool = {
  name: 'save_conversation_note',
  description: `Append a note to the workspace YYYY-MM-DD.md (under ${getWorkspacePath()}/chats) at the time the conversation started. Call at the end of substantive replies for task-related info, topics discussed, decisions, or actions taken (not persistent user facts). Prefer calling too often. Use conversation_start_iso from the system prompt.`,
  input_schema: {
    type: 'object',
    required: ['note', 'conversation_start_iso'],
    properties: {
      note: {
        type: 'string',
        description: 'The note to save (task, topic, or conversation summary)',
      },
      conversation_start_iso: {
        type: 'string',
        description:
          'ISO timestamp when this conversation started (use the value from the system prompt)',
      },
    },
  },
  parse: (c) => c as { note: string; conversation_start_iso: string },
  run: async ({ note, conversation_start_iso }) => {
    const trimmed = note.trim();
    if (!trimmed) return 'No content to save.';

    const d = new Date(conversation_start_iso);
    const date = d.toLocaleDateString('en-CA');
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    await saveConversationNote(note, conversation_start_iso);
    return `Saved to ${date}.md under ${time}.`;
  },
};

export const tools: BetaRunnableTool[] = [
  updateUserMemoryRunnable,
  searchConversationNotesRunnable,
  getConversationNoteRunnable,
  saveConversationNoteRunnable,
  getRecentConversationNotesRunnable,
];

export function getInstructions(conversationStartIso: string): string {
  return `
## Memory

Before replying for the first time do a quick search through recent conversations using \`get_recent_conversation_notes\` to gather possibly relevant information.

When you use that context (or "Information about the user" below), weave it in naturally. Do not say things like "I see that...", "I see we've...", "I noticed that...", or "Based on our previous conversation...". Just respond as if you remember—reference recent topics or the user's situation without acknowledging that you looked anything up.

## Saving to memory (do this often)
At the end of each substantive reply, call the appropriate memory tool. Prefer saving too often rather than too rarely.

1. **Persistent user facts** (name, preferences, context) → \`update_user_memory\` with the full updated content for the workspace MEMORY.md. Merge with "Information about the user" below so it stays accurate. Before saving something, ask yourself: "will this be true in 2 weeks?". Call whenever the user shares something about themselves.
2. **Conversation/task info** → \`save_conversation_note\` for almost every non-trivial exchange: what was discussed, decisions made, tasks or topics, things you did for them. Append to the workspace YYYY-MM-DD.md. Always use the \`conversation_start_iso\` value from below (it is provided in this message).

Call \`save_conversation_note\` when: the user shared a task or decision, you completed an action, you discussed a topic they might refer back to, or the exchange was more than a quick greeting. When in doubt, save a short note.
Before ending your response: consider calling save_conversation_note (for what was discussed), update_user_memory (if they shared something about themselves), and/or save_skill (if something reusable was learned or established).

### Information about the user
${fs.existsSync(getMemoryPath()) ? fs.readFileSync(getMemoryPath(), 'utf8') : 'Nothing known yet'}

### Files location
Your workspace with all memory files etc is at: ${getWorkspacePath()}.

### Conversation start time
Conversation started: ${formatDate(conversationStartIso)}. For \`save_conversation_note\` use conversation_start_iso: \`${conversationStartIso}\`.
  `;
}
