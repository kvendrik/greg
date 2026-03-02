import type { RunParams, RunCallbacks } from '../types';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { getErrorType } from './errors';
import {
  neutralToGemini,
  geminiToNeutral,
  type GeminiContent,
  type GeminiPart,
} from './convert';
import config from '../../../../.config';

const ai = new GoogleGenAI({ apiKey: config.providers.gemini.key });

type ToolShape = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (args: object) => Promise<string | unknown>;
};

function betaToolsToGeminiDeclarations(
  tools: BetaRunnableTool[]
): Array<{ functionDeclarations: Array<Record<string, unknown>> }> {
  return [
    {
      functionDeclarations: tools.map((tool) => {
        const shape = tool as unknown as ToolShape;
        const schema = shape.input_schema ?? { type: 'object' };
        return {
          name: shape.name,
          description: (shape.description ?? '') as string,
          parameters: schema as Record<string, unknown>,
        };
      }),
    },
  ];
}

const MAX_TOOL_ITERATIONS = 25;

export async function run(
  params: RunParams,
  callbacks: RunCallbacks
): Promise<void> {
  const { system, messages, model, tools, signal } = params;

  let contents: GeminiContent[] = neutralToGemini(messages);
  const geminiTools = betaToolsToGeminiDeclarations(tools);
  const toolShapeMap = new Map(
    (tools as unknown as ToolShape[]).map((tool) => [tool.name, tool])
  );

  const streamParams = {
    model,
    contents,
    config: {
      systemInstruction: system,
      tools: geminiTools,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.AUTO,
        },
      },
      maxOutputTokens: 8192,
    },
    signal,
  };

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const stream = await ai.models.generateContentStream(streamParams);

      const accumulatedParts: Array<{ text?: string; functionCall?: { name?: string; args?: unknown }; thoughtSignature?: string }> = [];
      let streamedText = '';

      for await (const chunk of stream) {
        const chunkText = chunk.text ?? '';
        if (chunkText) {
          streamedText += chunkText;
          callbacks.onContent(chunkText);
        }
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          accumulatedParts.push({
            ...(part.text !== undefined && { text: part.text }),
            ...(part.functionCall !== undefined && {
              functionCall: {
                name: part.functionCall.name,
                args: part.functionCall.args,
              },
            }),
            ...(part.thoughtSignature !== undefined && {
              thoughtSignature: part.thoughtSignature,
            }),
          });
        }
      }

      const functionCalls = accumulatedParts
        .filter((p): p is { functionCall: { name?: string; args?: unknown } } => p.functionCall != null)
        .map((p) => ({ name: p.functionCall.name ?? '', args: (p.functionCall.args as Record<string, unknown>) ?? {} }));

      if (functionCalls.length > 0) {
        const firstThoughtSignature = accumulatedParts.find(
          (p): p is { thoughtSignature: string } =>
            p.thoughtSignature !== undefined && typeof p.thoughtSignature === 'string'
        )?.thoughtSignature;

        const modelParts: GeminiPart[] = [];
        for (const part of accumulatedParts) {
          if (part.text) {
            modelParts.push({ text: part.text });
          } else if (part.functionCall) {
            const { name, args } = part.functionCall;
            const thoughtSignature =
              part.thoughtSignature ?? firstThoughtSignature;
            modelParts.push({
              functionCall: { name: name ?? '', args: (args as Record<string, unknown>) ?? {} },
              ...(thoughtSignature !== undefined && { thoughtSignature }),
            });
          }
        }

        const responseParts: GeminiPart[] = [];
        for (const fc of functionCalls) {
          const name = fc.name;
          const args = fc.args;
          callbacks.onToolCall(name, args);

          const toolShape = toolShapeMap.get(name);
          let result: string;
          if (toolShape?.run) {
            const raw = await toolShape.run(args);
            result = typeof raw === 'string' ? raw : JSON.stringify(raw);
          } else {
            result = JSON.stringify({ error: 'Unknown tool' });
          }

          responseParts.push({
            functionResponse: { name, response: { result } },
          });
        }

        contents = [
          ...contents,
          { role: 'model', parts: modelParts },
          { role: 'user', parts: responseParts },
        ];
        (streamParams as { contents: GeminiContent[] }).contents = contents;
        continue;
      }

      const fullContents: GeminiContent[] = [
        ...contents,
        { role: 'model', parts: streamedText ? [{ text: streamedText }] : [] },
      ];
      const neutral = geminiToNeutral(fullContents);
      callbacks.onDone(neutral);
      return;
    }

    const neutral = geminiToNeutral(contents);
    callbacks.onDone(neutral);
  } catch (err) {
    const errorType = getErrorType(err) ?? 'server_error';
    const handled = await Promise.resolve(callbacks.onError(errorType));
    if (handled !== true) {
      throw err;
    }
  }
}
