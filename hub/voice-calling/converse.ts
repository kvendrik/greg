import { Command } from "commander";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { config } from "./config.ts";

const CONTROL_URL = process.env.VOICE_CONTROL_URL ?? `http://localhost:${config.port}`;

// ─── API client ───────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: object) {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ─── Task-driven conversation ─────────────────────────────────────────────────

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
  const reply = lines
    .filter((l) => l.trim() !== jsonLine?.trim())
    .join("\n")
    .trim();

  let taskComplete = false;
  let conclusion: string | null = null;
  try {
    const status = JSON.parse(jsonLine ?? "{}");
    taskComplete = status.done === true;
    conclusion = status.conclusion ?? null;
  } catch {
    // Malformed JSON — keep going
  }

  return { reply, taskComplete, conclusion };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function waitForStatus(callId: string, targetStatus: string, intervalMs = 500) {
  await new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      try {
        const { status } = await api("GET", `/calls/${callId}`);
        if (status === targetStatus) {
          clearInterval(interval);
          resolve();
        }
      } catch {
        // Still connecting
      }
    }, intervalMs);
  });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("converse")
  .description("Voice call CLI — mirrors the OpenClaw voicecall interface")
  .version("1.0.0");

program
  .command("call")
  .description("Place an outbound call")
  .requiredOption("--to <number>", "Recipient phone number in E.164 format")
  .requiredOption("--message <message>", "Opening message to speak when connected")
  .option("--mode <mode>", '"notify" (speak + hang up) or "conversation"', "conversation")
  .option("--task <task>", "Drive the conversation until the task concludes then hang up")
  .option("--timeout <seconds>", "Maximum call duration before force hang-up", "120")
  .action(async (opts) => {
    const { callId } = await api("POST", "/calls", {
      to: opts.to,
      message: opts.message,
      mode: opts.mode,
    });

    console.log(`Call started: ${callId}`);
    if (!opts.task) {
      console.log("Call placed. Use --call-id commands to manage it.");
      return;
    }

    console.log(`Task: ${opts.task}\n`);

    await waitForStatus(callId, "in-progress");
    console.log("Connected.\n");

    const taskSession = await createTaskSession(opts.task);

    const timeoutHandle = setTimeout(async () => {
      console.error("\nCall timed out — hanging up.");
      taskSession.dispose();
      await api("DELETE", `/calls/${callId}`);
      process.exit(1);
    }, parseInt(opts.timeout) * 1000);

    let lastTranscriptLength = 0;

    const loop = setInterval(async () => {
      let result;
      try {
        result = await api("GET", `/calls/${callId}`);
      } catch {
        clearInterval(loop);
        return;
      }

      if (result.status === "completed") {
        clearInterval(loop);
        taskSession.dispose();
        return;
      }

      const newCallerLines: string[] = result.transcript
        .slice(lastTranscriptLength)
        .filter((l: string) => l.startsWith("caller:"));

      if (!newCallerLines.length) return;
      lastTranscriptLength = result.transcript.length;

      const callerSpeech = newCallerLines
        .map((l: string) => l.replace("caller: ", ""))
        .join(" ");

      console.log(`Caller: ${callerSpeech}`);

      const { reply, taskComplete, conclusion } = await taskDrivenTurn(taskSession, callerSpeech);

      if (!reply) return;
      console.log(`Agent:  ${reply}`);
      await api("POST", `/calls/${callId}/speak`, { message: reply });

      if (taskComplete) {
        clearInterval(loop);
        clearTimeout(timeoutHandle);
        taskSession.dispose();

        await Bun.sleep(2000);
        await api("DELETE", `/calls/${callId}`);

        console.log("\n─────────────────────────────");
        console.log("Task complete.");
        console.log(`Conclusion: ${conclusion}`);
        console.log("─────────────────────────────\n");
        process.exit(0);
      }
    }, 500);
  });

program
  .command("continue")
  .description("Inject a message into an ongoing call (routes through Claude)")
  .requiredOption("--call-id <id>", "Call ID")
  .requiredOption("--message <message>", "Message to inject")
  .action(async (opts) => {
    const result = await api("POST", `/calls/${opts.callId}/continue`, {
      message: opts.message,
    });
    console.log("Status:", result.status);
    console.log("Transcript:\n", result.transcript.join("\n"));
  });

program
  .command("speak")
  .description("Speak directly to the caller (bypasses Claude)")
  .requiredOption("--call-id <id>", "Call ID")
  .requiredOption("--message <message>", "Text to speak")
  .action(async (opts) => {
    await api("POST", `/calls/${opts.callId}/speak`, { message: opts.message });
    console.log("Done.");
  });

program
  .command("end")
  .description("Hang up an active call")
  .requiredOption("--call-id <id>", "Call ID")
  .action(async (opts) => {
    const result = await api("DELETE", `/calls/${opts.callId}`);
    console.log("Call ended.");
    if (result.transcript.length) {
      console.log("Transcript:\n", result.transcript.join("\n"));
    }
  });

program
  .command("status")
  .description("Get call status and transcript")
  .requiredOption("--call-id <id>", "Call ID")
  .action(async (opts) => {
    const result = await api("GET", `/calls/${opts.callId}`);
    console.log("Status:    ", result.status);
    console.log("Transcript:\n", result.transcript.join("\n"));
  });

program
  .command("tail")
  .description("Stream live logs from the voice server")
  .action(async () => {
    console.log(`Tailing logs from ${CONTROL_URL}...\n`);
    const res = await fetch(`${CONTROL_URL}/logs`);
    if (!res.body) throw new Error("No response body from /logs");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split("\n")) {
        if (line.startsWith("data: ")) console.log(line.slice(6));
      }
    }
  });

program
  .command("expose")
  .description("Expose the voice server publicly (when running without built-in tunnel)")
  .option("--mode <mode>", '"ngrok" or "funnel"', "ngrok")
  .action(async (opts) => {
    if (opts.mode === "ngrok") {
      const ngrokLib = await import("@ngrok/ngrok");
      const listener = await ngrokLib.default.forward({
        addr: config.port,
        authtoken_from_env: true,
      });
      const url = listener.url();
      console.log("Public URL:", url);
      console.log("Twilio webhook:", `${url}/voice/webhook`);
      process.stdin.resume();
    } else {
      console.log(`Run: tailscale funnel ${config.port}`);
    }
  });

program.parse();
