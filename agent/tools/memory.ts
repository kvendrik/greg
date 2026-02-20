import { execSync } from 'child_process';
import fs from 'node:fs';
import type { Tool } from './types';
import { homedir } from 'os';
import { join } from 'path';

const workspacePath = join(homedir(), '.pa-agent');
const chatsPath = join(workspacePath, 'chats');
const memoryPath = join(workspacePath, 'MEMORY.md');
const COLLECTION_NAME = 'pa-agent-chats';

function ensureWorkspaceExists() {
  if (!fs.existsSync(workspacePath))
    fs.mkdirSync(workspacePath, { recursive: true });

  if (!fs.existsSync(chatsPath)) {
    fs.mkdirSync(chatsPath, { recursive: true });
  }

  try {
    execSync(
      `bun run qmd collection list | grep -q pa-agent-chats || (bun run qmd collection add ${chatsPath} --name ${COLLECTION_NAME} && bun run qmd context add qmd://${COLLECTION_NAME} "PA Agent Long Term Memory")`,
      { shell: '/bin/bash', stdio: 'pipe' }
    );
  } catch (e) {
    console.error('stdout:', e.stdout?.toString());
    console.error('stderr:', e.stderr?.toString());
  }
}

const getRecentConversationNotesTool: Tool<{ max_notes?: number }> = {
  spec: {
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
          default: 5,
        },
      },
    },
  },
  handler: async ({ max_notes = 5 }) => {
    ensureWorkspaceExists();
    const limit = Math.max(1, Math.min(50, max_notes));

    const files = fs.readdirSync(chatsPath);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      return { content: 'No recent conversation notes.' };
    }

    const withMtime = mdFiles.map((f) => ({
      name: f,
      mtime: fs.statSync(join(chatsPath, f)).mtimeMs,
    }));

    withMtime.sort((a, b) => b.mtime - a.mtime);

    const dayFiles = withMtime.slice(0, limit).map((e) => e.name);
    const paths = dayFiles
      .map((f) => `${f.replace(/\.md$/, '')}.md`)
      .join(', ');

    const result = execSync(
      `bun run qmd multi-get "${paths}" --collection ${COLLECTION_NAME} --json`
    );

    return { content: result.toString() };
  },
};

const searchConversationNotesTool: Tool<{ query: string }> = {
  spec: {
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
  },
  handler: async ({ query }) => {
    ensureWorkspaceExists();
    return {
      content: execSync(
        `bun run qmd vsearch "${query}" --collection ${COLLECTION_NAME} --json`
      ).toString(),
    };
  },
};

const getConversationNoteTool: Tool<{
  docid: string;
  start_line: string;
  max_lines: string;
}> = {
  spec: {
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
  },
  handler: async ({ docid, start_line, max_lines }) => {
    ensureWorkspaceExists();
    try {
      const result = execSync(
        `bun run qmd get \\${docid}${start_line ? `:${start_line}` : ''}${max_lines ? ` -l ${max_lines}` : ''} --collection ${COLLECTION_NAME} --json`
      );
      return { content: result.toString() };
    } catch (err) {
      return { content: 'Error getting conversation note: ' + err.message };
    }
  },
};

const updateUserMemoryTool: Tool<{ content: string }> = {
  spec: {
    name: 'update_user_memory',
    description:
      'Write or update ~/.pa-agent/MEMORY.md with persistent facts about the user. Pass the complete updated content (merge with existing so information stays accurate).',
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
  },
  handler: async ({ content }) => {
    ensureWorkspaceExists();
    fs.writeFileSync(memoryPath, content, 'utf8');
    return { content: 'MEMORY.md updated.' };
  },
};

const saveConversationNoteTool: Tool<{
  note: string;
  conversation_start_iso: string;
}> = {
  spec: {
    name: 'save_conversation_note',
    description:
      'Append a note to ~/.pa-agent/YYYY-MM-DD.md under the time the conversation started. Use for task-related info and other things discussed (not persistent user facts).',
    input_schema: {
      type: 'object',
      required: ['note', 'conversation_start_iso'],
      properties: {
        note: {
          type: 'string',
          description:
            'The note to save (task, topic, or conversation summary)',
        },
        conversation_start_iso: {
          type: 'string',
          description:
            'ISO timestamp when this conversation started (use the value from the system prompt)',
        },
      },
    },
  },
  handler: async ({ note, conversation_start_iso }) => {
    const trimmed = note.trim();
    if (!trimmed) return { content: 'No content to save.' };

    ensureWorkspaceExists();

    const d = new Date(conversation_start_iso);
    const date = d.toLocaleDateString('en-CA');
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const dayPath = join(chatsPath, `${date}.md`);
    const existingBody = fs.existsSync(dayPath)
      ? fs.readFileSync(dayPath, 'utf8')
      : '';

    let body = insertNoteUnderTimeSection(existingBody, `## ${time}`, trimmed);
    body = ensureDateH1(body, date);

    fs.writeFileSync(dayPath, body.trimEnd() + '\n', 'utf8');
    execSync(
      `bun run qmd update --collection ${COLLECTION_NAME} && bun run qmd embed --collection ${COLLECTION_NAME}`
    );

    return { content: `Saved to ${date}.md under ${time}.` };

    /** Insert note under existing ## time section, or append a new ## time section. */
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
          match.index +
          (body[match.index] === '\n' ? 1 : 0) +
          timeHeading.length;
        return (
          body.slice(0, insertAt) +
          '\n\n' +
          note +
          '\n\n' +
          body.slice(insertAt)
        );
      }
      const prefix = body ? body + '\n\n' : '';
      return prefix + timeHeading + '\n\n' + note + '\n\n';
    }

    /** Ensure body starts with "# YYYY-MM-DD". */
    function ensureDateH1(body: string, date: string): string {
      const h1 = `# ${date}`;
      if (body.startsWith(h1)) return body;
      const withoutH1 = body.replace(/^\s*# .*$/m, '').trimStart();
      return h1 + '\n\n' + (withoutH1 || '');
    }
  },
};

export const tools = [
  updateUserMemoryTool,
  searchConversationNotesTool,
  getConversationNoteTool,
  saveConversationNoteTool,
  getRecentConversationNotesTool,
];

export function getSystemInstructions() {
  return `
Before replying for the first time do a quick search through recent conversations using \`get_recent_conversation_notes\` to gather possibly relevant information.

When you use that context (or "Information about the user" below), weave it in naturally. Do not say things like "I see that...", "I see we've...", "I noticed that...", or "Based on our previous conversation...". Just respond as if you remember—reference recent topics or the user's situation without acknowledging that you looked anything up.

## Saving to memory
When something is worth remembering, after replying call the right tool:

1. **Persistent user facts** (name, preferences, context) → \`update_user_memory\` with the full updated content for ~/.pa-agent/MEMORY.md. Merge with "Information about the user" below so it stays accurate. Before saving something, ask yourself: "will this be true in 2 weeks?".
2. **Conversation/task info** (what was discussed, decisions—not durable user facts) → \`save_conversation_note\` to append to ~/.pa-agent/YYYY-MM-DD.md. Use the \`conversation_start_iso\` value from below.

## Information about the user
${fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : 'Nothing known yet'}

Conversation started at: ${new Date().toISOString()}
  `;
}
