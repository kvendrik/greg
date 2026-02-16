import { execSync } from 'child_process';
import fs from 'node:fs';
import type { Tool } from './types';
import ollama, { type Message } from 'ollama';
import { homedir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

const memoryDir = join(homedir(), '.pa-agent');
const memoryPath = join(memoryDir, 'MEMORY.md');
const COLLECTION_NAME = 'pa-agent-memory';

const searchMemoryTool: Tool<{ query: string }> = {
  spec: {
    type: 'function',
    function: {
      name: 'search_long_term_memory',
      description: 'Search through the long term memory for context',
      parameters: {
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
    type: 'function',
    function: {
      name: 'get_memory_entry',
      description: 'Get a single memory entry by docid',
      parameters: {
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
  },
  handler: async ({ docid }) => {
    const result = execSync(
      `bun run qmd get "${docid}" --collection ${COLLECTION_NAME}`
    );
    return { content: result.toString() };
  },
};

export const tools = [searchMemoryTool, getMemoryEntryTool];

export function getPersistedMemory() {
  return fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : null;
}

export async function postprocess(messages: Message[]) {
  if (!fs.existsSync(memoryPath)) {
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(memoryPath, '');
    execSync(
      `[ -z "$(bun run qmd collection list | grep ${COLLECTION_NAME})" ] && bun run qmd collection add ${memoryDir} --name ${COLLECTION_NAME} && bun run qmd context add qmd://${COLLECTION_NAME} "PA Agent Long Term Memory"`
    );
  }

  const currentMemory = fs.readFileSync(memoryPath, 'utf8');
  const memoryAgent = await ollama.chat({
    model: 'gpt-oss:latest',
    messages: [
      ...messages,
      {
        role: 'user',
        content: `
Your job is to extract persistent user facts from the conversation and update the existing facts. 
Do not delete facts unless the user has specifically asked you to do so.
Return ONLY the updated facts as markdown.

## Existing facts
${currentMemory ?? 'No existing facts found'}
`,
      },
    ],
    think: true,
    stream: false,
  });

  fs.writeFileSync(memoryPath, memoryAgent.message.content);
  execSync(`bun run qmd embed --collection ${COLLECTION_NAME}`);
}
