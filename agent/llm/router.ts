import { Anthropic } from '@anthropic-ai/sdk';

export type TaskComplexity = 'trivial' | 'normal' | 'complex';

/**
 * Resolves which Claude model should handle the user prompt.
 * Asks the LLM only for task complexity; the resolver maps complexity → model.
 */
export async function resolveModel(
  content: string,
  signal: AbortSignal
): Promise<(typeof ROUTER_MODELS)[number]> {
  const complexity = await classifyComplexity(content, signal);
  return COMPLEXITY_TO_MODEL[complexity];
}

/**
 * Classifies task complexity via one Haiku call. Output is mapped to model in resolveModel.
 */
export async function classifyComplexity(
  content: string,
  signal: AbortSignal
): Promise<TaskComplexity> {
  try {
    const message = await anthropic.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 32,
        system: `You are a task-complexity classifier for a coding assistant. Your single job is to choose one of three complexity levels so we can route the user's message to the right model. Your response is returned as JSON with a "complexity" field automatically.

<criteria>
<trivial>Single-turn, no tools, no real reasoning. Greetings, thanks, simple factual questions (e.g. "what is JSON?", "what's 2+2?"). Never choose trivial if the user asks about the workspace, files, or anything that can only be answered by using tools (read_file, list_dir, etc.).</trivial>
<normal>Default. Any reasoning, tool use, coding, multi-step tasks, or questions that require tools or the codebase. When in doubt, choose normal.</normal>
<complex>Architecture, security review, long research, or the user explicitly asks for "best quality" / "most capable" / "opus".</complex>
</criteria>

<examples>
<example>User: "Hi there" → trivial</example>
<example>User: "What's 2+2?" → trivial</example>
<example>User: "Do you see your own README.md file?" → normal (requires tool use)</example>
<example>User: "Is there a tsconfig in the project?" → normal (requires tool use)</example>
<example>User: "Run the tests and fix any failures" → normal</example>
<example>User: "Design a distributed system for real-time analytics" → complex</example>
</examples>`,
        messages: [{ role: 'user', content }],
        thinking: { type: 'disabled' },
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                complexity: {
                  type: 'string',
                  enum: COMPLEXITY_VALUES,
                  description: 'Task complexity',
                },
              },
              required: ['complexity'],
              additionalProperties: false,
            },
          },
        },
      },
      { signal } as { headers?: Record<string, string> }
    );
    const textBlock = message.content?.find((b) => b.type === 'text');
    const text = textBlock && 'text' in textBlock ? String(textBlock.text) : '';
    const parsed = parseComplexityResponse(text);
    return parsed ?? 'normal';
  } catch (err) {
    console.error('[router] failed, using default complexity:', err);
    return 'normal';
  }
}

const ROUTER_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', default: false },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    default: false,
  },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', default: true },
] as const;

const COMPLEXITY_TO_MODEL: Record<
  TaskComplexity,
  (typeof ROUTER_MODELS)[number]
> = {
  trivial: ROUTER_MODELS[1],
  normal: ROUTER_MODELS[0],
  complex: ROUTER_MODELS[2],
};

const COMPLEXITY_VALUES: TaskComplexity[] = ['trivial', 'normal', 'complex'];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseComplexityResponse(text: string): TaskComplexity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    !('complexity' in parsed)
  ) {
    return null;
  }
  const c = String((parsed as { complexity: unknown }).complexity).trim();
  return COMPLEXITY_VALUES.includes(c as TaskComplexity)
    ? (c as TaskComplexity)
    : null;
}
