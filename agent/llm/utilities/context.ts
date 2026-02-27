import type { NeutralMessage } from '../providers/types';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import type { ProviderEntry, ProviderId } from '../providers';
import { saveConversationNote } from '../../tools/memory';

const TOKEN_COMPACTION_THRESHOLD = 150_000;

export type PrepareMessagesOpts = {
  providerEntry: ProviderEntry<ProviderId>;
  system: string;
  messages: NeutralMessage[];
  newUserContent: string;
  tools: BetaRunnableTool[];
  conversationStartIso: string;
  model: string;
};

export async function prepareMessages(
  opts: PrepareMessagesOpts
): Promise<NeutralMessage[]> {
  const messagesWithNew: NeutralMessage[] = [
    ...opts.messages,
    {
      role: 'user',
      content: [{ type: 'text', content: opts.newUserContent }],
    },
  ];

  if (messagesWithNew.length <= 1) {
    return messagesWithNew;
  }

  const tokenCount = await opts.providerEntry.countTokens({
    system: opts.system,
    messages: messagesWithNew,
    tools: opts.tools,
    model: opts.model,
  });

  if (tokenCount < 0 || tokenCount < TOKEN_COMPACTION_THRESHOLD) {
    return messagesWithNew;
  }

  const nativeMessages = opts.providerEntry.convertMessages(messagesWithNew);
  const summarized = await opts.providerEntry.summarize({
    system: opts.system,
    messages: nativeMessages,
    model: opts.model,
  });

  if (!summarized) {
    return messagesWithNew;
  }

  try {
    await saveConversationNote(summarized.note, opts.conversationStartIso);
  } catch (err) {
    console.error('[context] saveConversationNote failed:', err);
  }

  const condensedContent = `${summarized.condensed_summary}\n\n---\nUser's latest message:\n\n${opts.newUserContent}`;
  return [
    {
      role: 'user',
      content: [{ type: 'text', content: condensedContent }],
    },
  ];
}
