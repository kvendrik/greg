import type { Tool } from './types';
import { execSync } from 'child_process';

export const runTerminalCommandTool: Tool<{ command: string }> = {
  spec: {
    name: 'exec',
    description: 'Run a command in the terminal.',
    input_schema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          description: 'The command to run',
        },
      },
    },
  },
  handler: async ({ command }) => {
    try {
      return { content: execSync(command).toString() };
    } catch (error) {
      return { content: error.message };
    }
  },
};
