import type { NeutralMessage } from '../types';

export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
      thoughtSignature?: string;
    }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

export function neutralToGemini(messages: NeutralMessage[]): GeminiContent[] {
  const result: GeminiContent[] = [];
  let toolCallIdToName: Record<string, string> = {};

  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: GeminiPart[] = [];

      for (const part of msg.content) {
        if (!Array.isArray(part) && part.type === 'text') {
          parts.push({ text: part.content });
        } else if (!Array.isArray(part) && part.type === 'image') {
          const src = part.source;
          if (src.type === 'base64') {
            parts.push({
              inlineData: {
                mimeType: src.mediaType,
                data: src.data,
              },
            });
          }
          // URL images require fetch; skip like OpenAI file_id
        } else if (Array.isArray(part)) {
          for (const tr of part) {
            const toolName = toolCallIdToName[tr.toolCallId] ?? tr.toolCallId;
            parts.push({
              functionResponse: {
                name: toolName,
                response: { result: tr.content },
              },
            });
          }
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'user', parts });
      }
    } else {
      toolCallIdToName = {};
      const parts: GeminiPart[] = [];

      for (const part of msg.content) {
        if (!Array.isArray(part)) {
          if (part.type === 'text') {
            parts.push({ text: part.content });
          }
        } else {
          for (const tu of part) {
            toolCallIdToName[tu.id] = tu.name;
            parts.push({
              functionCall: {
                name: tu.name,
                args: (tu.input ?? {}) as Record<string, unknown>,
              },
            });
          }
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'model', parts });
      }
    }
  }

  return result;
}

export function geminiToNeutral(
  contents: GeminiContent[]
): NeutralMessage[] {
  const result: NeutralMessage[] = [];

  for (const content of contents) {
    if (content.role === 'user') {
      const parts: Extract<NeutralMessage, { role: 'user' }>['content'] = [];

      for (const part of content.parts) {
        if ('text' in part && part.text) {
          parts.push({ type: 'text', content: part.text });
        } else if ('functionResponse' in part && part.functionResponse) {
          const fr = part.functionResponse;
          const contentStr =
            typeof fr.response === 'object' && fr.response != null
              ? JSON.stringify(fr.response)
              : String(fr.response);
          parts.push([
            {
              type: 'tool_result',
              toolCallId: fr.name,
              content: contentStr,
            },
          ]);
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'user', content: parts });
      }
    } else if (content.role === 'model') {
      const parts: Extract<NeutralMessage, { role: 'assistant' }>['content'] =
        [];

      for (const part of content.parts) {
        if ('text' in part && part.text) {
          parts.push({ type: 'text', content: part.text });
        } else if ('functionCall' in part && part.functionCall) {
          const fc = part.functionCall;
          parts.push([
            {
              type: 'tool_use',
              id: fc.name,
              name: fc.name,
              input: (fc.args ?? {}) as Record<string, unknown>,
            },
          ]);
        }
      }

      if (parts.length > 0) {
        result.push({ role: 'assistant', content: parts });
      }
    }
  }

  return result;
}
