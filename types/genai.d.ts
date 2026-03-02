declare module '@google/genai' {
  export interface GoogleGenAIOptions {
    apiKey?: string;
  }

  export class GoogleGenAI {
    constructor(options: GoogleGenAIOptions);
    models: {
      countTokens(options: { model: string; contents: unknown }): Promise<{
        totalTokens?: number;
      }>;
    };
  }
}
