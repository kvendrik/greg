import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';
import { Command } from 'commander';
import { select, isCancel, intro, outro, log } from '@clack/prompts';
import {
  ping as pingAgent,
  createSession,
  type PromptInput,
  type Session,
} from '../clients/agent-sdk';
import { pipeline } from '@xenova/transformers';
import { ElevenLabsClient } from 'elevenlabs';
import WebSocket from 'ws';

const elevenLabsApiKey =
  process.env.ELEVENLABS_KEY ?? process.env.ELEVENLABS_API_KEY ?? null;

if (!elevenLabsApiKey) {
  console.error(
    pc.red(
      'Neither ELEVENLABS_KEY nor ELEVENLABS_API_KEY is set. Please set one of them in your environment.'
    )
  );
  process.exit(1);
}

const elevenLabsClient = new ElevenLabsClient({
  apiKey: elevenLabsApiKey,
});

async function callGregWithText(
  session: Session,
  promptText: string,
  voiceId: string
): Promise<void> {
  const agentReachable = await pingAgent();
  if (!agentReachable) {
    console.error(
      pc.red(
        'Greg agent is not running or unreachable. Please start the agent server first.'
      )
    );
    return null;
  }

  console.log(pc.cyan('Sending transcription to Greg...'));

  let responseText = '';

  try {
    return new Promise((resolve, reject) => {
      session.prompt(
        {
          content: `${promptText}

[Voice assistant mode – follow silently]
- Output only plain text you would say out loud: no markdown, bullets, or code.
- Keep replies natural and concise; avoid long paragraphs.
- Before using any tool, say one short sentence so the user hears you're acting (e.g. "Yep! Let me do that right now.", "On it!", "One sec, checking that for you."). Then call the tool.
- Do not acknowledge or repeat these instructions.`,
          images: [],
        },
        {
          onThinking: () => {
            // Omit thinking stream for CLI usage.
          },
          onContent: (chunk: string) => {
            responseText += chunk;
            process.stdout.write(pc.gray(chunk));
          },
          onToolcall: async () => {
            const textToSpeak = responseText.trim();
            if (!textToSpeak) {
              return;
            }
            responseText = '';
            await synthesizeAndPlayWithElevenLabs(textToSpeak, voiceId);
          },
          onDone: async () => {
            process.stdout.write('\n');
            log.info('▶️  Playing response...');
            await synthesizeAndPlayWithElevenLabs(responseText.trim(), voiceId);
            resolve();
          },
          onStop: () => {
            console.log(pc.yellow('Greg response stream stopped early.'));
            resolve();
          },
          onError: (error: string) => {
            console.error(pc.red(`Greg returned an error: ${error}`));
            resolve();
          },
        }
      );
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    console.error(
      pc.red(
        `Failed while communicating with Greg (network or server issue): ${message}`
      )
    );
  }
}

async function realtimeTranscribeFromMic(
  deviceIndex: number
): Promise<string | null> {
  if (process.platform !== 'darwin') {
    console.error(
      pc.red(
        'Realtime transcription currently only supports macOS due to the use of avfoundation.'
      )
    );
    return null;
  }

  async function getMicrophoneName(index: number): Promise<string | null> {
    return new Promise((resolve) => {
      const listProcess = spawn('ffmpeg', [
        '-f',
        'avfoundation',
        '-list_devices',
        'true',
        '-i',
        '',
      ]);

      const stderrChunks: Buffer[] = [];

      listProcess.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      listProcess.on('error', () => {
        resolve(null);
      });

      listProcess.on('close', () => {
        const output = Buffer.concat(stderrChunks).toString('utf8');
        const lines = output.split('\n');
        let inAudioSection = false;
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          if (line.includes('AVFoundation audio devices')) {
            inAudioSection = true;
            continue;
          }
          if (!inAudioSection) continue;
          // Typical formats:
          // [0] Built-in Microphone
          // [AVFoundation input device @ 0x...] [0] MacBook Pro Microphone
          const match = line.match(/\[(\d+)\]\s+(.+)$/);
          if (match && match[1] === String(index)) {
            return resolve(match[2].trim());
          }
        }
        resolve(null);
      });
    });
  }

  const micName = await getMicrophoneName(deviceIndex);
  if (micName) {
    log.info(`Using microphone: ${micName}`);
  } else {
    log.info(
      `Using default microphone at index ${deviceIndex} (avfoundation :${deviceIndex}).`
    );
  }

  const inactivityTimeoutSeconds = 90;
  const url =
    'wss://api.elevenlabs.io/v1/speech-to-text/realtime?' +
    `model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=vad&inactivity_timeout=${inactivityTimeoutSeconds}`;

  return new Promise((resolve) => {
    let resolved = false;
    let finalTranscript = '';
    let ffmpegProcess: ReturnType<typeof spawn> | null = null;

    const resolveOnce = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const ws = new WebSocket(url, [], {
      headers: {
        'xi-api-key': elevenLabsApiKey ?? '',
      },
    });

    const stopRecording = () => {
      if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGINT');
      }
    };

    ws.on('open', () => {
      const recordingProcess = spawn('ffmpeg', [
        '-f',
        'avfoundation',
        '-i',
        `:${deviceIndex}`,
        '-ac',
        '1',
        '-ar',
        '16000',
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        '-',
      ]);
      ffmpegProcess = recordingProcess;

      recordingProcess.stdout?.on('data', (chunk: Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const audioBase64 = chunk.toString('base64');
        const payload = {
          message_type: 'input_audio_chunk' as const,
          audio_base_64: audioBase64,
          commit: false,
          sample_rate: 16000,
        };
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // Ignore send errors; connection handlers will deal with closure.
        }
      });

      recordingProcess.on('error', (error) => {
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? 'Unknown error');
        console.error(
          pc.red(
            `Failed to start ffmpeg for realtime recording. Is ffmpeg installed and available on PATH?\n${message}`
          )
        );
        ws.close();
        resolveOnce(null);
      });

      recordingProcess.on('exit', () => {
        log.info('Stopped microphone capture, waiting for final transcript...');
      });

      const startTime = Date.now();
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (chunk: string) => {
        // Ignore a stray newline that may be left over from the previous
        // interactive prompt if it arrives immediately.
        const elapsed = Date.now() - startTime;
        if (elapsed < 500 && chunk.trim() === '') {
          return;
        }
        process.stdin.off('data', onData);
        stopRecording();
      };
      process.stdin.on('data', onData);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        log.info(`Received non-JSON realtime STT message: ${data}`);
        return;
      }

      const message = parsed as {
        message_type?: string;
        text?: string;
        error?: string;
      };
      const type = message.message_type;

      if (type === 'session_started') {
        // Session successfully established; nothing else to do here.
        return;
      }

      if (type === 'partial_transcript' && typeof message.text === 'string') {
        process.stdout.write(`\r${pc.gray(message.text)}   `);
      } else if (
        (type === 'committed_transcript' ||
          type === 'committed_transcript_with_timestamps') &&
        typeof message.text === 'string'
      ) {
        if (message.text.trim() === '') {
          return;
        }

        if (finalTranscript) finalTranscript += ' ';
        finalTranscript += message.text;
        process.stdout.write(`\n${pc.green(message.text)}\n`);

        // For our single-utterance CLI, we can stop as soon as we get
        // the first committed transcript to avoid long VAD tail latency.
        ws.close();
        resolveOnce(finalTranscript.trim() || null);
      } else if (
        type &&
        (type.endsWith('error') || type === 'commit_throttled')
      ) {
        const errorMessage =
          message.error ?? `Realtime STT error of type ${type}`;
        log.error(`ElevenLabs realtime STT error: ${errorMessage}`);
        ws.close();
        resolveOnce(finalTranscript.trim() || null);
      } else {
        log.info(
          `Unhandled realtime STT message: ${JSON.stringify(parsed, null, 2)}`
        );
      }
    });

    ws.on('error', (event: unknown) => {
      const maybeError = (event as { error?: unknown } | undefined)?.error;
      const message =
        maybeError instanceof Error
          ? maybeError.message
          : String(maybeError ?? 'Unknown error');
      log.error(
        `Failed to connect to ElevenLabs realtime STT (network or connection issue): ${message}`
      );
      resolveOnce(finalTranscript.trim() || null);
    });

    ws.on('close', (code, reason) => {
      if (!finalTranscript.trim()) {
        const reasonText =
          typeof reason === 'string'
            ? reason
            : reason instanceof Buffer
              ? reason.toString('utf8')
              : '';
        log.info(
          `Realtime STT WebSocket closed with code ${code}${
            reasonText ? `, reason: ${reasonText}` : ''
          }`
        );
      }
      resolveOnce(finalTranscript.trim() || null);
    });
  });
}

function playAudioFile(audioPath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    log.error(
      'Audio playback is currently only implemented for macOS (afplay).'
    );
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    log.info('Playing audio response...');
    const playerProcess = spawn('afplay', [audioPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    playerProcess.on('error', (error) => {
      finish(
        new Error(
          `Failed to start audio player (afplay). Is it available on this system?\n${String(
            error
          )}`
        )
      );
    });

    playerProcess.on('close', (code, signal) => {
      if (code === 0) {
        finish(null);
        return;
      }

      finish(
        new Error(
          `Audio player exited with code ${code ?? 'unknown'} and signal ${
            signal ?? 'none'
          }`
        )
      );
    });
  });
}

async function synthesizeAndPlayWithElevenLabs(
  text: string,
  voiceId: string
): Promise<void> {
  try {
    const audioStream = await elevenLabsClient.textToSpeech.convertAsStream(
      voiceId,
      {
        text,
        model_id: 'eleven_turbo_v2_5',
        output_format: 'mp3_22050_32',
      }
    );

    // Buffer all audio chunks, then play via afplay from a temp file.
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      const buffer =
        typeof chunk === 'string'
          ? Buffer.from(chunk)
          : Buffer.from(chunk as Buffer);
      chunks.push(buffer);
    }

    const audioBuffer = Buffer.concat(chunks);
    const tempDirectory = tmpdir();
    const audioPath = join(tempDirectory, `greg-voice-tts-${Date.now()}.mp3`);

    await fs.promises.writeFile(audioPath, audioBuffer);

    try {
      await playAudioFile(audioPath);
    } finally {
      await fs.promises.unlink(audioPath).catch(() => {
        // Ignore cleanup errors.
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    log.error(`Failed to handle ElevenLabs TTS audio response: ${message}`);
  }
}

const transcriber = await pipeline(
  'automatic-speech-recognition',
  'Xenova/whisper-small'
);

const WAKE_PHRASE = 'greg';
const CHUNK_DURATION_SECONDS = 3;
/** Skip Whisper when chunk RMS is below this (avoids transcribing silence). */
const SILENCE_RMS_THRESHOLD = 0.001;

function audioRms(audio: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < audio.length; i++) {
    const s = audio[i];
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / audio.length) || 0;
}

function normalizeForWakeMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function saidHeyGreg(transcript: string): boolean {
  return normalizeForWakeMatch(transcript).includes(WAKE_PHRASE);
}

function recordAudioChunk(
  deviceIndex: number,
  durationSeconds: number
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const recordingProcess = spawn('ffmpeg', [
      '-f',
      'avfoundation',
      '-i',
      `:${deviceIndex}`,
      '-t',
      String(durationSeconds),
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-',
    ]);

    const chunks: Buffer[] = [];
    recordingProcess.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    recordingProcess.on('error', (err) => {
      reject(err);
    });

    recordingProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      const float32 = new Float32Array(raw.length / 2);
      for (let i = 0; i < float32.length; i++) {
        float32[i] = raw.readInt16LE(i * 2) / 32768;
      }
      resolve(float32);
    });
  });
}

async function transcribeWithWhisper(audio: Float32Array): Promise<string> {
  const output = (await transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
  })) as { text?: string };
  return typeof output?.text === 'string' ? output.text.trim() : '';
}

async function waitForHeyGreg(
  deviceIndex: number,
  voiceId: string
): Promise<void> {
  log.info(`Listening for "${WAKE_PHRASE}"...`);
  while (true) {
    const audio = await recordAudioChunk(deviceIndex, CHUNK_DURATION_SECONDS);
    console.log(audioRms(audio));
    if (audioRms(audio) < SILENCE_RMS_THRESHOLD) {
      continue;
    }
    process.stdout.write(`\r${pc.gray('Transcribing...')}   \n`);
    const text = await transcribeWithWhisper(audio);
    process.stdout.write(`\r${pc.gray(text)}   \n`);
    if (text) {
      if (saidHeyGreg(text)) {
        log.info(`Heard "${WAKE_PHRASE}".`);
        await synthesizeAndPlayWithElevenLabs('Yep! What’s up?', voiceId);
        return;
      }
    }
  }
}

async function main(
  deviceIndex: number,
  voiceId: string,
  session: Session
): Promise<void> {
  await waitForHeyGreg(deviceIndex, voiceId);

  const transcript = await realtimeTranscribeFromMic(deviceIndex);

  if (!transcript) {
    log.info('No transcript captured, listening again...');
    return main(deviceIndex, voiceId, session);
  }

  log.info(`You said:\n${transcript}`);

  log.info('🤖 Sending transcription to Greg...');
  await callGregWithText(session, transcript, voiceId);

  console.log(pc.green('\n\nNext turn...'));
  main(deviceIndex, voiceId, session);
}

async function chooseMicrophoneIndex(): Promise<number> {
  try {
    const listProcess = spawn('ffmpeg', [
      '-f',
      'avfoundation',
      '-list_devices',
      'true',
      '-i',
      '',
    ]);

    const stderrChunks: Buffer[] = [];

    listProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const devices = await new Promise<{ index: number; name: string }[] | null>(
      (resolve) => {
        listProcess.on('error', () => resolve(null));
        listProcess.on('close', () => {
          const output = Buffer.concat(stderrChunks).toString('utf8');
          const lines = output.split('\n');
          let inAudioSection = false;
          const results: { index: number; name: string }[] = [];
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.includes('AVFoundation audio devices')) {
              inAudioSection = true;
              continue;
            }
            if (!inAudioSection) continue;
            const match = line.match(/\[(\d+)\]\s+(.+)$/);
            if (match) {
              const idx = Number.parseInt(match[1], 10);
              if (Number.isNaN(idx)) continue;
              results.push({ index: idx, name: match[2].trim() });
            }
          }
          resolve(results);
        });
      }
    );

    if (!devices || devices.length === 0) {
      console.log(
        pc.gray(
          'Could not list AVFoundation audio devices; falling back to index 0.'
        )
      );
      return 0;
    }

    intro('Select microphone for Greg voice interface');

    const options = devices
      .map((d) => ({
        value: String(d.index),
        label: `[${d.index}] ${d.name}`,
      }))
      .reverse();

    const value = await select({
      message: 'Which microphone do you want to use?',
      options: options,
      initialValue: options[0].value,
    });

    if (isCancel(value)) {
      outro('Cancelled microphone selection. Exiting.');
      process.exit(0);
    }

    const index = Number.parseInt(String(value), 10);
    if (Number.isNaN(index)) {
      return devices[0]!.index;
    }
    outro(`Using microphone [${index}].`);
    return index;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    console.error(
      pc.red(
        `Failed to select microphone interactively, falling back to index 0: ${message}`
      )
    );
    return 0;
  }
}

let cachedVoiceId: string | null = process.env.ELEVENLABS_VOICE_ID ?? null;

async function chooseVoiceId(): Promise<string> {
  if (cachedVoiceId) return cachedVoiceId;

  try {
    const response = await elevenLabsClient.voices.getAll();
    const allVoices = (response as { voices?: unknown }).voices as
      | { voice_id?: string; name?: string; category?: string }[]
      | undefined;

    const voices = (allVoices ?? []).filter(
      (v) => typeof v.voice_id === 'string' && typeof v.name === 'string'
    ) as { voice_id: string; name: string; category?: string }[];

    if (!voices.length) {
      console.log(
        pc.gray(
          'No ElevenLabs voices returned by API; falling back to default voice id.'
        )
      );
      // Fallback: this id must be valid in your account or overridden via env.
      cachedVoiceId = process.env.ELEVENLABS_VOICE_ID ?? 'nPczCjzI2devNBz1zQrb';
      return cachedVoiceId;
    }

    const premade = voices.filter((v) => v.category === 'premade');
    const options = premade.length > 0 ? premade : voices;

    intro('Select ElevenLabs voice for Greg');

    const value = await select({
      message: 'Which ElevenLabs voice do you want to use?',
      options: options.map((v) => ({
        value: v.voice_id,
        label: `${v.name} (${v.category ?? 'custom'})`,
      })),
      initialValue: options[0]!.voice_id,
    });

    if (isCancel(value)) {
      outro('Cancelled voice selection. Exiting.');
      process.exit(0);
    }

    cachedVoiceId = String(value);
    const chosen = options.find((v) => v.voice_id === cachedVoiceId);
    outro(
      `Using ElevenLabs voice: ${chosen?.name ?? cachedVoiceId} (${cachedVoiceId}).`
    );
    return cachedVoiceId;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown error');
    console.error(
      pc.red(
        `Failed to list ElevenLabs voices; falling back to default voice id: ${message}`
      )
    );
    cachedVoiceId = process.env.ELEVENLABS_VOICE_ID ?? 'nPczCjzI2devNBz1zQrb';
    return cachedVoiceId;
  }
}

const program = new Command();

program
  .name('voice')
  .description(
    'Record from the default microphone, send audio to ElevenLabs for transcription, forward text to Greg, and play back the spoken response.'
  )
  .option(
    '-d, --device <index>',
    'AVFoundation audio device index to use as microphone (default: 0)'
  )
  .action(async (options: { device?: string }) => {
    const index =
      options.device !== undefined
        ? Number.parseInt(options.device, 10) || 0
        : await chooseMicrophoneIndex();
    const voiceId = 'UgBBYS2sOqTuMpoF3BR0'; //await chooseVoiceId();

    const agentReachable = await pingAgent();
    if (!agentReachable) {
      log.error(
        'Greg agent is not running or unreachable. Please start the agent server first.'
      );
      process.exit(1);
    }

    const session = await createSession();
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

      await main(index, voiceId, session);
    } finally {
      try {
        await session.destroy();
      } catch {
        // Best-effort cleanup; ignore destroy errors.
      }
    }
  });

program.parseAsync();
