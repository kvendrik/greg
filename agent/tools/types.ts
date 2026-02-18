/**
 * Anthropic-compatible tool spec: name, description, input_schema (JSON Schema).
 */
export interface AnthropicToolSpec {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<
      string,
      { type: string; description?: string; [k: string]: unknown }
    >;
    required?: string[];
    [k: string]: unknown;
  };
}

export interface Tool<Args extends object> {
  spec: AnthropicToolSpec;
  handler: (args: Args) => Promise<{ content: string }>;
}
