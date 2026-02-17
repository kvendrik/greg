import ollama from 'ollama';
import type { AbortableAsyncIterator, ChatResponse, Message } from 'ollama';
import { spawn } from 'child_process';
import { create } from './tools/browser';
import { runTerminalCommandTool } from './tools/terminal';
import * as memory from './tools/memory';

const browser = await create();
const tools = [runTerminalCommandTool, ...browser.tools, ...memory.tools];

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
  const INSTRUCTIONS = `# Instructions

## About you
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Your goal is to answer my questions based on the tools you have access to. 

## Rules
- Before taking any action, verify you have all required information. If missing critical context (location, dates, preferences, etc.), ASK the user first.
- You keep answers short and conversational. 
- No formatting.
- Do use emojis
- Don't make up information.
- When you have the option always lean towards solving problems yourself instead of giving instructions.

## Tools
- Run terminal commands through the 'run_terminal_command' tool
- Open a web page through the 'open_web_page' tool. Start by using Google or DuckDuckGo to find the right URL when not provided with a direct URL.
- Click on a specific element on the web page through the 'click_on_web_page_element' tool. 
- Use the 'get_web_page_elements' tool to get a list of IDs of interactive elements on the current web page.
- Use 'click_on_web_page_element' with the ID of the interactive element to click on.
- Search through the long term memory for context through the 'search_long_term_memory' tool
- Get a single memory entry by docid through the 'get_memory_entry' tool
- After each prompt we automatically update the long term memory with the new information. You don’t have to do this yourself.

DO NOT assume anything:
- Location (ask "Where are you looking for this?")
- Dates/times (ask "When?")
- Etc...

## Good to know
- Code that you are currently running lives in this path: ${process.cwd()}

## Information about the user
${memory.getPersistedMemory() ?? 'Nothing known yet'}`;

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
        onStart,
        onContent,
        onThinking,
        onDone,
      }: {
        onStart: (stream: AbortableAsyncIterator<ChatResponse>) => void;
        onContent: (chunk: string) => void;
        onThinking: (chunk: string) => void;
        onDone: () => void;
      }
    ) => {
      const finalContent = `Time is ${new Date().toISOString()}. User sent this prompt: "${content}"`;
      thread.push({ role: 'user', content: finalContent });
      await prompt(finalContent, {
        onStart,
        onContent,
        onThinking,
        onDone: async (history) => {
          thread = history;
          memory.postprocess([{ role: 'user', content: finalContent }]);
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
    onStart: (stream: AbortableAsyncIterator<ChatResponse>) => void;
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
      tools: tools.map((tool) => tool.spec),
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
