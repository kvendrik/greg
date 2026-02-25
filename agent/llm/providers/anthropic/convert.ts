import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import type { NeutralMessage } from '../types';

export function neutralToAnthropic(messages: NeutralMessage[]): BetaMessageParam[] {
  const result: BetaMessageParam[] = [];
  let toolResultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

  function flushToolResults() {
    if (toolResultBlocks.length > 0) {
      result.push({ role: 'assistant', content: toolResultBlocks });
      toolResultBlocks = [];
    }
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      flushToolResults();
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      flushToolResults();
      const blocks: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      > = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
        }
      }
      const content: BetaMessageParam['content'] =
        blocks.length > 0 ? blocks : (msg.content || '');
      result.push({ role: 'assistant', content });
    } else {
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }
  flushToolResults();
  return result;
}

export function anthropicToNeutral(
  messages: BetaMessageParam[]
): NeutralMessage[] {
  const result: NeutralMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      result.push({ role: 'user', content });
    } else {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      let text = '';
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      const toolResults: Array<{ toolCallId: string; content: string }> = [];

      for (const block of blocks) {
        if (block.type === 'text' && 'text' in block) text += block.text;
        if (block.type === 'tool_use' && 'id' in block)
          toolCalls.push({
            id: block.id,
            name: block.name ?? '',
            args: (block.input as Record<string, unknown>) ?? {},
          });
        if (block.type === 'tool_result' && 'tool_use_id' in block)
          toolResults.push({
            toolCallId: block.tool_use_id,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          });
      }

      if (text || toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: text,
          ...(toolCalls.length
            ? { toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })) }
            : {}),
        });
      }
      for (const tr of toolResults) {
        result.push({ role: 'tool', toolCallId: tr.toolCallId, content: tr.content });
      }
    }
  }
  return result;
}
