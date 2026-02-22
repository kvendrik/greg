import { tools, getInstructions } from './tools';
import type { ToolResultContent } from './tools/types';
import { prepareMessages, MODEL } from './context';
import { Anthropic } from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';

const MAX_TOKENS = 8192;

type ThreadHistory = {
  system: string;
  messages: MessageParam[];
  conversationStartIso: string;
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function start() {
  return {
    kill: () => {},
    thread: await thread(),
  };
}

async function thread() {
  const conversationStartIso = new Date().toISOString();
  const baseInstructions = `
You are a helpful personal assistant that runs on my personal computer and talks to me through a chat interface.
Answer with short and conversational answers. 
You have control over my computer through several tools.

${getInstructions(conversationStartIso)}

The code you’re running on is at: ${__dirname}
`;

  let messages: MessageParam[] = [];

  return {
    prompt: async (
      content: string,
      {
        signal,
        onContent,
        onThinking,
        onDone,
      }: {
        signal?: AbortSignal;
        onContent: (chunk: string) => void;
        onThinking: (chunk: string) => void;
        onDone: () => void;
      }
    ) => {
      const finalContent = `Time is ${new Date().toISOString()}. User sent this prompt: "${content}"`;
      await runPrompt(finalContent, {
        signal,
        history: {
          system: baseInstructions,
          messages,
          conversationStartIso,
        },
        onContent,
        onThinking,
        onDone: (newMessages) => {
          messages = newMessages;
          onDone();
        },
      });
    },
  };
}

function parseResponse(
  content: Array<{ type: string; [k: string]: unknown }> | undefined
) {
  const blocks = content ?? [];
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? String(b.text) : ''))
    .join('');
  const toolUse = blocks.filter(
    (b) => b.type === 'tool_use'
  ) as unknown as ToolUseBlock[];
  return { text, toolUse };
}

function buildAssistantBlocks(
  text: string,
  toolUse: ToolUseBlock[]
): MessageParam['content'] {
  const out: MessageParam['content'] = text ? [{ type: 'text', text }] : [];
  for (const b of toolUse) {
    (
      out as Array<{
        type: 'tool_use';
        id: string;
        name: string;
        input: unknown;
      }>
    ).push({
      type: 'tool_use',
      id: b.id,
      name: b.name,
      input: b.input ?? {},
    });
  }
  return out;
}

async function runToolCalls(toolUse: ToolUseBlock[]): Promise<
  Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: ToolResultContent;
  }>
> {
  const results = [];
  for (const block of toolUse) {
    const tool = tools.find((t) => t.spec.name === block.name);
    const content: ToolResultContent = tool
      ? (await tool.handler((block.input ?? {}) as any)).content
      : `Unknown tool: ${block.name}`;
    results.push({ type: 'tool_result', tool_use_id: block.id, content });
  }
  return results;
}

async function runPrompt(
  content: string,
  opts: {
    signal?: AbortSignal;
    history: ThreadHistory;
    onContent: (chunk: string) => void;
    onThinking: (chunk: string) => void;
    onDone: (messages: MessageParam[]) => void;
  }
) {
  const messages = await prepareMessages({
    system: opts.history.system,
    messages: opts.history.messages,
    newUserContent: content,
    tools: tools.map((t) => t.spec),
    conversationStartIso: opts.history.conversationStartIso,
  });

  while (true) {
    const stream = anthropic.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: opts.history.system,
        messages,
        tools: tools.map((t) => t.spec),
        tool_choice: { type: 'auto' },
        stream: true,
        thinking: { type: 'enabled', budget_tokens: 1024 },
      },
      { signal: opts.signal }
    );

    stream.on('text', opts.onContent);
    stream.on('thinking', opts.onThinking);
    stream.on(
      'contentBlock',
      (block: { type: string; name?: string; input?: unknown }) => {
        if (block.type === 'tool_use' && block.name != null) {
          opts.onThinking(
            `[${block.name}(${JSON.stringify(block.input ?? {})})] `
          );
        }
      }
    );

    const finalMessage = await stream.finalMessage();

    const { text, toolUse } = parseResponse(
      (finalMessage.content ?? []) as unknown as Array<{
        type: string;
        [k: string]: unknown;
      }>
    );

    messages.push({
      role: 'assistant',
      content: buildAssistantBlocks(text, toolUse),
    });

    if (toolUse.length === 0) break;

    const toolResults = await runToolCalls(toolUse);

    messages.push({ role: 'user', content: toolResults });
  }

  opts.onDone(messages);
}
