import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { checkLimit, type Limits } from './checkLimit';
import { split } from './split';
import { summarize, type Instructions } from './summarize';
import { compressToolResults } from './compress';

export interface CompactResult {
  messages: AgentMessage[];
  didCompact: boolean;
  reason: string;
}

interface CompactOptions {
  signal?: AbortSignal;
  model: { model: Model<Api>; key: string };
  instructions?: Instructions;
  force?: boolean;
  limits?: Limits;
}

export async function compact(
  messages: AgentMessage[],
  { signal, model, instructions, force, limits }: CompactOptions
): Promise<CompactResult> {
  const effectiveSignal = signal ?? new AbortController().signal;

  if (force === true) {
    return doCompact('Forced');
  }

  if (effectiveSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const { reached, reason } = checkLimit(messages, {
    model: model.model,
    limits,
  });

  if (!reached) {
    return {
      messages: compressToolResults(messages),
      didCompact: false,
      reason,
    };
  }

  return doCompact(reason);

  async function doCompact(trigger: string): Promise<CompactResult> {
    const { compact: messagesToCompact, preserve } = split(
      messages,
      model.model
    );

    if (messagesToCompact === null) {
      return { messages, didCompact: false, reason: trigger };
    }

    const compactedMessages = await summarize(messagesToCompact, {
      model,
      signal: effectiveSignal,
      ...(instructions !== undefined && { instructions }),
    });

    return {
      messages: [...compactedMessages, ...compressToolResults(preserve)],
      didCompact: true,
      reason: trigger,
    };
  }
}
