import { getModel } from '@mariozechner/pi-ai';

const missingEnvVars = Object.entries({
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
  ELEVENLABS_KEY: process.env.ELEVENLABS_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  NGROK_AUTHTOKEN: process.env.NGROK_AUTHTOKEN,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables for voice calling: ${missingEnvVars.join(
      ', '
    )}`
  );
}

export const config = {
  llm: getModel('anthropic', 'claude-sonnet-4-6'),

  port: 3334,
  maxCallDurationSeconds: 60 * 10, // 10 minutes,

  stt: {
    modelId: 'scribe_v2_realtime',
    audioFormat: 'ulaw_8000',
    commitStrategy: 'vad',
    languageCode: 'en',
    includeLanguageDetection: false,
    // Tuned for lower latency while still filtering brief noise.
    vadSilenceThresholdSecs: 0.6,
    vadThreshold: 0.5,
    minSpeechDurationMs: 150,
    minSilenceDurationMs: 100,
  },

  tts: {
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    useV3: false,
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_KEY,
  },

  ngrok: {
    authToken: process.env.NGROK_AUTHTOKEN,
  },
};
