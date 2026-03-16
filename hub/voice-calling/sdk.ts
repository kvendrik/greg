import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { config } from "./config.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CallMode = "notify" | "conversation";
export type CallStatus = "initiating" | "in-progress" | "completed" | "failed";

export interface CallResult {
  callId: string;
  status: CallStatus;
  transcript: string[];
}

export interface InitiateCallOptions {
  to: string;
  message: string;
  mode?: CallMode;
}

export interface TaskCallOptions extends InitiateCallOptions {
  task: string;
  timeoutSeconds?: number;
  onCallerSpeech?: (text: string) => void;
  onAgentReply?: (text: string) => void;
}

export interface TaskCallResult extends CallResult {
  conclusion: string;
}

export interface VoiceClientOptions {
  baseUrl?: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class VoiceClient {
  private baseUrl: string;

  constructor(options: VoiceClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? `http://localhost:${config.port}`;
  }

  private async request(method: string, path: string, body?: object) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : (res.json() as Promise<CallResult>);
  }

  /** Place an outbound call. In notify mode, speaks the message and hangs up.
   *  In conversation mode, opens the full STT → Claude → TTS pipeline. */
  async call(options: InitiateCallOptions): Promise<CallResult> {
    return this.request("POST", "/calls", options) as Promise<CallResult>;
  }

  /** Inject a message into an active call — routes through Claude. */
  async continue(callId: string, message: string): Promise<CallResult> {
    return this.request("POST", `/calls/${callId}/continue`, { message }) as Promise<CallResult>;
  }

  /** Speak directly to the caller, bypassing Claude entirely. */
  async speak(callId: string, message: string): Promise<void> {
    await this.request("POST", `/calls/${callId}/speak`, { message });
  }

  /** Hang up and return the final transcript. */
  async end(callId: string): Promise<CallResult> {
    return this.request("DELETE", `/calls/${callId}`) as Promise<CallResult>;
  }

  /** Get the current call status and transcript. */
  async status(callId: string): Promise<CallResult> {
    return this.request("GET", `/calls/${callId}`) as Promise<CallResult>;
  }

  /** Subscribe to live server logs. Returns an unsubscribe function. */
  async tail(onLog: (line: string) => void): Promise<() => void> {
    const res = await fetch(`${this.baseUrl}/logs`);
    if (!res.body) throw new Error("No response body from /logs");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let cancelled = false;

    (async () => {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n")) {
          if (line.startsWith("data: ")) onLog(line.slice(6));
        }
      }
    })();

    return () => {
      cancelled = true;
      reader.cancel();
    };
  }

  /** Poll until the call reaches the given status. */
  async waitForStatus(callId: string, targetStatus: CallStatus, intervalMs = 500): Promise<CallResult> {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        try {
          const result = await this.status(callId);
          if (result.status === targetStatus) {
            clearInterval(interval);
            resolve(result);
          }
        } catch {
          // Still connecting
        }
      }, intervalMs);
    });
  }

  /** Place a call and drive the conversation autonomously until the task
   *  is complete, then hang up and return the conclusion. */
  async callWithTask(options: TaskCallOptions): Promise<TaskCallResult> {
    const { task, timeoutSeconds = 120, onCallerSpeech, onAgentReply, ...callOptions } = options;

    const { callId } = await this.call({ ...callOptions, mode: "conversation" });
    await this.waitForStatus(callId, "in-progress");

    const taskSession = await createTaskSession(task);

    return new Promise((resolve, reject) => {
      let lastTranscriptLength = 0;

      const timeoutHandle = setTimeout(async () => {
        clearInterval(loop);
        taskSession.dispose();
        await this.end(callId).catch(() => {});
        reject(new Error(`Call ${callId} timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);

      const loop = setInterval(async () => {
        let result: CallResult;
        try {
          result = await this.status(callId);
        } catch {
          clearInterval(loop);
          clearTimeout(timeoutHandle);
          taskSession.dispose();
          return;
        }

        if (result.status === "completed") {
          clearInterval(loop);
          clearTimeout(timeoutHandle);
          taskSession.dispose();
          return;
        }

        const newCallerLines = result.transcript
          .slice(lastTranscriptLength)
          .filter((l) => l.startsWith("caller:"));

        if (!newCallerLines.length) return;
        lastTranscriptLength = result.transcript.length;

        const callerSpeech = newCallerLines.map((l) => l.replace("caller: ", "")).join(" ");
        onCallerSpeech?.(callerSpeech);

        const { reply, taskComplete, conclusion } = await taskDrivenTurn(taskSession, callerSpeech);
        if (!reply) return;

        onAgentReply?.(reply);
        await this.speak(callId, reply);

        if (taskComplete) {
          clearInterval(loop);
          clearTimeout(timeoutHandle);
          taskSession.dispose();

          await new Promise((r) => setTimeout(r, 2000));
          const finalResult = await this.end(callId);
          resolve({ ...finalResult, conclusion: conclusion ?? "" });
        }
      }, 500);
    });
  }
}

// ─── Task session helpers ─────────────────────────────────────────────────────

async function createTaskSession(task: string) {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const model = getModel(config.llm.provider, config.llm.model);

  const { session } = await createAgentSession({
    model,
    thinkingLevel: "off",
    tools: [],
    systemPrompt: `\
You are a voice assistant on a phone call. Your task: "${task}"

After each reply, append a JSON status on its own final line:
  {"done": false}
  {"done": true, "conclusion": "one sentence summary of the outcome"}

Rules:
- Keep replies short and conversational (1-2 sentences)
- Only mark done=true when the task has a clear conclusion (success or failure)
- Never include the JSON in the spoken part of your reply`,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  return session;
}

async function taskDrivenTurn(
  session: Awaited<ReturnType<typeof createTaskSession>>,
  callerSpeech: string
) {
  const full = await new Promise<string>((resolve) => {
    let text = "";

    const unsubscribe = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        text += event.assistantMessageEvent.delta;
      }
      if (event.type === "agent_end") {
        unsubscribe();
        resolve(text.trim());
      }
    });

    session.prompt(callerSpeech);
  });

  if (!full) return { reply: "", taskComplete: false, conclusion: null };

  const lines = full.split("\n");
  const jsonLine = lines.findLast((l) => l.trim().startsWith("{"));
  const reply = lines.filter((l) => l.trim() !== jsonLine?.trim()).join("\n").trim();

  let taskComplete = false;
  let conclusion: string | null = null;
  try {
    const status = JSON.parse(jsonLine ?? "{}");
    taskComplete = status.done === true;
    conclusion = status.conclusion ?? null;
  } catch { }

  return { reply, taskComplete, conclusion };
}

// ─── Default instance ─────────────────────────────────────────────────────────

export const voiceClient = new VoiceClient();
