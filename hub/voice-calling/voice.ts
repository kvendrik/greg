import twilio from 'twilio';
import ngrok from '@ngrok/ngrok';
import { WebSocket } from 'ws';
import { ElevenLabsClient } from 'elevenlabs';
import { EventEmitter } from 'events';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { config } from './config';

// ─── Clients ──────────────────────────────────────────────────────────────────

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
const elevenLabsClient = new ElevenLabsClient({
  apiKey: config.elevenlabs.apiKey,
});

const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);
const llmModel = getModel(config.llm.provider, config.llm.model);

// ─── Logging ──────────────────────────────────────────────────────────────────

const logBuffer: string[] = [];
const logSubscribers = new Set<(line: string) => void>();

function log(message: string) {
  const entry = `[${new Date().toISOString()}] ${message}`;
  logBuffer.push(entry);
  if (logBuffer.length > 500) logBuffer.shift();
  logSubscribers.forEach((fn) => fn(entry));
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
  agentSession: Awaited<ReturnType<typeof createAgentSession>>['session'];
  ttsAbortController: AbortController | null;
  silenceFillerTimer: ReturnType<typeof setTimeout> | null;
  maxDurationTimer: ReturnType<typeof setTimeout>;
  respondingPromise: Promise<void> | null;
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

export const callEvents = new EventEmitter();

const replayNonces = new Map<string, number>();
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const REPLAY_MAX_NONCES = 5000;

const WS_PRE_START_TIMEOUT_MS = 5000;
const WS_MAX_PENDING = 32;
const WS_MAX_CONNECTIONS = 128;
let wsPendingCount = 0;
let wsTotalCount = 0;

const SILENCE_FILLER_THRESHOLD_MS = 3500;
const SILENCE_FILLER_TEXT = "One moment please, I'm looking into that for you.";
const LLM_RESPONSE_TIMEOUT_MS = 30_000;

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
  const fullUrl = publicUrl + url.pathname + url.search;
  const params = Object.fromEntries(new URLSearchParams(rawBody));
  return twilio.validateRequest(
    config.twilio.authToken,
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
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_MS) return false;

  const nonce = `${callSid}:${callStatus}:${timestamp}`;
  if (replayNonces.has(nonce)) return false;

  if (replayNonces.size >= REPLAY_MAX_NONCES) {
    for (const [key, ts] of replayNonces) {
      if (now - ts > REPLAY_WINDOW_MS) replayNonces.delete(key);
    }
  }

  replayNonces.set(nonce, now);
  return true;
}

async function speakText(
  state: CallState,
  text: string,
  abortSignal?: AbortSignal
): Promise<void> {
  if (state.ws.readyState !== 1) {
    log(`[${state.call.callId}] Skipping TTS — WebSocket not open`);
    return;
  }

  try {
    const audioStream = await elevenLabsClient.textToSpeech.convertAsStream(
      config.tts.voiceId,
      {
        text,
        model_id: config.tts.modelId,
        output_format: config.tts.outputFormat,
      }
    );

    for await (const chunk of audioStream) {
      if (abortSignal?.aborted) break;
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
    if (err?.name !== 'AbortError') {
      log(`[${state.call.callId}] TTS error: ${err.message}`);
    }
  }
}

function clearTwilioAudioBuffer(state: CallState) {
  if (state.ws.readyState === 1) {
    state.ws.send(
      JSON.stringify({ event: 'clear', streamSid: state.streamSid })
    );
  }
}

function startSilenceFiller(state: CallState) {
  clearSilenceFiller(state);
  state.silenceFillerTimer = setTimeout(async () => {
    log(`[${state.call.callId}] Playing silence filler`);
    await speakText(
      state,
      SILENCE_FILLER_TEXT,
      state.ttsAbortController?.signal
    );
  }, SILENCE_FILLER_THRESHOLD_MS);
}

function clearSilenceFiller(state: CallState) {
  if (state.silenceFillerTimer) {
    clearTimeout(state.silenceFillerTimer);
    state.silenceFillerTimer = null;
  }
}

async function generateAndSpeak(
  state: CallState,
  userText: string
): Promise<void> {
  if (state.respondingPromise) {
    if (state.ttsAbortController) {
      log(`[${state.call.callId}] Barge-in — interrupting agent`);
      state.ttsAbortController.abort();
      clearTwilioAudioBuffer(state);
      clearSilenceFiller(state);
    }
    await state.respondingPromise;
  }

  let resolveMutex!: () => void;
  state.respondingPromise = new Promise((r) => {
    resolveMutex = r;
  });
  state.ttsAbortController = new AbortController();
  const { signal } = state.ttsAbortController;

  startSilenceFiller(state);

  try {
    const reply = await Promise.race([
      new Promise<string>((resolve) => {
        let text = '';
        const unsubscribe = state.agentSession.subscribe((event) => {
          if (
            event.type === 'message_update' &&
            event.assistantMessageEvent?.type === 'text_delta'
          ) {
            text += event.assistantMessageEvent.delta;
          }
          if (event.type === 'agent_end') {
            unsubscribe();
            resolve(text.trim());
          }
        });
        state.agentSession.prompt(userText);
      }),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error('LLM response timeout')),
          LLM_RESPONSE_TIMEOUT_MS
        )
      ),
    ]);

    clearSilenceFiller(state);
    if (signal.aborted) return;

    if (!reply) {
      log(`[${state.call.callId}] Empty LLM reply, skipping TTS`);
      return;
    }

    state.call.transcript.push(`agent: ${reply}`);
    log(`[${state.call.callId}] Agent: ${reply}`);
    await speakText(state, reply, signal);
  } catch (err: any) {
    clearSilenceFiller(state);
    if (err?.name === 'AbortError') return;
    log(`[${state.call.callId}] LLM error: ${err.message}`);
    if (!signal.aborted) {
      await speakText(
        state,
        "Sorry, I'm having trouble responding right now. Please try again.",
        signal
      );
    }
  } finally {
    clearSilenceFiller(state);
    state.ttsAbortController = null;
    state.respondingPromise = null;
    resolveMutex();
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

async function createCallSession(systemPrompt: string) {
  const fullPrompt = `${systemPrompt}

Important: You are speaking to a caller over the phone. Your responses will be
read aloud by a text-to-speech engine. Always write as if you are speaking:
- Say "2 thirty PM" not "14:30"
- Say "13 degrees Celsius" not "13°C"
- Say "February 5th" not "02/05"
- Never use markdown, bullet points, or symbols
- Keep responses to 1-2 natural spoken sentences`;

  const resourceLoader = new DefaultResourceLoader({
    systemPromptOverride: () => fullPrompt,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    model: llmModel,
    thinkingLevel: 'off',
    tools: [],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });
  return session;
}

async function cleanupCall(callId: string, status: CallStatus) {
  const state = activeCalls.get(callId);
  const call = state?.call ?? pendingCalls.get(callId);
  if (!call) return;

  call.status = status;

  if (state) {
    clearSilenceFiller(state);
    state.ttsAbortController?.abort();
    clearTimeout(state.maxDurationTimer);
    state.sttConnection.close();
    state.agentSession.dispose();
    activeCalls.delete(callId);
  }
  pendingCalls.delete(callId);

  callEvents.emit('end', toResult(call));
  log(`Call ${status}: ${callId}`);
}

// ─── Public SDK ───────────────────────────────────────────────────────────────

export const voice = {
  async initiate_call(options: {
    to: string;
    message: string;
    mode?: CallMode;
  }): Promise<CallResult> {
    const { to, message, mode = 'conversation' } = options;

    const { sid: callId } = await twilioClient.calls.create({
      to,
      from: config.twilio.fromNumber,
      url: `${publicUrl}/voice/webhook?message=${encodeURIComponent(message)}&mode=${mode}`,
      statusCallback: `${publicUrl}/voice/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed', 'failed', 'no-answer', 'canceled'],
    });

    const call: Call = {
      callId,
      to,
      mode,
      status: 'initiating',
      transcript: [],
      startedAt: new Date(),
    };

    pendingCalls.set(callId, call);
    log(`Call initiated: ${callId} → ${to} (${mode})`);
    return toResult(call);
  },

  async continue_call(callId: string, message: string): Promise<CallResult> {
    const state = getActiveCall(callId);
    await generateAndSpeak(state, message);
    return toResult(state.call);
  },

  async speak_to_user(callId: string, message: string): Promise<void> {
    const state = getActiveCall(callId);
    await speakText(state, message);
  },

  async end_call(callId: string): Promise<CallResult> {
    const call = getCall(callId);
    await twilioClient
      .calls(callId)
      .update({ status: 'completed' })
      .catch(() => {});
    await cleanupCall(callId, 'completed');
    return toResult(call);
  },

  get_status(callId: string): CallResult {
    return toResult(getCall(callId));
  },

  onCallEnd(handler: (result: CallResult) => void): () => void {
    callEvents.on('end', handler);
    return () => callEvents.off('end', handler);
  },
};

// ─── Tunnel ───────────────────────────────────────────────────────────────────

const listener = await ngrok.forward({
  addr: config.port,
  authtoken_from_env: true,
});
const publicUrl = listener.url()!;
log(`Public URL: ${publicUrl}`);

// ─── Server ───────────────────────────────────────────────────────────────────

Bun.serve<WsData>({
  port: config.port,

  async fetch(req, server) {
    const url = new URL(req.url);
    const { method } = req;
    const { pathname } = url;

    const callIdMatch = pathname.match(/^\/calls\/([^/]+)$/);
    const continueMatch = pathname.match(/^\/calls\/([^/]+)\/continue$/);
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
        } else {
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

      if (method === 'POST' && pathname === '/calls') {
        return Response.json(await voice.initiate_call(await req.json()));
      }
      if (method === 'POST' && continueMatch) {
        const { message } = await req.json();
        return Response.json(
          await voice.continue_call(continueMatch[1], message)
        );
      }
      if (method === 'POST' && speakMatch) {
        const { message } = await req.json();
        await voice.speak_to_user(speakMatch[1], message);
        return new Response(null, { status: 204 });
      }
      if (method === 'DELETE' && callIdMatch) {
        return Response.json(await voice.end_call(callIdMatch[1]));
      }
      if (method === 'GET' && callIdMatch) {
        return Response.json(voice.get_status(callIdMatch[1]));
      }

      if (method === 'GET' && pathname === '/logs') {
        let removeSubscriber: () => void;
        const stream = new ReadableStream({
          start(controller) {
            logBuffer.forEach((line) =>
              controller.enqueue(`data: ${line}\n\n`)
            );
            const fn = (line: string) =>
              controller.enqueue(`data: ${line}\n\n`);
            logSubscribers.add(fn);
            removeSubscriber = () => logSubscribers.delete(fn);
          },
          cancel() {
            removeSubscriber?.();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
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

        const agentSession = await createCallSession(
          'You are a friendly voice assistant on a phone call.'
        );

        const sttConnection = openSttConnection(callSid, async (transcript) => {
          const state = activeCalls.get(callSid);
          if (!state) return;
          state.call.transcript.push(`caller: ${transcript}`);
          log(`[${callSid}] Caller: ${transcript}`);
          await generateAndSpeak(state, transcript);
        });

        const maxDurationTimer = setTimeout(async () => {
          log(`[${callSid}] Max duration — ending call`);
          await voice.end_call(callSid).catch(() => {});
        }, config.maxCallDurationSeconds * 1000);

        const state: CallState = {
          call,
          ws,
          streamSid,
          sttConnection,
          agentSession,
          ttsAbortController: null,
          silenceFillerTimer: null,
          maxDurationTimer,
          respondingPromise: null,
        };

        ws.data.sttConnection = sttConnection;
        ws.data.streamSid = streamSid;
        ws.data.callId = callSid;

        pendingCalls.delete(callSid);
        activeCalls.set(callSid, state);
        call.status = 'in-progress';

        log(`Call connected: ${callSid}`);
        await generateAndSpeak(state, greeting);
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
      ws.data.sttConnection?.close();
    },
  },
});

log(`Voice server running on port ${config.port}`);
