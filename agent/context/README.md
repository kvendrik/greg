## API

```ts
import { compact } from './context';

const {
  messages: newMessages,
  didCompact,
  reason,
} = await compact(messages, {
  model, // { model: Model<Api>, key: string }
  signal, // optional AbortSignal
  instructions, // optional string passed to the summarizer
  force: false, // true bypasses threshold checks
});
```

Or do it manually:

```ts
import type { Model, Api } from '@mariozechner/pi-ai';
import { checkLimit, split, summarize } from './context';

const model: {model: Model<Api>, key: string} = {...};
const messages: AgentMessage[] = [];

const limit = checkLimit(messages, model.model);

if (limit.reached) {
  console.log(`Limit reached: ${limit.reason}.`);

  const { compact, preserve } = split(messages, model.model);
  if (compact == null) return messages;

  const compacted = await summarize(compact, model);
  return [...compacted, ...preserve];
}

return messages;
```

## Why compact

Models lose recall accuracy as context grows ([context rot](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Quality can degrade well before hitting the hard token limit ([OpenAI cookbook](https://cookbook.openai.com/examples/context_summarization_with_realtime_api)). The evidence-backed strategy is: **summarize the older prefix, keep recent turns verbatim** ([Anthropic compaction docs](https://docs.anthropic.com/en/docs/build-with-claude/compaction), [LangChain summary-buffer](https://lagnchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).

## Considerations

- **Quality degrades before the limit** — model recall drops well before the hard context window. Compact proactively at a soft threshold, not at the edge ([OpenAI cookbook](https://cookbook.openai.com/examples/context_summarization_with_realtime_api), [Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/compaction)).
- **Keep recent turns verbatim** — the most recent exchanges carry the highest signal. Summarize the older prefix, never the tail ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [LangChain summary-buffer](https://lagnchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).
- **Compaction is lossy** — every summarization pass discards detail. Minimize passes by compacting aggressively enough to buy headroom, and update summaries incrementally rather than re-summarizing from scratch ([LangChain `moving_summary_buffer`](https://lagnchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).
- **Cost is a signal too** — large cache write costs indicate a bloated context even if token counts look fine. Use cost thresholds alongside token thresholds ([Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)).
- **Tool results are noise over time** — raw tool output is useful when fresh but redundant once acted on. Clearing old results is the lightest-touch compaction step ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Compaction alone has a ceiling** — Anthropic describes three complementary strategies: compaction, structured note-taking outside the context window, and sub-agents with clean windows ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Greg already covers all three: `compact` handles in-window summarization, `memory_note` persists decisions and context to disk, and `spawn_agent` delegates long-running tasks to sub-agents with their own sessions.

## Flow

1. **Trigger** — check thresholds each turn (cache write cost, cache write tokens, soft token limit). First match fires compaction. This mirrors Anthropic's token-threshold trigger and OpenAI's `compact_threshold`.
2. **Split** — find the boundary between "prefix to summarize" and "tail to preserve." Try keeping 5 recent user turns, then 3, then 1, each checked against a token budget (40% of context window). Falls back to the largest token-bounded suffix that fits. Token-bounded retention follows the LangChain `max_token_limit` pattern.
3. **Summarize** — send the prefix to the LLM with a summarization prompt. Custom instructions (from `/compact <instructions>`) replace the default prompt, matching Anthropic's `instructions` parameter behavior.
4. **Reassemble** — `[Compaction summary]` message + preserved tail replaces the full history.

Anthropic's Claude Code uses the same shape: compressed context + the N most recently accessed items ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

## Gaps

- **Summary-on-summary drift** — repeated compactions re-summarize the prior `[Compaction summary]` as if it were a regular message, losing detail each pass. Detect existing summaries in the prefix and pass them as context for incremental update instead of re-summarization. Mirrors LangChain's `moving_summary_buffer` ([source](https://lagnchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)) and Anthropic's guidance to "maximize recall, then iterate to improve precision" ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Strip tool results** - Anthropic recommends stripping old tool results as a lightweight first pass: "once a tool has been called deep in the message history, why would the agent need to see the raw result again?" ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Clear raw results before summarizing to reduce noise fed to the summarizer.
- **Use `@anthropic-ai/tokenizer`** - `chars / 4` can miscount for JSON tool output, non-Latin text, or base64 content. Assistant messages already carry real `usage.output` token counts from the API; use those and only fall back to the heuristic for user messages. For exact user-message counts, `@anthropic-ai/tokenizer` is an option. Low urgency since the heuristic only drives budget decisions, not hard limits.
