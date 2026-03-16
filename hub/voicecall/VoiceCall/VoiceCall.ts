import { config } from '../config';
import twilio from 'twilio';
import ngrok from '@ngrok/ngrok';
import { WebSocket } from 'ws';
import { ElevenLabsClient } from 'elevenlabs';

// ─── Clients ──────────────────────────────────────────────────────────────────

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const elevenLabsClient = new ElevenLabsClient({
  apiKey: config.elevenlabs.apiKey,
});

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(message: string) {
  const entry = `[${new Date().toISOString()}] ${message}`;
  console.log(entry);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallMode = 'notify' | 'conversation';
export type CallStatus = 'initiating' | 'in-progress' | 'completed' | 'failed';

export interface CallResult {
  callId: string;
  status: CallStatus;
  transcript: string[];
}

interface Call {
  callId: string;
  to: string;
  mode: CallMode;
  status: CallStatus;
  transcript: string[];
  startedAt: Date;
}

interface CallState {
  call: Call;
  ws: import('bun').ServerWebSocket<WsData>;
  streamSid: string;
  sttConnection: WebSocket;
  maxDurationTimer: ReturnType<typeof setTimeout>;
}

interface WsData {
  sttConnection: WebSocket | null;
  streamSid: string;
  callId: string;
  startReceived: boolean;
  pendingDecremented: boolean;
}

// ─── State ────────────────────────────────────────────────────────────────────

const pendingCalls = new Map<string, Call>();
const activeCalls = new Map<string, CallState>();

const replayNonces = new Map<string, number>();
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const REPLAY_MAX_NONCES = 5000;

const WS_PRE_START_TIMEOUT_MS = 5000;
const WS_MAX_PENDING = 32;
const WS_MAX_CONNECTIONS = 128;
let wsPendingCount = 0;
let wsTotalCount = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActiveCall(callId: string): CallState {
  const state = activeCalls.get(callId);
  if (!state) {
    if (pendingCalls.has(callId))
      throw new Error(`Call ${callId} is still connecting`);
    throw new Error(`No active call: ${callId}`);
  }
  return state;
}

function getCall(callId: string): Call {
  const call = activeCalls.get(callId)?.call ?? pendingCalls.get(callId);
  if (!call) throw new Error(`No call found: ${callId}`);
  return call;
}

function toResult(call: Call): CallResult {
  return {
    callId: call.callId,
    status: call.status,
    transcript: call.transcript,
  };
}

function verifyTwilioSignature(req: Request, rawBody: string): boolean {
  const signature = req.headers.get('x-twilio-signature');
  if (!signature) return false;
  const url = new URL(req.url);
  if (!publicUrl) return false;
  const fullUrl = publicUrl + url.pathname + url.search;
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  return twilio.validateRequest(
    config.twilio.authToken || '',
    signature,
    fullUrl,
    params
  );
}

function checkReplay(
  callSid: string,
  callStatus: string,
  timestamp: number
): boolean {
  const now = Date.now();
  const hasTimestamp = Number.isFinite(timestamp) && timestamp > 0;

  const nonce = hasTimestamp
    ? `${callSid}:${callStatus}:${timestamp}`
    : `${callSid}:${callStatus}`;

  const seenAt = replayNonces.get(nonce);
  if (seenAt && now - seenAt <= REPLAY_WINDOW_MS) return false;

  if (replayNonces.size >= REPLAY_MAX_NONCES) {
    for (const [key, ts] of replayNonces) {
      if (now - ts > REPLAY_WINDOW_MS) replayNonces.delete(key);
    }
  }

  replayNonces.set(nonce, now);
  return true;
}

async function speakText(state: CallState, text: string): Promise<void> {
  if (state.ws.readyState !== 1) {
    log(`[${state.call.callId}] Skipping TTS — WebSocket not open`);
    return;
  }

  try {
    const audioStream = await elevenLabsClient.textToSpeech.convertAsStream(
      config.tts.voiceId!,
      {
        text,
        model_id: config.tts.useV3 ? 'eleven_v3' : 'eleven_flash_v2_5',
        output_format: 'ulaw_8000',
      }
    );

    for await (const chunk of audioStream) {
      if (state.ws.readyState !== 1) break;
      state.ws.send(
        JSON.stringify({
          event: 'media',
          streamSid: state.streamSid,
          media: { payload: Buffer.from(chunk).toString('base64') },
        })
      );
    }
  } catch (err: any) {
    log(`[${state.call.callId}] TTS error: ${err.message}`);
  }
}

function openSttConnection(
  callId: string,
  onTranscript: (text: string) => void
): WebSocket {
  const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
  url.searchParams.set('model_id', config.stt.modelId);
  url.searchParams.set('audio_format', config.stt.audioFormat);
  url.searchParams.set('commit_strategy', config.stt.commitStrategy);

  if (config.stt.languageCode) {
    url.searchParams.set('language_code', config.stt.languageCode);
  }
  if (typeof config.stt.includeLanguageDetection === 'boolean') {
    url.searchParams.set(
      'include_language_detection',
      String(config.stt.includeLanguageDetection)
    );
  }
  if (typeof config.stt.vadSilenceThresholdSecs === 'number') {
    url.searchParams.set(
      'vad_silence_threshold_secs',
      String(config.stt.vadSilenceThresholdSecs)
    );
  }
  if (typeof config.stt.vadThreshold === 'number') {
    url.searchParams.set('vad_threshold', String(config.stt.vadThreshold));
  }
  if (typeof config.stt.minSpeechDurationMs === 'number') {
    url.searchParams.set(
      'min_speech_duration_ms',
      String(config.stt.minSpeechDurationMs)
    );
  }
  if (typeof config.stt.minSilenceDurationMs === 'number') {
    url.searchParams.set(
      'min_silence_duration_ms',
      String(config.stt.minSilenceDurationMs)
    );
  }

  const ws = new WebSocket(url.toString(), {
    headers: { 'xi-api-key': config.elevenlabs.apiKey },
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.message_type === 'committed_transcript' && msg.text?.trim()) {
      onTranscript(msg.text.trim());
    }
  });

  ws.on('error', (err) => log(`[${callId}] STT error: ${err.message}`));
  ws.on('close', () => log(`[${callId}] STT connection closed`));

  return ws;
}

async function cleanupCall(callId: string, status: CallStatus) {
  const state = activeCalls.get(callId);
  const call = state?.call ?? pendingCalls.get(callId);
  if (!call) return;

  call.status = status;

  if (state) {
    clearTimeout(state.maxDurationTimer);
    state.sttConnection.close();
    activeCalls.delete(callId);
  }
  pendingCalls.delete(callId);

  log(`Call ${status}: ${callId}`);
}

// ─── Public SDK ───────────────────────────────────────────────────────────────

export const voice = {
  async initiate_call(options: { to: string }): Promise<CallResult> {
    await ensureServer();
    const { to } = options;
    const { sid: callId } = await twilioClient.calls.create({
      to,
      from: config.twilio.fromNumber || '',
      url: `${publicUrl}/voice/webhook?mode=conversation`,
      statusCallback: `${publicUrl}/voice/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed', 'failed', 'no-answer', 'canceled'],
    });

    const call: Call = {
      callId,
      to,
      mode: 'conversation',
      status: 'initiating',
      transcript: [],
      startedAt: new Date(),
    };

    pendingCalls.set(callId, call);
    log(`Call initiated: ${callId} → ${to} (conversation)`);
    return toResult(call);
  },

  async speak_to_user(callId: string, message: string): Promise<void> {
    await ensureServer();
    const state = getActiveCall(callId);
    await speakText(state, message);
  },

  async end_call(callId: string): Promise<CallResult> {
    await ensureServer();
    const call = getCall(callId);
    await twilioClient
      .calls(callId)
      .update({ status: 'completed' })
      .catch(() => {});
    await cleanupCall(callId, 'completed');
    return toResult(call);
  },

  get_status(callId: string): CallResult {
    // Does not require server; just returns last known state
    return toResult(getCall(callId));
  },
};

// ─── High-level helper ────────────────────────────────────────────────────────

type SpeechHandler = (said: string) => void;
type AcceptHandler = () => void;
type EndHandler = () => void | Promise<void>;

export class VoiceCall {
  static async create(options: { to: string }): Promise<VoiceCall> {
    return new VoiceCall(options.to);
  }

  private readonly to: string;
  private callId: string | null = null;
  private lastTranscriptLength = 0;
  private speechHandlers = new Set<SpeechHandler>();
  private acceptHandlers = new Set<AcceptHandler>();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  private accepted = false;
  private endHandlers = new Set<EndHandler>();

  private constructor(to: string) {
    this.to = to;
  }

  get id(): string | null {
    return this.callId;
  }

  async connect(): Promise<void> {
    if (this.callId) return;
    const { callId } = await voice.initiate_call({ to: this.to });
    this.callId = callId;
    this.startPolling();
  }

  onAccept(handler: AcceptHandler): this {
    this.acceptHandlers.add(handler);
    return this;
  }

  onSpeech(handler: SpeechHandler): this {
    this.speechHandlers.add(handler);
    return this;
  }

  onEnd(handler: EndHandler): this {
    this.endHandlers.add(handler);
    return this;
  }

  async speak(message: string): Promise<void> {
    if (this.ended || !this.callId) return;
    await voice.speak_to_user(this.callId, message);
  }

  async end(): Promise<CallResult> {
    if (!this.callId) {
      throw new Error('Cannot end call before connect() has been called.');
    }
    if (this.ended) return voice.get_status(this.callId);
    this.ended = true;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    const result = await voice.end_call(this.callId);
    this.fireEnd();
    return result;
  }

  async waitForStatus(
    targetStatus: CallStatus,
    options?: { timeoutMs?: number }
  ): Promise<void> {
    if (!this.callId) {
      throw new Error('Cannot waitForStatus before connect() has been called.');
    }
    const callId = this.callId;
    const timeoutMs = options?.timeoutMs ?? 120_000;
    const intervalMs = 500;
    const start = Date.now();

    // Poll synchronously with a timeout and explicit terminal state handling.
    // This will throw if the call fails or never reaches the target status.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { status } = voice.get_status(callId);

      if (status === targetStatus) {
        return;
      }

      if (status === 'completed' || status === 'failed') {
        throw new Error(
          `Call ${callId} reached terminal status '${status}' before '${targetStatus}'.`
        );
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for call ${callId} to reach status '${targetStatus}'.`
        );
      }

      await Bun.sleep(intervalMs);
    }
  }

  private fireEnd() {
    if (this.endHandlers.size === 0) return;
    for (const handler of this.endHandlers) {
      try {
        handler();
      } catch {
        // ignore handler errors
      }
    }
  }

  private startPolling(intervalMs = 500) {
    if (!this.callId) return;
    const callId = this.callId;

    this.pollingTimer = setInterval(() => {
      if (this.ended) {
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
        return;
      }

      let result: CallResult;
      try {
        result = voice.get_status(callId);
      } catch {
        return;
      }

      if (!this.accepted && result.status === 'in-progress') {
        this.accepted = true;
        for (const handler of this.acceptHandlers) {
          handler();
        }
      }

      if (result.status === 'completed') {
        this.ended = true;
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
        this.fireEnd();
      }

      const newLines = result.transcript.slice(this.lastTranscriptLength);
      if (!newLines.length) return;

      this.lastTranscriptLength = result.transcript.length;

      const callerText = newLines
        .filter((line) => line.startsWith('caller:'))
        .map((line) => line.replace('caller: ', ''))
        .join(' ')
        .trim();

      if (!callerText) return;

      for (const handler of this.speechHandlers) {
        handler(callerText);
      }
    }, intervalMs);
  }
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

let publicUrl: string | null = null;
let serverStarted = false;

async function ensureServer() {
  if (serverStarted) return;
  const listener = await ngrok.forward({
    addr: config.port,
    authtoken: config.ngrok.authToken,
  });
  publicUrl = listener.url()!;
  log(`Public URL: ${publicUrl}`);

  Bun.serve<WsData>({
    port: config.port,

    async fetch(req, server) {
      const url = new URL(req.url);
      const { method } = req;
      const { pathname } = url;

      const callIdMatch = pathname.match(/^\/calls\/([^/]+)$/);
      const speakMatch = pathname.match(/^\/calls\/([^/]+)\/speak$/);

      try {
        if (method === 'POST' && pathname === '/voice/webhook') {
          const rawBody = await req.text();

          if (!verifyTwilioSignature(req, rawBody)) {
            log('Rejected webhook — invalid Twilio signature');
            return new Response('Forbidden', { status: 403 });
          }

          const params = new URLSearchParams(rawBody);
          const callSid = params.get('CallSid') ?? '';
          const callStatus = params.get('CallStatus') ?? '';
          const timestamp =
            parseInt(req.headers.get('x-twilio-timestamp') ?? '0') * 1000;

          if (!checkReplay(callSid, callStatus, timestamp)) {
            log(`Rejected replayed webhook: ${callSid}`);
            return new Response('Forbidden', { status: 403 });
          }

          const message = url.searchParams.get('message') ?? 'Hello!';
          const mode = (url.searchParams.get('mode') ??
            'conversation') as CallMode;
          const twiml = new twilio.twiml.VoiceResponse();

          if (mode === 'notify') {
            twiml.say(message);
            twiml.hangup();
          } else if (publicUrl) {
            const stream = twiml.connect().stream({
              url: `${publicUrl.replace('https://', 'wss://')}/voice/stream`,
            });
            stream.parameter({ name: 'message', value: message });
          }

          return new Response(twiml.toString(), {
            headers: { 'Content-Type': 'text/xml' },
          });
        }

        if (method === 'POST' && pathname === '/voice/status') {
          const rawBody = await req.text();

          if (!verifyTwilioSignature(req, rawBody)) {
            log('Rejected status callback — invalid Twilio signature');
            return new Response('Forbidden', { status: 403 });
          }

          const params = new URLSearchParams(rawBody);
          const callSid = params.get('CallSid') ?? '';
          const callStatus = params.get('CallStatus') ?? '';
          const timestamp =
            parseInt(req.headers.get('x-twilio-timestamp') ?? '0') * 1000;

          if (!checkReplay(callSid, callStatus, timestamp)) {
            return new Response('OK', { status: 200 });
          }

          const terminalStatuses = [
            'completed',
            'failed',
            'no-answer',
            'canceled',
            'busy',
          ];
          if (terminalStatuses.includes(callStatus)) {
            await cleanupCall(
              callSid,
              callStatus === 'completed' ? 'completed' : 'failed'
            );
          }

          return new Response('OK', { status: 200 });
        }

        if (pathname === '/voice/stream') {
          if (wsTotalCount >= WS_MAX_CONNECTIONS) {
            log(`Rejected WebSocket — max connections (${WS_MAX_CONNECTIONS})`);
            return new Response('Service Unavailable', { status: 503 });
          }
          if (wsPendingCount >= WS_MAX_PENDING) {
            log(`Rejected WebSocket — max pending (${WS_MAX_PENDING})`);
            return new Response('Service Unavailable', { status: 503 });
          }
          server.upgrade(req, {
            data: {
              sttConnection: null,
              streamSid: '',
              callId: '',
              startReceived: false,
              pendingDecremented: false,
            },
          });
          return undefined;
        }

        if (method === 'POST' && speakMatch) {
          const { message } = (await req.json()) as { message: string };
          await voice.speak_to_user(speakMatch[1], message);
          return new Response(null, { status: 204 });
        }
        if (method === 'DELETE' && callIdMatch) {
          return Response.json(await voice.end_call(callIdMatch[1]));
        }

        return new Response('Not found', { status: 404 });
      } catch (err: any) {
        log(`Error handling ${method} ${pathname}: ${err.message}`);
        return Response.json({ error: err.message }, { status: 500 });
      }
    },

    websocket: {
      open(ws) {
        wsPendingCount++;
        wsTotalCount++;
        ws.data = {
          sttConnection: null,
          streamSid: '',
          callId: '',
          startReceived: false,
          pendingDecremented: false,
        };

        setTimeout(() => {
          if (!ws.data.startReceived) {
            log('Closing WebSocket — no start frame within timeout');
            ws.close();
          }
        }, WS_PRE_START_TIMEOUT_MS);
      },

      async message(ws, raw) {
        const msg = JSON.parse(raw as string);

        if (msg.event === 'start') {
          if (!ws.data.pendingDecremented) {
            wsPendingCount = Math.max(0, wsPendingCount - 1);
            ws.data.pendingDecremented = true;
          }
          ws.data.startReceived = true;

          const callSid: string = msg.start.callSid;
          const streamSid: string = msg.start.streamSid;
          const greeting: string =
            msg.start.customParameters?.message ?? 'Hello!';

          const call = pendingCalls.get(callSid);
          if (!call) {
            log(`Stream start for unknown call: ${callSid} — closing`);
            ws.close();
            return;
          }

          const sttConnection = openSttConnection(
            callSid,
            async (transcript) => {
              const state = activeCalls.get(callSid);
              if (!state) return;
              state.call.transcript.push(`caller: ${transcript}`);
            }
          );

          const maxDurationTimer = setTimeout(async () => {
            log(`[${callSid}] Max duration — ending call`);
            await voice.end_call(callSid).catch(() => {});
          }, config.maxCallDurationSeconds * 1000);

          const state: CallState = {
            call,
            ws,
            streamSid,
            sttConnection,
            maxDurationTimer,
          };

          ws.data.sttConnection = sttConnection;
          ws.data.streamSid = streamSid;
          ws.data.callId = callSid;

          pendingCalls.delete(callSid);
          activeCalls.set(callSid, state);
          call.status = 'in-progress';

          log(`Call connected: ${callSid}`);
        }

        if (msg.event === 'media') {
          const audio = Buffer.from(msg.media.payload, 'base64');
          if (ws.data.sttConnection?.readyState === WebSocket.OPEN) {
            ws.data.sttConnection.send(
              JSON.stringify({
                message_type: 'input_audio_chunk',
                audio_base_64: audio.toString('base64'),
              })
            );
          }
        }

        if (msg.event === 'stop') {
          await cleanupCall(ws.data.callId, 'completed');
        }
      },

      close(ws) {
        wsTotalCount = Math.max(0, wsTotalCount - 1);
        if (!ws.data.pendingDecremented) {
          wsPendingCount = Math.max(0, wsPendingCount - 1);
          ws.data.pendingDecremented = true;
        }
        const callId = ws.data.callId;
        const hasActiveCall = callId && activeCalls.has(callId);
        ws.data.sttConnection?.close();
        if (hasActiveCall && callId) {
          cleanupCall(callId, 'completed').catch(() => {});
        }
      },
    },
  });

  log(`Voice server running on port ${config.port}`);
  serverStarted = true;
}
