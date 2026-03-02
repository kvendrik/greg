import { Anthropic } from '@anthropic-ai/sdk';
import type { TaskComplexity, ProviderId } from '../providers/types';
import type { ProviderModel, ProviderModelSet } from '../providers';
import { providers } from '../providers';
import config from '../../../.config';

const COMPLEXITY_VALUES: TaskComplexity[] = ['trivial', 'normal', 'complex'];
const anthropic = new Anthropic({ apiKey: config.providers.anthropic.key });

export async function classifyComplexity(
  content: string,
  signal: AbortSignal
): Promise<TaskComplexity> {
  try {
    const message = await anthropic.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 64,
        system: `You are a task classifier for a coding assistant. Your job is to choose complexity and reasoning effort so we can route the user's message to the right model and set thinking depth. Your response is returned as JSON with "complexity" and "reasoningEffort" automatically.

<criteria>
<trivial>Single-turn, no tools, no real reasoning. Greetings, thanks, simple factual questions. Never choose trivial if the user asks about the workspace, files, or anything that requires tools. Use reasoningEffort: low.</trivial>
<normal>Default. Any reasoning, tool use, coding, multi-step tasks, or questions that require tools or the codebase. When in doubt, choose normal. Use reasoningEffort: medium.</normal>
<complex>Architecture, security review, long research, or the user explicitly asks for "best quality" / "most capable" / "opus". Use reasoningEffort: high or max.</complex>
</criteria>`,
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
    const parsed = parseClassifierResponse(text);
    return parsed;
  } catch (err) {
    throw new Error(err);
  }
}

function parseClassifierResponse(text: string): TaskComplexity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  return (parsed as any).complexity as TaskComplexity;
}
