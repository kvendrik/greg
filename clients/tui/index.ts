import { Command } from 'commander';
import { start } from './tui';

export const tuiCommand = new Command('tui')
  .description('Start an interactive TUI chat client')
  .argument('[prompt]', 'An initial prompt to run')
  .option('-v, --voice', 'Start in voice mode')
  .action(
    async (
      prompt: string | undefined,
      options: { voice: boolean } | undefined
    ) => {
      const pipedInput = await readPipedStdin();
      const voiceMode = options?.voice ?? false;

      const initialPrompt = [prompt?.trim(), pipedInput?.trim()].filter(
        (part): part is string => Boolean(part)
      );

      const combinedPrompt =
        initialPrompt.length > 0 ? initialPrompt.join('\n\n') : null;

      await start({
        voiceMode,
        initialPrompt: combinedPrompt,
        sessionId: 'main',
      });
    }
  );

async function readPipedStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  return await new Promise<string | undefined>((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string | Buffer) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    process.stdin.on('end', () => {
      const trimmedBuffer = buffer.trim();
      resolve(trimmedBuffer ? trimmedBuffer : undefined);
    });
    process.stdin.on('error', reject);
  });
}
