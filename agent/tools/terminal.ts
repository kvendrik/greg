import type { Tool } from './types';
import { execSync } from 'child_process';
import ollama from 'ollama';

export const runTerminalCommandTool: Tool<{ command: string }> = {
  spec: {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: 'Run a command in the terminal',
      parameters: {
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
  },
  handler: async ({ command }) => {
    const result = await ollama.chat({
      model: 'gpt-oss:latest',
      messages: [
        {
          role: 'user',
          content: `Is \`${command}\` a terminal command that might cause any harm to my computer? Respond with a boolean.`,
        },
      ],
      format: {
        type: 'object',
        properties: {
          command_is_safe: { type: 'boolean' },
        },
        required: ['command_is_safe'],
      },
      think: true,
      stream: false,
    });

    const isSafe = result.message.content;

    if (isSafe) {
      try {
        const result = execSync(command).toString();
        return { content: result };
      } catch (error) {
        return { content: error };
      }
    }

    return {
      content: `Not allowed to run ${command}`,
    };
  },
};
