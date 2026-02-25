import type { RunParams, RunCallbacks } from '../types';
import { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import { getErrorType } from './errors';
import { neutralToAnthropic, anthropicToNeutral } from './convert';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function run(params: RunParams, callbacks: RunCallbacks): Promise<void> {
  const { system, messages, model, tools, signal } = params;

  const nativeMessages = neutralToAnthropic(messages);

  const runner = anthropic.beta.messages.toolRunner(
    {
      model,
      max_tokens: 8192,
      system,
      messages: nativeMessages as BetaMessageParam[],
      tools,
      tool_choice: { type: 'auto' },
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      max_iterations: 25,
    },
    { signal: signal } as { headers?: Record<string, string> }
  );

  try {
    for await (const value of runner) {
      if (
        value &&
        typeof value === 'object' &&
        'on' in value &&
        typeof (value as { on: unknown }).on === 'function'
      ) {
        const stream = value as {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
        };
        stream.on('error', (err: unknown) =>
          callbacks.onError(getErrorType(err) ?? 'server_error')
        );
        stream.on('text', (delta: string) => callbacks.onContent(delta));
        stream.on('thinking', (delta: string) => callbacks.onThinking(delta));
        stream.on(
          'contentBlock',
          (block: { type: string; name?: string; input?: unknown }) => {
            if (block.type === 'tool_use' && block.name != null) {
              const argsStr =
                typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input ?? {});
              callbacks.onToolCall(block.name, argsStr);
            }
          }
        );
      }
    }
    const neutral = anthropicToNeutral(runner.params.messages);
    callbacks.onDone(neutral);
  } catch (err) {
    const errorType = getErrorType(err) ?? 'server_error';
    const handled = await Promise.resolve(callbacks.onError(errorType));
    if (handled !== true) {
      throw err;
    }
  }
}
