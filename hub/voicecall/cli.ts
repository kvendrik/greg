import { Command } from 'commander';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from '@mariozechner/pi-coding-agent';

// ─── Task-driven conversation ─────────────────────────────────────────────────

async function createTaskSession(task: string, context: string) {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  const config = (await import('./config')).config;
  const systemPrompt = (await import('./systemPrompt')).systemPrompt;

  const { session } = await createAgentSession({
    model: config.llm,
    thinkingLevel: 'off',
    tools: [],
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
  });

  session.agent.state.systemPrompt = systemPrompt(task, context);

  return session;
}

async function taskDrivenTurn(
  session: Awaited<ReturnType<typeof createTaskSession>>,
  callerSpeech: string
) {
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
  session: Awaited<ReturnType<typeof createTaskSession>>,
  fallbackConclusion: string | null
): Promise<string> {
  if (fallbackConclusion) return fallbackConclusion;

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

// ─── CLI ──────────────────────────────────────────────────────────────────────

export const voicecallCommand = new Command();

voicecallCommand
  .name('voicecall')
  .description('Voice call CLI')
  .version('0.0.0');

voicecallCommand
  .command('call')
  .description('Place an outbound call')
  .requiredOption('--to <number>', 'Recipient phone number in E.164 format')
  .requiredOption(
    '--task <task>',
    'Drive the conversation until the task concludes then hang up'
  )
  .requiredOption(
    '--context <context>',
    'Additional background for the call (e.g. who you are, relationship, constraints)'
  )
  .action(async (opts: { to: string; task: string; context: string }) => {
    let isHandlingTurn = false;
    let lastConclusion: string | null = null;

    const VoiceCall = (await import('./VoiceCall')).VoiceCall;

    const call = await VoiceCall.create({ to: opts.to });
    await call.connect();

    console.log(`Call started: ${call.id}`);

    console.log(`Task: ${opts.task}\n`);
    console.log(`Context: ${opts.context}\n`);

    await call.waitForStatus('in-progress', { timeoutMs: 120_000 });
    console.log('Connected.\n');

    const taskSession = await createTaskSession(opts.task, opts.context);
    const timeoutHandle = setTimeout(async () => {
      console.error('\nCall timed out — hanging up.');
      taskSession.dispose();
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

      console.log(`Caller: ${said}`);

      const { reply, conclusion } = await taskDrivenTurn(taskSession, said);

      if (!reply) return;
      if (conclusion) lastConclusion = conclusion;

      console.log(`Agent:  ${reply}`);
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

    call.onEnd(async () => {
      const conclusionText = await generateConclusionFromSession(
        taskSession,
        lastConclusion
      );

      console.log('\n─────────────────────────────');
      console.log(`Conclusion: ${conclusionText}`);
      console.log('─────────────────────────────\n');

      taskSession.dispose();
      process.exit(lastConclusion ? 0 : 1);
    });
  });
