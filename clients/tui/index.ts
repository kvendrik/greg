import { Command } from 'commander';
import { start } from './tui';
import * as gateway from '../../gateway';

export const tuiCommand = new Command('tui')
  .description('Start an interactive TUI chat client')
  .argument('[prompt]', 'An initial prompt to run')
  .option('-v, --voice', 'Start in voice mode')
  .option('-s, --session [sessionId]', 'The session ID to use')
  .option('-p, --print', 'Print mode')
  .action(
    async (
      prompt: string | undefined,
      options: { voice: boolean; session?: string; print: boolean }
    ) => {
      const sessionId = options.session ?? 'main';
      const pipedInput = await readPipedStdin();

      const initialPrompt = [prompt?.trim(), pipedInput?.trim()].filter(
        (part): part is string => Boolean(part)
      );

      const combinedPrompt =
        initialPrompt.length > 0 ? initialPrompt.join('\n\n') : null;

      if (!options.print) {
        await start({
          voiceMode: options.voice,
          initialPrompt: combinedPrompt,
          sessionId,
        });
        return;
      }

      if (!combinedPrompt) {
        throw new Error('No prompt provided. Print mode requires a prompt.');
      }

      if (!gateway.exists(sessionId)) {
        throw new Error(
          `Session ${sessionId} not found. Print mode only works with existing sessions.`
        );
      }

      process.env.GREG_LOG = 'silent';
      await gateway.start();
      const session = gateway.get(sessionId);

      session.subscribe('tui', {
        onContent(chunk) {
          process.stdout.write(chunk);
        },
        onError(error) {
          process.stderr.write(error);
        },
      });

      await session.prompt(
        {
          content: combinedPrompt,
          images: [],
        },
        { channelId: 'tui' }
      );
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
