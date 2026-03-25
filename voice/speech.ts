import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElevenLabsClient } from 'elevenlabs';
import { get as getConfig } from '../config';

const config = await getConfig();

export type VoiceOption = { voice_id: string; name: string; category?: string };

export async function synthesizeToBuffer(
  text: string,
  options: { voiceId: string; useV3: boolean }
): Promise<Buffer> {
  if (!text.trim()) return Buffer.alloc(0);

  if (!options.voiceId) {
    throw new Error('Voice ID is required');
  }

  const elevenLabsClient = getClient();
  const audioStream = await elevenLabsClient.textToSpeech.convertAsStream(
    options.voiceId,
    {
      text,
      model_id: options.useV3 ? 'eleven_v3' : 'eleven_turbo_v2_5',
      output_format: 'mp3_22050_32',
    }
  );

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    const buffer =
      typeof chunk === 'string'
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Buffer);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function play(buffer: Buffer): Promise<void> {
  try {
    const audioPath = join(tmpdir(), `greg-voice-tts-${Date.now()}.mp3`);
    await fs.promises.writeFile(audioPath, buffer);

    try {
      await playAudioFile(audioPath);
    } finally {
      await fs.promises.unlink(audioPath).catch(() => {});
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error';
    throw new Error(`ElevenLabs TTS failed: ${message}`, {
      cause: error,
    });
  }
}

export async function listVoices(): Promise<VoiceOption[]> {
  const elevenLabsClient = getClient();
  const response = await elevenLabsClient.voices.getAll();
  const allVoices = (response as { voices?: unknown }).voices as
    | { voice_id?: string; name?: string; category?: string }[]
    | undefined;

  const voices = (allVoices ?? []).filter(
    (v) => typeof v.voice_id === 'string' && typeof v.name === 'string'
  ) as VoiceOption[];
  return voices;
}
function getApiKey(): string {
  const key = config.voice?.elevenlabs?.key;
  if (!key) {
    throw new Error(
      'Config voice.elevenlabs.key is not set. Add voice.elevenlabs.key (and voiceId) to your config.'
    );
  }
  return key;
}

let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
  client ??= new ElevenLabsClient({ apiKey: getApiKey() });
  return client;
}

function playAudioFile(audioPath: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const playerProcess = spawn('afplay', [audioPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    let settled = false;
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    playerProcess.on('error', (error) => {
      finish(
        new Error(
          `Failed to start audio player (afplay). Is it available?\n${String(error)}`
        )
      );
    });

    playerProcess.on('close', (code, signal) => {
      if (code === 0) finish(null);
      else
        finish(
          new Error(
            `Audio player exited with code ${code ?? 'unknown'}, signal ${signal ?? 'none'}`
          )
        );
    });
  });
}
