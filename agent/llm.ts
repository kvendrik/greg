import ollama from 'ollama';
import type { Message } from 'ollama';
import { spawn } from 'child_process';
import { create } from './tools/browser';
import { runTerminalCommandTool } from './tools/terminal';
import { text, isCancel, log } from '@clack/prompts';
import fs from 'node:fs';

const browser = await create();
const tools = [runTerminalCommandTool, ...browser.tools];

export async function start() {
  const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
  proc.unref();
  return {
    kill: () => {
      proc.kill();
      browser.state.browser?.close();
    },
    thread: await thread(),
  };
}

async function thread() {
  const profile = await getUserProfile();

  const INSTRUCTIONS = `
# Instructions

## About you
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Your goal is to answer my questions based on the tools you have access to. 
Always aim to answer the original question, don't make up information.
When you have the option always lean towards solving problems yourself instead of giving instructions.
You keep answers short and conversational. No markdown.

## Tools
- Run terminal commands through the 'run_terminal_command' tool
- Open a web page through the 'open_web_page' tool. Start by using Google or DuckDuckGo to find the right URL when not provided with a direct URL.
- Click on a specific element on the web page through the 'click_on_web_page_element' tool

## Good to know
- Today's date is ${new Date().toISOString().split('T')[0]}.
- The time is ${new Date().toISOString().split('T')[1]}. 
- Code that you are currently running lives in this path: ${process.cwd()}

## About the user
${profile}
`;

  let thread: Message[] = [
    {
      role: 'system',
      content: INSTRUCTIONS,
    },
  ];

  return {
    prompt: async (
      content: string,
      {
        onContent,
        onThinking,
        onDone,
      }: {
        onContent: (chunk: string) => void;
        onThinking: (chunk: string) => void;
        onDone: () => void;
      }
    ) => {
      thread.push({ role: 'user', content });
      await prompt(content, {
        onContent,
        onThinking,
        onDone: (history) => {
          thread = history;
          onDone();
        },
        history: thread,
      });
    },
  };
}

async function prompt(
  content: string,
  {
    onContent,
    onThinking,
    onDone,
    history,
  }: {
    onThinking: (chunk: string) => void;
    onContent: (chunk: string) => void;
    onDone: (newHistory: Message[]) => void;
    history: Message[];
  }
) {
  const messages: Message[] = [...history, { role: 'user', content: content }];

  while (true) {
    const stream = await ollama.chat({
      model: 'gpt-oss:latest',
      messages,
      tools: [
        ...tools.map((tool) => tool.spec),
        // {
        //   type: 'function',
        //   function: {
        //     name: 'search_memory',
        //     description: 'Search our long term memory for context',
        //     parameters: {
        //       type: 'object',
        //       required: ['query'],
        //       properties: {
        //         query: {
        //           type: 'string',
        //           description: 'The query to search memory for',
        //         },
        //       },
        //     },
        //   },
        // },
        // {
        //   type: 'function',
        //   function: {
        //     name: 'get_memory_entry',
        //     description: 'get a single memory entry by docid (#abc123)',
        //     parameters: {
        //       type: 'object',
        //       required: ['docid'],
        //       properties: {
        //         docid: {
        //           type: 'string',
        //           description: 'ID of the memory entry',
        //         },
        //       },
        //     },
        //   },
        // },
      ],
      stream: true,
      think: true,
    });

    let thinking = '';
    let content = '';

    const toolCalls: any[] = [];
    let isThinking = true;

    for await (const chunk of stream) {
      if (chunk.message.thinking) {
        thinking += chunk.message.thinking;
        onThinking(chunk.message.thinking);
      }

      if (chunk.message.content) {
        if (isThinking) {
          isThinking = false;
        }
        content += chunk.message.content;
        onContent(chunk.message.content);
      }

      if (chunk.message.tool_calls?.length) {
        toolCalls.push(...chunk.message.tool_calls);
        //console.log(chunk.message.tool_calls);
        const call = chunk.message.tool_calls[0];
        onThinking(
          `[${call.function.name}(${JSON.stringify(call.function.arguments)})] `
        );
      }
    }

    if (thinking || content || toolCalls.length) {
      messages.push({
        role: 'assistant',
        thinking,
        content,
        tool_calls: toolCalls,
      });
    }

    if (!toolCalls.length) {
      break;
    }

    for (const call of toolCalls) {
      const tool = tools.find(
        (tool) => tool.spec.function.name === call.function.name
      );

      if (!tool) {
        messages.push({
          role: 'tool',
          tool_name: call.function.name,
          content: `Unknown tool: ${call.function.name}`,
        });
        continue;
      }

      const result = await tool.handler(call.function.arguments);

      messages.push({
        role: 'tool',
        tool_name: call.function.name,
        content: result.content,
      });
    }
  }

  onDone(messages);
}

async function getUserProfile() {
  const profile = fs.existsSync('memory/.data/profile.md');

  if (profile) {
    return fs.readFileSync('memory/.data/profile.md', 'utf8');
  }

  let messages: Message[] = [
    {
      role: 'system',
      content:
        'You are an excited onboarding assistant named Nova that helps the user set up their profile. Your job is to figure out the user’s name, age, city, and country. They may also share other things about themselves. Start by greeting the user and telling them what you will be doing. Keep messages short and conversational. Do not use markdown or other formatting. Do use emojis.',
    },
  ];

  let gaveValidAnswer = false;

  while (!gaveValidAnswer) {
    const allInformationProvidedResponse = await ollama.chat({
      model: 'gpt-oss:latest',
      messages: [
        ...messages,
        {
          role: 'system',
          content:
            'Has the user provided their name, age, city, and country? Respond with a boolean.',
        },
      ],
      format: {
        type: 'object',
        properties: {
          allInformationProvided: { type: 'boolean' },
        },
        required: ['allInformationProvided'],
      },
      think: true,
      stream: false,
    });

    const isFinished = JSON.parse(
      allInformationProvidedResponse.message.content
    ).allInformationProvided;

    if (isFinished) {
      const summaryMessage = await ollama.chat({
        model: 'gpt-oss:latest',
        messages: [
          ...messages,
          {
            role: 'system',
            content: "Summarize the user's profile.",
          },
        ],
        format: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
          },
          required: ['summary'],
        },
        think: false,
        stream: false,
      });
      const summary = JSON.parse(summaryMessage.message.content).summary;
      fs.writeFileSync('memory/.data/profile.md', summary);
      log.success(`Perfect! Saved profile to memory/.data/profile.md`);
      return summary;
      break;
    }

    const assistantMessage = await ollama.chat({
      model: 'gpt-oss:latest',
      messages,
      think: false,
      stream: false,
    });

    const userAnswer = await text({
      message: assistantMessage.message.content,
      placeholder: '...',
    });

    if (isCancel(userAnswer)) {
      process.exit(0);
    }

    messages.push({ role: 'user', content: userAnswer });
  }
}
