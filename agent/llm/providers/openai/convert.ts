import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { NeutralMessage } from '../types';

export function neutralToOpenAI(messages: NeutralMessage[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      const content = msg.content ?? '';
      const toolCalls = msg.toolCalls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
      if (toolCalls?.length) {
        result.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
      } else {
        result.push({ role: 'assistant', content });
      }
    } else {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }
  return result;
}

export function openaiToNeutral(
  messages: ChatCompletionMessageParam[]
): NeutralMessage[] {
  const result: NeutralMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      result.push({ role: 'user', content });
    } else if (msg.role === 'assistant') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const toolCalls = msg.tool_calls?.map((tc) => {
        const fn = 'function' in tc ? tc.function : undefined;
        return {
          id: tc.id,
          name: fn?.name ?? '',
          args: (() => {
            try {
              return JSON.parse(fn?.arguments ?? '{}') as Record<string, unknown>;
            } catch {
              return {};
            }
          })(),
        };
      });
      result.push({
        role: 'assistant',
        content,
        ...(toolCalls?.length ? { toolCalls } : {}),
      });
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        toolCallId: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }
  return result;
}
