import * as gateway from '../../gateway';
import pc from 'picocolors';
import { createLogger } from '../../utilities/logger';
import { sendMessage } from './messaging';
import { type BotContext } from './bot';

const logger = createLogger('TG');

function createSendTypingAction(ctx: BotContext): {
  start: () => void;
  stop: () => void;
} {
  const typingIntervalMs = 5000;
  const chat = ctx.chat;
  if (!chat) throw new Error('No chat on context');
  const chatId = chat.id;
  const cancel = { stop: false };
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const loop = async (): Promise<void> => {
    if (cancel.stop) return;
    try {
      await ctx.api.sendChatAction(chatId, 'typing');
    } catch (error) {
      console.error(error);
    }
    /* `cancel.stop` may be set while `sendChatAction` is in flight. */
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- race with `stop()`
    if (cancel.stop) {
      return;
    }
    timeoutId = setTimeout(() => {
      void loop();
    }, typingIntervalMs);
  };

  return {
    start() {
      void loop();
    },
    stop() {
      cancel.stop = true;
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

export function createPromper(): (
  input: gateway.PromptInput,
  ctx?: BotContext
) => Promise<void> {
  let state: State = emptyState();

  const callbacks: gateway.Callbacks = {
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
    onToolcall: () => {
      if (state.buffer.trim() !== '') {
        logger.write(`\n\n${state.log} (partial response)`);
        const text = state.buffer;
        state.buffer = '';
        void sendMessage(text);
      }
    },
    onTurnDone: () => {
      state.typingAction?.stop();
      if (state.buffer.trim() !== '') {
        logger.info(`\n\n${state.log}`);
        logger.info(`"${state.buffer}"`);
        void sendMessage(state.buffer);
      }
      state.buffer = '';
      logger.write(`done. ${pc.green('✓')}\n`);
      state = emptyState();
    },
    onTurnStop: () => {
      state.typingAction?.stop();
      state.buffer = '';
      logger.write(`stopped.\n`);
      state = emptyState();
    },
    onError: (error: string) => {
      state.typingAction?.stop();

      if (error !== '') {
        console.error(pc.red(`Error: ${error}`));
        void sendMessage(error);
      }

      state = emptyState();
    },
  };

  const mainSession = gateway.get('main');
  mainSession.subscribe('telegram', callbacks);

  return async function prompt(
    input: gateway.PromptInput,
    ctx?: BotContext
  ): Promise<void> {
    const typing = ctx ? createSendTypingAction(ctx) : null;

    const imageSuffix =
      input.images.length > 0 ? ` [+${input.images.length} image(s)]` : '';
    const preview = `${input.content}${imageSuffix}`;

    logger.info(`\n\nPrompting: "${preview}"`);

    //typing?.start();

    state = {
      working: true,
      ctx: ctx ?? null,
      typingAction: state.typingAction ?? typing ?? null,
      buffer: '',
      log: `Sending response to ${ctx ? ctx.from?.username : 'user'}...`,
      initiatedBy: 'user',
    };

    input.content = `${input.content}\n\n[Message was sent from Telegram]`;

    await mainSession.prompt(input, {
      channelId: 'telegram',
    });
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
