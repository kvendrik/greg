import { Bot, type Context } from 'grammy';
import { FileFlavor } from '@grammyjs/files';
import { createSession, type Session, type PromptInput } from '../agent-sdk';
import { escapeMarkdownV2, getTelegramEnv } from './utilities';
import pc from 'picocolors';

const { senderId } = getTelegramEnv();
export type BotContext = FileFlavor<Context>;

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

export async function createPromper(bot: Bot<BotContext>) {
  const sessions = new Map<number | 'main', Session>();

  return async function prompt(input: PromptInput, ctx?: BotContext) {
    if (!sessions.has('main')) {
      sessions.set('main', await createSession());
    }

    const messageThreadId = ctx?.message?.message_thread_id ?? null;
    let session = sessions.get('main')!;

    if (messageThreadId) {
      const threadSession = sessions.get(messageThreadId) ?? null;

      if (threadSession) {
        session = threadSession;
      } else {
        session = await createSession();
        sessions.set(messageThreadId, session);
      }
    }

    const typing = ctx ? createSendTypingAction(ctx) : null;

    const imageSuffix =
      input.images.length > 0 ? ` [+${input.images.length} image(s)]` : '';
    const preview = `${input.content}${imageSuffix}`;

    console.log(`\n\nPrompting: "${preview}"`);

    const message = `Sending response to ${ctx ? ctx.from?.username : 'user'}...`;
    let response = '';

    typing?.start();

    await session.prompt(input, {
      onThinking: () => {},
      onContent: (chunk: string) => {
        response += chunk;
      },
      onToolcall: async () => {
        if (response.trim() !== '') {
          process.stdout.write(`\n\n${message} (partial response)`);
          const text = response;
          response = '';
          await send(text);
        }
      },
      onDone: async () => {
        typing?.stop();
        if (response.trim() !== '') {
          console.log(`\n\n${message}`);
          console.log(`"${response}"`);
          await send(response);
        }
        response = '';
        process.stdout.write(`done. ${pc.green('✓')}\n`);
      },
      onStop: async () => {
        typing?.stop();
        await send('Stopped.');
        response = '';
        process.stdout.write(`stopped.\n`);
      },
      onError: async (error: string) => {
        if (error) {
          console.error(pc.red(`Error: ${error}`));
          typing?.stop();
          await send(error);
        }
        response = '';
      },
    });

    function send(text: string) {
      const escaped = escapeMarkdownV2(text);
      if (ctx) return ctx.reply(escaped);
      return bot.api.sendMessage(senderId, escaped);
    }
  };
}
