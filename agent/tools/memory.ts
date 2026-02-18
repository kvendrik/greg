import { execSync } from 'child_process';
import fs from 'node:fs';
import type { Tool } from './types';
import ollama, { type Message } from 'ollama';
import { homedir } from 'os';
import { join } from 'path';

const memoryDir = join(homedir(), '.pa-agent');
const memoryPath = join(memoryDir, 'MEMORY.md');
const COLLECTION_NAME = 'pa-agent-memory';

/** Ensure memory dir, MEMORY.md, and qmd collection exist (same as legacy postprocess). */
function ensureCollectionExists() {
  if (!fs.existsSync(memoryPath)) {
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(memoryPath, '');
    execSync(
      `[ -z "$(bun run qmd collection list | grep ${COLLECTION_NAME})" ] && bun run qmd collection add ${memoryDir} --name ${COLLECTION_NAME} && bun run qmd context add qmd://${COLLECTION_NAME} "PA Agent Long Term Memory"`
    );
  }
}

const searchMemoryTool: Tool<{ query: string }> = {
  spec: {
    name: 'search_long_term_memory',
    description:
      'Search long term memory only when the user explicitly asks about the past, preferences, or stored facts. Do not use for greetings, small talk, or general questions.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'The query to search for',
        },
      },
    },
  },
  handler: async ({ query }) => {
    return {
      content: execSync(
        `bun run qmd vsearch "${query}" --collection ${COLLECTION_NAME}`
      ).toString(),
    };
  },
};

const getMemoryEntryTool: Tool<{ docid: string }> = {
  spec: {
    name: 'get_memory_entry',
    description: 'Get a single memory entry by docid',
    input_schema: {
      type: 'object',
      required: ['docid'],
      properties: {
        docid: {
          type: 'string',
          description: 'The docid of the memory entry to get',
        },
      },
    },
  },
  handler: async ({ docid }) => {
    const result = execSync(
      `bun run qmd get "${docid}" --collection ${COLLECTION_NAME}`
    );
    return { content: result.toString() };
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
    ensureCollectionExists();
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(memoryPath, content, 'utf8');
    execSync(`bun run qmd embed --collection ${COLLECTION_NAME}`);
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

    ensureCollectionExists();

    const d = new Date(conversation_start_iso);
    const { date, time } = {
      date: d.toLocaleDateString('en-CA'),
      time: d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const dayPath = join(memoryDir, `${date}.md`);
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    let body = fs.existsSync(dayPath) ? fs.readFileSync(dayPath, 'utf8') : '';
    const heading = `## ${time}`;
    // If this conversation time already has a section, append to it; otherwise add new section.
    const re = new RegExp(
      `(?:^|\\n)(${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:\\s|$)`,
      'm'
    );
    const match = body.match(re);
    if (match && match.index != null) {
      const afterHeading =
        match.index + (body[match.index] === '\n' ? 1 : 0) + heading.length;
      body =
        body.slice(0, afterHeading) +
        '\n\n' +
        trimmed +
        '\n\n' +
        body.slice(afterHeading);
    } else {
      body = (body ? body + '\n\n' : '') + heading + '\n\n' + trimmed + '\n\n';
    }
    fs.writeFileSync(dayPath, body, 'utf8');
    execSync(`bun run qmd embed --collection ${COLLECTION_NAME}`);
    return { content: `Saved to ${date}.md under ${time}.` };
  },
};

export const tools = [
  searchMemoryTool,
  getMemoryEntryTool,
  updateUserMemoryTool,
  saveConversationNoteTool,
];

export function getPersistedMemory() {
  return fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : null;
}
