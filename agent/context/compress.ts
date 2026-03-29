import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type {
  TextContent,
  ImageContent,
  ToolResultMessage,
} from '@mariozechner/pi-ai';

/** Number of recent user turns whose tool results are preserved verbatim. */
const PRESERVE_RECENT_TURNS = 3;

/** Max characters kept per text block in a compressed tool result. */
const MAX_COMPRESSED_CHARS = 200;

const TRUNCATION_MARKER = '\n[truncated]';

export function compressToolResults(
  messages: AgentMessage[],
  {
    preserveRecentTurns = PRESERVE_RECENT_TURNS,
    maxCompressedChars = MAX_COMPRESSED_CHARS,
  }: { preserveRecentTurns?: number; maxCompressedChars?: number } = {}
): AgentMessage[] {
  const boundary = findPreserveBoundary(messages);

  if (boundary === 0) {
    return messages;
  }

  const result: AgentMessage[] = [];

  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (idx < boundary && isToolResult(msg)) {
      result.push(compressedToolResult(msg));
    } else {
      result.push(msg);
    }
  }

  return result;

  /** Index of the Nth-from-last user message. Messages before this index are
   *  eligible for compression. Returns 0 when the conversation is too short. */
  function findPreserveBoundary(messages: AgentMessage[]): number {
    let userTurnsSeen = 0;

    for (let idx = messages.length - 1; idx >= 0; idx--) {
      if (messages[idx].role === 'user') {
        userTurnsSeen++;
        if (userTurnsSeen === preserveRecentTurns) {
          return idx;
        }
      }
    }

    return 0;
  }

  function compressedToolResult(msg: ToolResultMessage): AgentMessage {
    const compressed: (TextContent | ImageContent)[] = [];
    let hadImage = false;

    for (const block of msg.content) {
      if (block.type === 'image') {
        hadImage = true;
        continue;
      }

      if (block.text.length <= maxCompressedChars) {
        compressed.push(block);
      } else {
        compressed.push({
          type: 'text',
          text: block.text.slice(0, maxCompressedChars) + TRUNCATION_MARKER,
        });
      }
    }

    if (hadImage) {
      compressed.push({ type: 'text', text: '[image omitted]' });
    }

    if (compressed.length === 0) {
      compressed.push({ type: 'text', text: '[result omitted]' });
    }

    return { ...msg, content: compressed };
  }
}

function isToolResult(msg: AgentMessage): msg is ToolResultMessage {
  return msg.role === 'toolResult';
}
