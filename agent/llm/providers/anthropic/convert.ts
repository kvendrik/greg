import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import type { NeutralMessage } from '../types';

export function neutralToAnthropic(
  messages: NeutralMessage[]
): BetaMessageParam[] {
  const result: BetaMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const contentBlocks: BetaMessageParam['content'] = [];

      for (const part of msg.content) {
        if (Array.isArray(part)) {
          for (const tr of part) {
            contentBlocks.push({
              type: 'tool_result',
              tool_use_id: tr.toolCallId,
              content: tr.content,
            });
          }
        } else if (part.type === 'text') {
          contentBlocks.push({ type: 'text', text: part.content });
        } else if (part.type === 'image') {
          const src = part.source;
          if (src.type === 'base64') {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                data: src.data,
                media_type: src.mediaType,
              },
            });
          } else if (src.type === 'url') {
            contentBlocks.push({
              type: 'image',
              source: { type: 'url', url: src.url },
            });
          } else {
            contentBlocks.push({
              type: 'image',
              source: { type: 'file', file_id: src.fileId },
            });
          }
        }
      }

      if (contentBlocks.length > 0) {
        result.push({ role: 'user', content: contentBlocks });
      }
    } else {
      const contentBlocks: BetaMessageParam['content'] = [];

      for (const part of msg.content) {
        if (Array.isArray(part)) {
          for (const tu of part) {
            contentBlocks.push({
              type: 'tool_use',
              id: tu.id,
              name: tu.name,
              input: tu.input,
            });
          }
        } else if (part.type === 'text') {
          contentBlocks.push({ type: 'text', text: part.content });
        }
      }

      if (contentBlocks.length > 0) {
        result.push({ role: 'assistant', content: contentBlocks });
      }
    }
  }

  return result;
}

export function anthropicToNeutral(
  messages: BetaMessageParam[]
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
          if (block.type === 'text' && 'text' in block) {
            parts.push({ type: 'text', content: String(block.text) });
          } else if (block.type === 'tool_result' && 'tool_use_id' in block) {
            parts.push([
              {
                type: 'tool_result',
                toolCallId: block.tool_use_id,
                content:
                  typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content),
              },
            ]);
          } else if (block.type === 'image' && 'source' in block) {
            const src = block.source;
            if (src.type === 'base64') {
              parts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  data: src.data,
                  mediaType: src.media_type,
                },
              });
            } else if (src.type === 'url') {
              parts.push({ type: 'image', source: { type: 'url', url: src.url } });
            } else {
              parts.push({
                type: 'image',
                source: { type: 'file', fileId: src.file_id },
              });
            }
          }
        }
      }

      if (parts.length) {
        result.push({ role: 'user', content: parts });
      }
    } else if (msg.role === 'assistant') {
      const parts: Extract<NeutralMessage, { role: 'assistant' }>['content'] = [];

      if (typeof msg.content === 'string') {
        if (msg.content) {
          parts.push({ type: 'text', content: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'thinking' && 'thinking' in block) {
            parts.push({
              type: 'thinking',
              content: String(block.thinking),
            });
          } else if (block.type === 'text' && 'text' in block) {
            parts.push({ type: 'text', content: String(block.text) });
          } else if (block.type === 'tool_use' && 'id' in block) {
            parts.push([
              {
                type: 'tool_use',
                id: block.id,
                name: block.name ?? '',
                input: (block.input as Record<string, unknown>) ?? {},
              },
            ]);
          }
        }
      }

      if (parts.length) {
        result.push({ role: 'assistant', content: parts });
      }
    }
  }

  return result;
}
