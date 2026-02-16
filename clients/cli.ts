import { prompt, ping, abort } from '../agent/utilities';
import { text, isCancel, stream } from '@clack/prompts';
import pc from 'picocolors';

if (!(await ping())) {
  console.error('Agent is not running. Usage: bun run agent');
  process.exit(1);
}

process.on('SIGINT', async () => {
  const success = await abort();
  if (!success) {
    console.error('Failed to abort agent');
    process.exit(1);
  }
  process.exit(0);
});

await promptForInput(
  'How can I help you today?',
  process.argv.slice(2).join(' ').trim()
);

async function promptForInput(placeholder: string, initialValue?: string) {
  const input = await text({
    message: '',
    placeholder,
    initialValue,
    validate(value) {
      if (value.length === 0) return `Value is required`;
    },
  });

  if (isCancel(input)) {
    process.exit(0);
  }

  await stream.step(streamPrompt(input.toString()));

  promptForInput('Reply');
}

async function* streamPrompt(input: string) {
  const chunks: string[] = [];
  let resolver: (() => void) | null = null;

  let thinking = true;
  let done = false;

  chunks.push(pc.gray('Thinking...\n'));

  prompt(input, {
    onThinking: (chunk) => {
      chunks.push(pc.gray(chunk));
      resolver?.();
    },
    onContent: (chunk) => {
      if (thinking) {
        thinking = false;
        chunks.push('\n\n');
      }
      chunks.push(chunk);
      resolver?.();
    },
    onDone: () => {
      done = true;
      resolver?.();
    },
  });

  while (!done || chunks.length > 0) {
    if (chunks.length > 0) {
      yield chunks.shift()!;
    } else if (!done) {
      await new Promise<void>((r) => {
        resolver = r;
      });
    }
  }
}
