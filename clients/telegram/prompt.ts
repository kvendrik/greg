import { Bot, type Context } from 'grammy';
import { FileFlavor } from '@grammyjs/files';
import { type Thread, type PromptInput } from '../agent-sdk';
import pc from 'picocolors';

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

export function createPrompt(
  thread: Thread,
  bot: Bot<BotContext>,
  senderId: string
) {
  return async function prompt(input: PromptInput, ctx?: BotContext) {
    const typing = ctx ? createSendTypingAction(ctx) : null;

    const imageSuffix =
      input.images.length > 0 ? ` [+${input.images.length} image(s)]` : '';
    const preview = `${input.content}${imageSuffix}`;

    console.log(`\n\nPrompting: "${preview}"`);

    const message = `Sending response to ${ctx ? ctx.from?.username : 'user'}...`;
    let response = '';

    typing?.start();

    await thread.prompt(input, {
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
      if (ctx) return ctx.reply(text);
      return bot.api.sendMessage(senderId, text);
    }
  };
}
