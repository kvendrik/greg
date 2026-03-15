import {
  Session,
  type PromptInput,
  type Callbacks,
} from '../../gateway/sdk/sdk';
import pc from 'picocolors';
import { createLogger } from '../../utilities/logger';
import { sendMessage } from './messaging';
import { type BotContext } from './bot';

const logger = createLogger('TG');

function createSendTypingAction(ctx: BotContext) {
  const typingIntervalMs = 5000;
  const chat = ctx.chat;
  if (!chat) throw new Error('No chat on context');
  const chatId = chat.id;
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const loop = async () => {
    if (stopped) return;
    try {
      await ctx.api.sendChatAction(chatId, 'typing');
    } catch (error) {
      console.error(error);
    }
    if (stopped) return;
    timeoutId = setTimeout(loop, typingIntervalMs);
  };

  return {
    start() {
      void loop();
    },
    stop() {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

interface State {
  working: boolean;
  ctx: BotContext | null;
  typingAction: ReturnType<typeof createSendTypingAction> | null;
  buffer: string;
  log: string;
  initiatedBy: 'user' | 'agent' | null;
}

export async function createPromper() {
  const sessions = new Map<number | 'main', Session>();
  let state: State = emptyState();

  const callbacks: Callbacks = {
    onTurnStart: () => {
      state.working = true;
      state.buffer = '';

      if (state.initiatedBy === null) {
        state.initiatedBy = 'agent';
        state.log = `[Agent initiated turn] Sending response to user...`;
      }
    },
    onThinking: () => {},
    onContent: (chunk: string) => {
      state.buffer += chunk;
    },
    onToolcall: async () => {
      if (state.buffer.trim() !== '') {
        logger.write(`\n\n${state.log} (partial response)`);
        const text = state.buffer;
        state.buffer = '';
        await sendMessage(text);
      }
    },
    onTurnDone: async () => {
      state.typingAction?.stop();
      if (state.buffer.trim() !== '') {
        logger.info(`\n\n${state.log}`);
        logger.info(`"${state.buffer}"`);
        await sendMessage(state.buffer);
      }
      state.buffer = '';
      logger.write(`done. ${pc.green('✓')}\n`);
      state = emptyState();
    },
    onTurnStop: async () => {
      state.typingAction?.stop();
      await sendMessage('Stopped.');
      state.buffer = '';
      logger.write(`stopped.\n`);
      state = emptyState();
    },
    onError: async (error: string) => {
      if (error) {
        console.error(pc.red(`Error: ${error}`));
        state.typingAction?.stop();
        await sendMessage(error);
      }
      state = emptyState();
    },
  };

  const mainSession = await Session.existing('main', 'telegram');
  await mainSession.connect();
  mainSession.subscribe(callbacks);
  sessions.set('main', mainSession);

  return async function prompt(input: PromptInput, ctx?: BotContext) {
    const session = sessions.get('main')!;
    const typing = ctx ? createSendTypingAction(ctx) : null;

    const imageSuffix =
      input.images.length > 0 ? ` [+${input.images.length} image(s)]` : '';
    const preview = `${input.content}${imageSuffix}`;

    logger.info(`\n\nPrompting: "${preview}"`);

    typing?.start();

    state = {
      working: true,
      ctx: ctx ?? null,
      typingAction: state.typingAction
        ? state.typingAction
        : typing
          ? typing
          : null,
      buffer: '',
      log: `Sending response to ${ctx ? ctx.from?.username : 'user'}...`,
      initiatedBy: 'user',
    };

    input.content = `${input.content}\n\n[Message was sent from Telegram]`;

    await session.prompt(input);
  };

  function emptyState(): State {
    return {
      working: false,
      ctx: null,
      typingAction: null,
      buffer: '',
      log: '',
      initiatedBy: null,
    };
  }
}
