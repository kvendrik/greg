import { Command } from 'commander';
import { callWithTask } from './task';
import { validate as validateConfig } from './config';

export const voicecallCommand = new Command();

voicecallCommand
  .name('voicecall')
  .description('Voice call CLI')
  .version('0.0.0');

voicecallCommand
  .command('doctor')
  .description('Validate the config')
  .action(() => validateConfig());

voicecallCommand
  .command('call')
  .description('Place an outbound call')
  .requiredOption('--to <number>', 'Recipient phone number in E.164 format')
  .requiredOption(
    '--task <task>',
    'Drive the conversation until the task concludes then hang up'
  )
  .requiredOption(
    '--context <context>',
    'Additional background for the call (e.g. who you are, relationship, constraints)'
  )
  .action(async (opts: { to: string; task: string; context: string }) => {
    const { conclusion, timedout } = await callWithTask({
      ...opts,
      onStart: (callId) => {
        console.log(`Calling ${opts.to}: (${callId})`);
        console.log('─────────────────────────────');
        console.log(`Task: ${opts.task}`);
        console.log(`Context: ${opts.context}`);
        console.log('─────────────────────────────');
      },
      onConnect: () => {
        console.log('─────────────────────────────');
        console.log('Caller picked up.');
        console.log('─────────────────────────────');
      },
      onSpeech: (details) => {
        console.log(`${details.role}: ${details.text}`);
      },
    });
    console.log('─────────────────────────────');
    console.log(`Conclusion: ${conclusion}`);
    console.log('─────────────────────────────');
    process.exit(timedout ? 1 : 0);
  });
