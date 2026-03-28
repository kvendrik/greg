# 🤖 `compact()`

#### A context compaction toolkit for [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai)

```ts
import { compact } from './context';

const {
  messages: newMessages,
  didCompact,
  reason,
} = await compact(messages, {
  model, // { model: Model<Api>, key: string }
  signal, // optional AbortSignal
  instructions, // optional summarization instructions: { content: string; strategy: 'replace' | 'append' }
  force: false, // true bypasses threshold checks
});
```

## Why

Models lose recall accuracy as context grows ([context rot](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). Quality can degrade well before hitting the hard token limit ([OpenAI cookbook](https://cookbook.openai.com/examples/context_summarization_with_realtime_api)). The evidence-backed strategy is: **summarize the older prefix, keep recent turns verbatim** ([Anthropic compaction docs](https://docs.anthropic.com/en/docs/build-with-claude/compaction), [LangChain summary-buffer](https://langchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).

This folder contains a [`pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) toolkit for effective compaction based on evidence-based strategies.

## Strategies

- **Compact before hitting the hard limit** — model recall drops well before the hard context window. Compact proactively at a soft threshold, not at the edge ([OpenAI cookbook](https://cookbook.openai.com/examples/context_summarization_with_realtime_api), [Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/compaction)).
- **Keeps recent turns verbatim** — the most recent exchanges carry the highest signal. Summarize the older prefix, never the tail ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [LangChain summary-buffer](https://langchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)). Anthropic's Claude Code uses the same shape: compressed context + the N most recently accessed items ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Uses cost as a secondary signal** — large cache write costs indicate a bloated context even if token counts look fine. We use cost thresholds alongside token thresholds ([Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)).

Coming soon:

- **Keeps summaries intact** — every summarization pass discards detail. We update summaries incrementally rather than re-summarizing from scratch ([LangChain `moving_summary_buffer`](https://langchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html)).
- **We don't summarize old tool call results** — raw tool output is useful when fresh but redundant once acted on. Clearing old results is the lightest-touch compaction step ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

## What you should know

**Compaction alone has a ceiling** — Anthropic describes three complementary strategies: compaction, structured note-taking outside the context window, and sub-agents with clean windows ([source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)). [Greg](https://github.com/kvendrik/greg) covers all three: `compact` handles in-window summarization, `memory_note` persists decisions and context to disk, and `spawn_agent` delegates long-running tasks to sub-agents with their own sessions.

## Flow

When you call `compact()`:

1. **checkLimit()** — checks thresholds (cache write cost, cache write tokens, soft token limit). First match fires a `reached: true`. This mirrors Anthropic's token-threshold trigger and OpenAI's `compact_threshold`.
2. **split()** — finds the boundary between "prefix to summarize" and "tail to preserve." We try to keep 5 recent user turns, then 3, then 1, each checked against a token budget (40% of context window). Falls back to the largest token-bounded suffix that fits. Token-bounded retention follows the LangChain `max_token_limit` pattern.
3. **summarize()** — sends the messages to compact to the LLM with a summarization prompt. Custom instructions replace the default prompt (when `instructions.strategy` is set to `replace`), matching Anthropic's `instructions` parameter behavior.
4. **Reassemble** — We put together the messages to preserve from `split()` and the `summary` for a new array of messages.

## Manual API

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

  const compacted = await summarize(compact, {
    model,
    signal: new AbortController().signal,
  });

  return [...compacted, ...preserve];
}

return messages;
```

## Gaps

Separate from the "Coming soon" list above:

- **Use `@anthropic-ai/tokenizer`** - `chars / 4` can miscount for JSON tool output, non-Latin text, or base64 content. Assistant messages already carry real `usage.output` token counts from the API; use those and only fall back to the heuristic for user messages. For exact user-message counts, `@anthropic-ai/tokenizer` is an option. Low urgency since the heuristic only drives budget decisions, not hard limits.
