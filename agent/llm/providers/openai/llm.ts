import type { RunParams, RunCallbacks } from '../types';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ChatCompletionStreamingRunner } from 'openai/lib/ChatCompletionStreamingRunner.js';
import type { RunnableToolFunctionWithParse } from 'openai/lib/RunnableFunction.js';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { getErrorType } from './errors';
import { neutralToOpenAI, openaiToNeutral } from './convert';
import config from '../../../../.config';

const openai = new OpenAI({ apiKey: config.providers.openai.key });

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
  const { system, messages, model, thinking, tools, signal } = params;

  const nativeMessages = neutralToOpenAI(messages);
  const reasoningEffort =
    thinking === null
      ? undefined
      : thinking === 'max'
        ? ('xhigh' as const)
        : thinking;

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
        ...(reasoningEffort != null && { reasoning_effort: reasoningEffort }),
      },
      { signal, maxChatCompletions: 25 }
    );

    runner.on('content', (delta: string) => callbacks.onContent(delta));
    runner.on('functionToolCall', (call) => {
      const args =
        typeof call.arguments === 'object' && call.arguments != null
          ? (call.arguments as Record<string, unknown>)
          : (JSON.parse(
              typeof call.arguments === 'string'
                ? call.arguments
                : JSON.stringify(call.arguments ?? {})
            ) as Record<string, unknown>);
      callbacks.onToolCall(call.name, args);
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
