import { spawn } from 'node:child_process';
import WebSocket from 'ws';

export type AvFoundationDevice = { index: number; name: string };

export async function listAvFoundationDevices(): Promise<
  AvFoundationDevice[] | null
> {
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

    listProcess.on('error', () => resolve(null));
    listProcess.on('close', () => {
      const output = Buffer.concat(stderrChunks).toString('utf8');
      const lines = output.split('\n');
      let inAudioSection = false;
      const results: AvFoundationDevice[] = [];
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
  });
}

export async function getMicrophoneName(
  deviceIndex: number
): Promise<string | null> {
  const devices = await listAvFoundationDevices();
  if (!devices) return null;
  const device = devices.find((d) => d.index === deviceIndex);
  return device?.name ?? null;
}

export function recordAudioChunk(
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

export type RealtimeTranscribeOptions = {
  apiKey: string;
  onPartial?: (text: string) => void;
  onCommitted?: (text: string) => void;
};

/**
 * Realtime speech-to-text from microphone using ElevenLabs Scribe (macOS only).
 * Stops after first committed transcript (single utterance) or on Enter.
 */
export function realtimeTranscribeFromMic(
  deviceIndex: number,
  options: RealtimeTranscribeOptions
): Promise<string | null> {
  const { apiKey, onPartial, onCommitted } = options;

  if (process.platform !== 'darwin') {
    return Promise.resolve(null);
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
      headers: { 'xi-api-key': apiKey },
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
          `Failed to start ffmpeg for realtime recording. Is ffmpeg installed and available on PATH?\n${message}`
        );
        ws.close();
        resolveOnce(null);
      });

      const startTime = Date.now();
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = (chunk: string) => {
        const elapsed = Date.now() - startTime;
        if (elapsed < 500 && chunk.trim() === '') return;
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
        return;
      }

      const message = parsed as {
        message_type?: string;
        text?: string;
        error?: string;
      };
      const type = message.message_type;

      if (type === 'session_started') return;

      if (type === 'partial_transcript' && typeof message.text === 'string') {
        onPartial?.(message.text);
      } else if (
        (type === 'committed_transcript' ||
          type === 'committed_transcript_with_timestamps') &&
        typeof message.text === 'string'
      ) {
        if (message.text.trim() === '') return;
        if (finalTranscript) finalTranscript += ' ';
        finalTranscript += message.text;
        onCommitted?.(message.text);
        ws.close();
        resolveOnce(finalTranscript.trim() || null);
      } else if (
        type &&
        (type.endsWith('error') || type === 'commit_throttled')
      ) {
        ws.close();
        resolveOnce(finalTranscript.trim() || null);
      }
    });

    ws.on('error', () => {
      resolveOnce(finalTranscript.trim() || null);
    });

    ws.on('close', () => {
      resolveOnce(finalTranscript.trim() || null);
    });
  });
}
