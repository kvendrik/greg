import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

async function defaultCreateAgent(systemPrompt: string) {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const { session } = await createAgentSession({
    model: getModel('anthropic', 'claude-sonnet-4-6'),
    thinkingLevel: 'off',
    tools: [],
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  session.agent.state.systemPrompt = systemPrompt;

  return session;
}

async function taskDrivenTurn(session: AgentSession, callerSpeech: string) {
  const full = await new Promise<string>((resolve) => {
    let text = '';

    const unsubscribe = session.subscribe((event) => {
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

    const now = new Date();
    const timestamp = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    session.prompt(`[${timestamp}] Caller: ${callerSpeech}`);
  });

  if (!full) return { reply: '', taskComplete: false, conclusion: null };

  const lines = full.split('\n');
  const jsonLine = [...lines]
    .reverse()
    .find((line) => line.trim().startsWith('{'));
  const reply = lines
    .filter((l) => l.trim() !== jsonLine?.trim())
    .join('\n')
    .trim();

  let taskComplete = false;
  let conclusion: string | null = null;
  try {
    const status = JSON.parse(jsonLine ?? '{}') as {
      done?: boolean;
      conclusion?: string;
    };
    taskComplete = status.done === true;
    conclusion = status.conclusion ?? null;
  } catch {
    // Malformed JSON — keep going
  }

  return { reply, taskComplete, conclusion };
}

async function generateConclusionFromSession(
  session: AgentSession
): Promise<string> {
  const summary = await new Promise<string>((resolve) => {
    let text = '';

    const unsubscribe = session.subscribe((event) => {
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

    session.prompt(
      'The caller has ended the call, but you did not explicitly mark the task as done. Based on the entire conversation so far, write a concise one-sentence conclusion describing the outcome. Do not include any JSON, just plain text.'
    );
  });

  return summary || 'Task was not completed.';
}

interface CallOptions {
  /**
   * The phone number to call in E.164 format.
   */
  to: string;
  /**
   * The task to perform on the call.
   * Example: "Make a reservation for a table for two."
   */
  task: string;
  /**
   * Additional context for the call.
   * Example: "You are a personal assistant for a person called John Doe."
   */
  context: string;
  /**
   * A function to create an agent session for the call.
   * Example: (task: string, context: string) => createAgentSession(task, context)
   */
  createAgent?: (systemPrompt: string) => Promise<AgentSession>;
  onStart?: (callId: string) => void;
  onConnect?: () => void;
  onSpeech?: (details: { role: 'caller' | 'agent'; text: string }) => void;
}

export async function callWithTask({
  to,
  task,
  context,
  createAgent = defaultCreateAgent,
  onStart,
  onSpeech,
  onConnect,
}: CallOptions): Promise<{ conclusion: string; timedout: boolean }> {
  let isHandlingTurn = false;
  let timedout = false;
  let lastConclusion: string | null = null;

  const VoiceCall = (await import('./VoiceCall')).VoiceCall;

  const call = await VoiceCall.create({ to });
  await call.connect();
  onStart?.(call.id!);

  await call.waitForStatus('in-progress', { timeoutMs: 120_000 });
  onConnect?.();

  const systemPrompt = (await import('./systemPrompt')).systemPrompt;
  const taskSession = await createAgent(systemPrompt(task, context));

  const timeoutHandle = setTimeout(async () => {
    console.error('\nCall timed out — hanging up.');
    timedout = true;
    await call.end();
    process.exit(1);
  }, 120 * 1000);

  call.onSpeech(async (said) => {
    if (isHandlingTurn) {
      // Ignore caller speech while we're still handling the previous turn
      // to avoid overlapping turns and "interrupt" style messiness.
      return;
    }

    isHandlingTurn = true;
    onSpeech?.({ role: 'caller', text: said });

    const { reply, conclusion } = await taskDrivenTurn(taskSession, said);

    if (!reply) return;
    if (conclusion) lastConclusion = conclusion;

    onSpeech?.({ role: 'agent', text: reply });
    await call.speak(reply);

    if (conclusion) {
      clearTimeout(timeoutHandle);
      taskSession.dispose();

      await Bun.sleep(10000);
      await call.end();

      process.exit(0);
    }

    await Bun.sleep(1000);
    isHandlingTurn = false;
  });

  return new Promise((resolve) => {
    call.onEnd(async () => {
      taskSession.dispose();

      if (lastConclusion) {
        resolve({ conclusion: lastConclusion, timedout });
      } else {
        const conclusionText = await generateConclusionFromSession(taskSession);
        resolve({ conclusion: conclusionText, timedout });
      }
    });
  });
}
