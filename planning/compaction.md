# Compaction — further recommendations

## Evidence & best practices

### Anthropic — Compaction docs

> "Compaction extends the effective context length for long-running conversations and tasks by automatically summarizing older context when approaching the context window limit. This isn't just about staying under a token cap. As conversations get longer, models struggle to maintain focus across the full history. Compaction keeps the active context focused and performant by replacing stale content with concise summaries."

- Token-threshold trigger (default 150k, min 50k), configurable per request.
- Server creates a `compaction` block with the summary; all prior messages are automatically dropped on the next request.
- Custom `instructions` parameter completely replaces the default summarization prompt.
- Default prompt asks the model to "write a summary of the transcript … including state, next steps, learnings."

Source: https://docs.anthropic.com/en/docs/build-with-claude/compaction

### Anthropic — Effective context engineering for AI agents

> "As the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases" (context rot). "Context must be treated as a finite resource with diminishing marginal returns."

On compaction specifically:

> "In Claude Code, we implement this by passing the message history to the model to summarize and compress the most critical details. The model preserves architectural decisions, unresolved bugs, and implementation details while discarding redundant tool outputs. The agent then continues with this compressed context plus the five most recently accessed files."

> "The art of compaction lies in the selection of what to keep versus what to discard, as overly aggressive compaction can result in the loss of subtle but critical context. Start by maximizing recall, then iterate to improve precision by eliminating superfluous content."

> "One of the safest lightest-touch forms of compaction is tool result clearing — once a tool has been called deep in the message history, why would the agent need to see the raw result again?"

They also describe three complementary strategies for long-horizon tasks:
1. **Compaction** — maintains conversational flow for extensive back-and-forth.
2. **Structured note-taking** — agent writes persistent notes outside the context window, pulled back in when needed.
3. **Sub-agent architectures** — specialized sub-agents handle focused tasks with clean windows, returning condensed summaries (1–2k tokens).

Source: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

### Anthropic — Prompt caching

- Cache the stable prefix (system prompt, tools, early history) to reduce latency (>2x) and cost (up to 90%) on repeated requests.
- Automatic caching mode: add `cache_control: {"type": "ephemeral"}` at the top level; the system auto-manages breakpoints.
- Cache lifetime: 5 min default, refreshed on each use.
- Compaction and caching are complementary: compact to keep context small, cache the stable prefix for speed.

Source: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

### OpenAI — Context management / Compaction

- Server-side compaction: set `compact_threshold` in the Responses API. When the rendered token count crosses the threshold, the server runs compaction within the same stream.
- Returns an encrypted, opaque compaction item that carries forward key prior state.
- Standalone `/responses/compact` endpoint for explicit control in long-running workflows.
- Compacted window may include retained items (not just the summary), letting the model continue naturally.

Source: https://developers.openai.com/api/docs/guides/context-management

### OpenAI — Cookbook: context summarization

> "Strategy: Summarise older turns into a single assistant message, keep the last few verbatim turns, and continue."

- Summarize when the token window becomes large (configurable threshold).
- Performance can degrade well before hitting the hard context limit.
- Realtime API also includes a `truncation` parameter that automatically optimizes context truncation while maximizing cache hit rates.

Source: https://cookbook.openai.com/examples/context_summarization_with_realtime_api

### LangChain — ConversationSummaryBufferMemory

- Hybrid memory: rolling summary (`moving_summary_buffer`) + recent buffer of verbatim messages.
- Uses **token length** (not turn count) to decide when to flush old interactions (`max_token_limit`).
- The rolling summary is updated incrementally as messages are pruned — avoids full re-summarization.
- A 2023–2024 fix (PR #14969) addressed buffer growing unbounded by ensuring loaded messages stay consistent with the pruning window.

Source: https://lagnchain.readthedocs.io/en/latest/modules/memory/types/summary_buffer.html

---

## Recommendations

### High impact

- **Summary-on-summary drift**: detect existing `[Compaction summary]` messages in the prefix before summarizing. Extract the prior summary text and pass it as context to the summarizer (e.g. "Here is the previous summary, update it with the new information") instead of re-summarizing it as if it were a user message. This turns repeated compactions into incremental updates rather than lossy re-summarizations. Mirrors LangChain's `moving_summary_buffer` pattern and Anthropic's advice to "maximize recall" during compaction.

- **Post-compaction verification**: after compaction, estimate the token count of the resulting messages. If it still exceeds the soft limit, run a second pass with a more aggressive split (fewer preserved turns or a tighter token budget). Return the final token estimate in `CompactResult` so callers can observe whether compaction was effective. Both OpenAI and Anthropic server-side compaction handle this transparently; our client-side implementation should approximate it.

### Lower impact

- **Tool result clearing**: Anthropic explicitly recommends clearing old tool call results as a lightweight compaction step. Before summarizing the prefix, strip raw tool results from messages deep in history — keeping the tool call name but replacing the result with a short "[result cleared]" marker. This reduces tokens fed to the summarizer and preserves signal.

- **Token estimation fidelity**: the current `chars / 4` heuristic can over/undercount for non-English text, tool call JSON, or base64 image content. Consider using the model's tokenizer if available at runtime. Not urgent since the heuristic is only used for budget decisions, not hard limits.

- **Prefix caching**: for long-running sessions, the system prompt + tool definitions + compaction summary form a stable prefix that could be cached across turns. Anthropic's prompt caching (automatic mode with `cache_control: ephemeral`) and OpenAI's built-in cache optimization could reduce latency >2x and cost up to 90%. Requires coordination with the streaming layer — out of scope for compaction itself but worth tracking.
