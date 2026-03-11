import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ServerWebSocket } from 'bun';
import type { PromptInput } from '../Agent/Agent';

export type ParsedPromptResult =
  | { ok: true; value: PromptInput }
  | { ok: false; status: number; error: string };

const PromptSchema = Type.Object({
  prompt: Type.Object({
    content: Type.String({ minLength: 1 }),
    images: Type.Array(
      Type.Object({
        data: Type.String(),
        mimeType: Type.String({ minLength: 1 }),
      })
    ),
  }),
});

export function parsePromptBody(body: string): ParsedPromptResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Invalid JSON body',
    };
  }

  if (!Value.Check(PromptSchema, parsed)) {
    return {
      ok: false,
      status: 400,
      error: 'Missing or invalid "prompt" field',
    };
  }

  const { prompt } = parsed as { prompt: PromptInput };
  return { ok: true, value: prompt };
}

export function parsePath(url: string): string[] {
  const pathname = new URL(url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean);
}

export function createSender<D>(
  socket: Pick<ServerWebSocket, 'readyState' | 'send'>
) {
  return {
    send(message: D) {
      // 1 === OPEN for WebSocket readyState
      if (socket.readyState !== 1) {
        return;
      }
      try {
        socket.send(JSON.stringify(message));
      } catch (err) {
        console.error('Failed to send WebSocket message', err);
      }
    },
  };
}

