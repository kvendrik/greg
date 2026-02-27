import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { NeutralMessage } from '../types';

export function neutralToOpenAI(
  messages: NeutralMessage[]
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const contentParts: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [];

      for (const part of msg.content) {
        if (!Array.isArray(part) && part.type === 'text') {
          contentParts.push({ type: 'text', text: part.content });
        } else if (!Array.isArray(part) && part.type === 'image') {
          const src = part.source;
          if (src.type === 'base64') {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${src.mediaType};base64,${src.data}`,
              },
            });
          } else if (src.type === 'url') {
            contentParts.push({
              type: 'image_url',
              image_url: { url: src.url },
            });
          }
          // OpenAI chat API has no file_id; skip source.type === 'file'
        } else if (Array.isArray(part)) {
          for (const tr of part) {
            result.push({
              role: 'tool',
              tool_call_id: tr.toolCallId,
              content: tr.content,
            });
          }
        }
      }

      if (contentParts.length === 1 && contentParts[0].type === 'text') {
        result.push({ role: 'user', content: contentParts[0].text });
      } else if (contentParts.length > 0) {
        result.push({ role: 'user', content: contentParts });
      }
    } else {
      let text = '';
      const toolCalls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }> = [];

      for (const part of msg.content) {
        if (!Array.isArray(part)) {
          if (part.type === 'text') {
            text += part.content;
          }
          // thinking blocks are ignored for OpenAI
        } else {
          for (const tu of part) {
            toolCalls.push({
              id: tu.id,
              type: 'function',
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input ?? {}),
              },
            });
          }
        }
      }

      if (toolCalls.length) {
        result.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls,
        });
      } else if (text) {
        result.push({ role: 'assistant', content: text });
      }
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
      const parts: Extract<NeutralMessage, { role: 'user' }>['content'] = [];

      if (typeof msg.content === 'string') {
        if (msg.content) {
          parts.push({ type: 'text', content: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', content: block.text });
          } else if (block.type === 'image_url' && block.image_url?.url) {
            const url = block.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:(image\/[a-z]+);base64,(.+)$/);
              const allowedMediaTypes = [
                'image/jpeg',
                'image/png',
                'image/gif',
                'image/webp',
              ] as const;
              if (
                match &&
                allowedMediaTypes.includes(match[1] as (typeof allowedMediaTypes)[number])
              ) {
                parts.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    data: match[2],
                    mediaType: match[1] as (typeof allowedMediaTypes)[number],
                  },
                });
              } else {
                parts.push({ type: 'image', source: { type: 'url', url } });
              }
            } else {
              parts.push({ type: 'image', source: { type: 'url', url } });
            }
          }
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'user', content: parts });
      }
    } else if (msg.role === 'assistant') {
      const parts: Extract<NeutralMessage, { role: 'assistant' }>['content'] = [];
      const text = typeof msg.content === 'string' ? msg.content : '';

      if (text) {
        parts.push({ type: 'text', content: text });
      }

      const toolCalls = 'tool_calls' in msg ? msg.tool_calls : undefined;
      if (toolCalls?.length) {
        const toolUses = toolCalls.map((tc: { id: string; function?: { name?: string; arguments?: string } }) => {
          const fn = tc.function;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(fn?.arguments ?? '{}') as Record<string, unknown>;
          } catch {
            args = {};
          }
          return {
            type: 'tool_use' as const,
            id: tc.id,
            name: fn?.name ?? '',
            input: args,
          };
        });
        parts.push(toolUses);
      }

      result.push({ role: 'assistant', content: parts });
    } else if (msg.role === 'tool') {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      result.push({
        role: 'user',
        content: [
          [
            {
              type: 'tool_result',
              toolCallId: msg.tool_call_id,
              content,
            },
          ],
        ],
      });
    }
  }

  return result;
}
