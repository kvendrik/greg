import type { Tool as OllamaTool } from 'ollama';

export interface Tool<Args extends object> {
  spec: OllamaTool;
  handler: (args: Args) => Promise<{ content: string }>;
}
