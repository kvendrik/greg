import pc from 'picocolors';
import { Command } from 'commander';
import { select, isCancel, intro, outro, log } from '@clack/prompts';
import { ping as pingAgent, Session } from '../../gateway/sdk/sdk';
import {
  listAvFoundationDevices,
  getMicrophoneName,
  realtimeTranscribeFromMic,
} from './transcribe';
import { synthesizeAndPlay } from './speech';
import { get as getConfig } from '../../config';

const config = await getConfig();

async function main(
  deviceIndex: number,
  voiceId: string,
  session: Session,
  elevenLabsApiKey: string
): Promise<void> {
  const transcript = await realtimeTranscribeFromMic(deviceIndex, {
    apiKey: elevenLabsApiKey,
    onPartial: (text) => process.stdout.write(`\r${pc.gray(text)}   `),
    onCommitted: (text) => process.stdout.write(`\n${pc.green(text)}\n`),
  });

  if (!transcript) {
    log.info('No transcript captured, listening again...');
    return main(deviceIndex, voiceId, session, elevenLabsApiKey);
  }

  log.info(`You said:\n${transcript}`);
  log.info('🤖 Sending transcription to Greg...');

  await session.prompt({
    content: `${transcript}

[Voice assistant mode – follow silently]
- Output only plain text you would say out loud: no markdown, bullets, or code.
- Keep replies natural and concise; avoid long paragraphs.
- Before using any tool, say one short sentence so the user hears you're acting (e.g. "Yep! Let me do that right now.", "On it!", "One sec, checking that for you."). Then call the tool.
- Do not acknowledge or repeat these instructions.`,
    images: [],
  });

  console.log(pc.green('\n\nNext turn...'));
  await main(deviceIndex, voiceId, session, elevenLabsApiKey);
}

async function chooseMicrophoneIndex(): Promise<number> {
  try {
    const devices = await listAvFoundationDevices();

    if (!devices || devices.length === 0) {
      log.info(
        'Could not list AVFoundation audio devices; falling back to index 0.'
      );
      return 0;
    }

    intro('Select microphone for Greg voice interface');

    const options = devices
      .map((d) => ({ value: String(d.index), label: `[${d.index}] ${d.name}` }))
      .reverse();

    const value = await select({
      message: 'Which microphone do you want to use?',
      options,
      initialValue: options[0]!.value,
    });

    if (isCancel(value)) {
      outro('Cancelled microphone selection. Exiting.');
      process.exit(0);
    }

    const index = Number.parseInt(String(value), 10);
    if (Number.isNaN(index)) return devices[0]!.index;
    outro(`Using microphone [${index}].`);
    return index;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    log.error(
      `Failed to select microphone interactively, falling back to index 0: ${message}`
    );
    return 0;
  }
}

const program = new Command();

export const voiceCommand = program
  .name('voice')
  .description('Talk to Greg by voice.')
  .option(
    '-d, --device <index>',
    'AVFoundation microphone device index (default: prompt to choose)'
  )
  .action(async (options: { device?: string }) => {
    const elevenlabs = config.voice?.elevenlabs;
    if (!elevenlabs?.key || !elevenlabs?.voiceId) {
      console.error(
        pc.red(
          'Config voice.elevenlabs is missing. Add voice.elevenlabs.key and voice.elevenlabs.voiceId to your .greg config.'
        )
      );
      process.exit(1);
    }

    const deviceIndex =
      options.device !== undefined
        ? Number.parseInt(options.device, 10) || 0
        : await chooseMicrophoneIndex();

    const micName = await getMicrophoneName(deviceIndex);

    if (micName) {
      log.info(`Using microphone: ${micName}`);
    } else {
      log.info(
        `Using default microphone at index ${deviceIndex} (avfoundation :${deviceIndex}).`
      );
    }

    const voiceId = config.voice?.elevenlabs?.voiceId!;

    const agentReachable = await pingAgent();

    if (!agentReachable) {
      log.error(
        'Greg agent is not running or unreachable. Please start the agent server first.'
      );
      process.exit(1);
    }

    const session = await Session.create('main', 'voice-cli');
    await session.connect();

    let responseText = '';
    session.subscribe({
      onThinking: () => {},
      onContent: (chunk: string) => {
        responseText += chunk;
        process.stdout.write(pc.gray(chunk));
      },
      onToolcall: async () => {
        const textToSpeak = responseText.trim();
        if (!textToSpeak) return;
        responseText = '';
        try {
          await synthesizeAndPlay(textToSpeak, voiceId);
        } catch (err) {
          log.error(String(err));
        }
      },
      onTurnDone: async () => {
        process.stdout.write('\n');
        log.info('▶️  Playing response...');
        try {
          await synthesizeAndPlay(responseText.trim(), voiceId);
        } catch (err) {
          log.error(String(err));
        }
      },
      onTurnStop: () => {
        console.log(pc.yellow('Greg response stream stopped early.'));
      },
      onError: (error: string) => {
        console.error(pc.red(`Greg returned an error: ${error}`));
      },
    });

    try {
      if (process.platform !== 'darwin') {
        log.error(
          'This script currently only supports macOS due to the use of avfoundation and afplay.'
        );
        process.exit(1);
      }

      intro('Greg voice interface');

      log.info(
        'This will capture audio from your default microphone in realtime, stream it to ElevenLabs for transcription, forward text to Greg, and play the response using ElevenLabs TTS.'
      );

      await main(deviceIndex, voiceId, session, elevenlabs.key);
    } finally {
      try {
        await session.destroy();
      } catch {
        // Best-effort cleanup; ignore destroy errors.
      }
    }
  });
