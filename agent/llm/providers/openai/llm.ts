import type { RunParams, RunCallbacks } from '../types';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ChatCompletionStreamingRunner } from 'openai/lib/ChatCompletionStreamingRunner.js';
import type { RunnableToolFunctionWithParse } from 'openai/lib/RunnableFunction.js';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { getErrorType } from './errors';
import { neutralToOpenAI, openaiToNeutral } from './convert';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey)
  throw new Error('OPENAI_API_KEY is required when using the OpenAI provider.');
const openai = new OpenAI({ apiKey });

type ToolShape = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  parse: (content: unknown) => object;
  run: (args: object) => Promise<string | unknown>;
};

function betaToolsToOpenAI(
  tools: BetaRunnableTool[]
): RunnableToolFunctionWithParse<object>[] {
  return tools.map((tool) => {
    const toolShape = tool as unknown as ToolShape;
    return {
      type: 'function' as const,
      function: {
        name: toolShape.name,
        description: toolShape.description ?? '',
        parameters: (toolShape.input_schema ?? { type: 'object' }) as {
          type: 'object';
          properties?: Record<string, unknown>;
          required?: string[];
        },
        parse: (input: string) =>
          toolShape.parse
            ? toolShape.parse(JSON.parse(input))
            : (JSON.parse(input) as object),
        function: async (args: object) => {
          const result = await toolShape.run(args);
          return typeof result === 'string' ? result : JSON.stringify(result);
        },
      },
    };
  });
}

export async function run(
  params: RunParams,
  callbacks: RunCallbacks
): Promise<void> {
  const { system, messages, model, tools, signal } = params;

  const nativeMessages = neutralToOpenAI(messages);

  const apiMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...nativeMessages.filter((msg) => msg.role !== 'system'),
  ];

  const openaiTools = betaToolsToOpenAI(tools);

  try {
    const runner = ChatCompletionStreamingRunner.runTools(
      openai as never,
      {
        model,
        messages: apiMessages,
        tools: openaiTools,
        stream: true,
        max_completion_tokens: 8192,
        reasoning_effort: 'medium',
      },
      { signal, maxChatCompletions: 25 }
    );

    runner.on('content', (delta: string) => callbacks.onContent(delta));
    runner.on('functionToolCall', (call) => {
      const argsStr =
        typeof call.arguments === 'string'
          ? call.arguments
          : JSON.stringify(call.arguments ?? {});
      callbacks.onToolCall(call.name, argsStr);
    });

    for await (const _chunk of runner) {
      // Consume stream; events are forwarded via listeners
    }

    callbacks.onDone(openaiToNeutral(runner.messages));
  } catch (err) {
    const errorType = getErrorType(err) ?? 'server_error';
    const handled = await Promise.resolve(callbacks.onError(errorType));
    if (handled !== true) {
      throw err;
    }
  }
}
