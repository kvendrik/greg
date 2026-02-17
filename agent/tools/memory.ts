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
        role: 'system',
        content: `
Extract ONLY persistent facts about the user that will be relevant across many future conversations.

## SAVE (durable facts)
- Identity: name, location, timezone, language
- Preferences: communication style, tone, formats
- Context: job, company, projects, expertise
- Constraints: allergies, accessibility needs, budgets
- Relationships: family, team members mentioned repeatedly

## DO NOT SAVE (ephemeral)
- Current task or query ("looking for jazz concerts")
- Temporal requests ("wants X today/tomorrow")
- One-time instructions ("create a skill when next asked")
- Pending actions or todos
- Anything with "today", "now", "this", "next"

## Test
Ask: "Will this matter in a conversation 2 weeks from now?"
- "User lives in Amsterdam" → YES, save
- "User’s favorite color is blue" → YES, save
- "User wants jazz concerts today" → NO, skip
- "Wants more information about John's professional background"  → NO, skip

Return only facts that pass this test.
`,
      },
      {
        role: 'user',
        content: `
## Conversation to analyze
${messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')}

## Existing facts
${currentMemory ?? 'No existing facts found'}

Extract and return the complete updated fact list.`,
      },
    ],
    think: true,
    stream: false,
  });

  fs.writeFileSync(memoryPath, memoryAgent.message.content);
  execSync(`bun run qmd embed --collection ${COLLECTION_NAME}`);
}
