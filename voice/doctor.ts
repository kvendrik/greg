import { spawnSync } from 'node:child_process';
import pc from 'picocolors';
import type { Config } from '../config';

export type VoiceCheckResult = { failures: string[] };

export async function checkVoice(config: Config): Promise<VoiceCheckResult> {
  const failures: string[] = [];
  const voiceKey = config.voice?.elevenlabs?.key;
  const voiceId = config.voice?.elevenlabs?.voiceId;

  console.log('');
  console.log(pc.bold('Voice'));

  // --- speech.ts (TTS + playback) ---
  console.log(pc.dim('  speech.ts (text-to-speech + playback)'));

  if (!voiceKey) {
    console.log(
      pc.yellow(
        '  ✗ voice.elevenlabs.key not set\n' +
          '    Impact: synthesizeToBuffer, listVoices, TUI /v, and `greg tg send --voice` will fail'
      )
    );
  } else {
    console.log(pc.green('  ✓ voice.elevenlabs.key'));

    try {
      const { ElevenLabsClient } = await import('elevenlabs');
      const client = new ElevenLabsClient({ apiKey: voiceKey });
      const response = await client.voices.getAll();
      const voices = (response as { voices?: unknown[] }).voices;
      if (!Array.isArray(voices)) throw new Error('Unexpected API response');
      console.log(
        pc.green(`  ✓ ElevenLabs API reachable (${voices.length} voices)`)
      );

      if (!voiceId) {
        console.log(
          pc.yellow(
            '  ✗ voice.elevenlabs.voiceId not set\n' +
              '    Impact: synthesizeToBuffer needs a voiceId — callers must provide one manually. Needed to send voice messages and voice calls.'
          )
        );
      } else {
        const match = voices.some(
          (v) =>
            typeof v === 'object' &&
            v !== null &&
            (v as { voice_id?: string }).voice_id === voiceId
        );
        if (match) {
          console.log(pc.green(`  ✓ voiceId "${voiceId}" found in account`));
        } else {
          console.log(
            pc.yellow(
              `  ✗ voiceId "${voiceId}" not found in your ElevenLabs account\n` +
                '    Impact: TTS calls will fail with an invalid voice error'
            )
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        pc.red(
          `  ✗ ElevenLabs API unreachable — ${msg}\n` +
            '    Impact: all TTS and voice listing will fail'
        )
      );
      failures.push('ElevenLabs');
    }
  }

  const afplayResult = spawnSync('which', ['afplay'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (afplayResult.status === 0) {
    console.log(pc.green('  ✓ afplay'));
  } else {
    console.log(
      pc.yellow(
        '  ✗ afplay not found (macOS only)\n' +
          '    Impact: play() will silently no-op — audio cannot be played locally'
      )
    );
  }

  // --- av.ts (mic recording + realtime transcription) ---
  console.log('');
  console.log(pc.dim('  av.ts (mic recording + realtime transcription)'));

  if (process.platform !== 'darwin') {
    console.log(
      pc.yellow(
        `  ✗ Platform is "${process.platform}", not "darwin"\n` +
          '    Impact: avfoundation is macOS-only — all av.ts functions will fail or return null'
      )
    );
  } else {
    console.log(pc.green('  ✓ macOS (avfoundation available)'));
  }

  const ffmpegResult = spawnSync('which', ['ffmpeg'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (ffmpegResult.status === 0) {
    console.log(pc.green(`  ✓ ffmpeg (${ffmpegResult.stdout.trim()})`));
  } else {
    console.log(
      pc.red(
        '  ✗ ffmpeg not found\n' +
          '    Impact: listAvFoundationDevices, recordAudioChunk, and realtimeTranscribeFromMic all fail'
      )
    );
  }

  if (!voiceKey) {
    console.log(
      pc.yellow(
        '  ✗ voice.elevenlabs.key not set\n' +
          '    Impact: realtimeTranscribeFromMic needs an API key for the ElevenLabs Scribe WebSocket'
      )
    );
  } else {
    console.log(pc.green('  ✓ ElevenLabs API key (for Scribe STT)'));
  }

  return { failures };
}
