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

/**
 * Content block for tool results that the LLM can consume (e.g. text + image).
 * Matches Anthropic tool_result content: string or array of TextBlockParam | ImageBlockParam.
 */
export type ToolResultContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: {
            type: 'base64';
            media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
            data: string;
          };
        }
    >;

export interface ToolContext {
  signal?: AbortSignal;
}

export interface Tool<Args extends object> {
  spec: AnthropicToolSpec;
  handler: (
    args: Args,
    context?: ToolContext
  ) => Promise<{ content: ToolResultContent }>;
}
