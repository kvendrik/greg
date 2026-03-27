import { spawnSync } from 'node:child_process';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import pc from 'picocolors';
import { tui as createTui } from './components/tui';
import { chat as createChat, type Stream } from './components/chat';
//import { overlay as createOverlay } from './components/overlay';
import { client as createClient } from './client';
import { markdown } from './components/markdown';
import { version } from '../../package.json';
import { play, synthesizeToBuffer } from '../../voice/speech';
import {
  validate as validateConfig,
  get as getConfig,
  type Config,
} from '../../config';

interface StartOptions {
  voiceMode: boolean;
  initialPrompt: string | null;
  sessionId: string;
}

export async function start({
  voiceMode,
  initialPrompt,
  sessionId,
}: StartOptions): Promise<void> {
  process.env.GREG_LOG = 'silent';

  const tui = createTui();
  const chat = createChat(tui, { voiceMode });
  const currentGitBranch = getCurrentGitBranch();

  let config: Config | null = null;
  let thinkingLevel: ThinkingLevel = 'medium';
  let model: Model<Api> | null = null;
  let isPlayingVoiceReply = false;

  let loadingMessage: string | null = null;
  const setLoadingMessage = (message: string | null): void => {
    loadingMessage = message;
    tui.requestRender();
  };

  tui.start();
  chat.setDisabled(true);

  let captureMessage: ((reply: string) => void) | null = null;
  let stream: Stream | null = null;

  const footer = (width: number): string => {
    const currentWorkingDirectory = process.env.PWD ?? process.cwd();
    const branchSuffix = currentGitBranch ? ` @ ${currentGitBranch}` : '';
    const left =
      currentWorkingDirectory.replace(process.env.HOME ?? '', '~') +
      branchSuffix;
    const primaryModel =
      config?.models.find((m) => m.role === 'primary')?.model ?? null;
    const right = `${sessionId} • ${model?.name.toLowerCase() ?? primaryModel?.name.toLowerCase() ?? ''} • thinking: ${thinkingLevel}`;
    return `${pc.dim(left)}${' '.repeat(Math.max(1, width - left.length - right.length))}${pc.dim(right)}`;
  };

  const app = {
    render: (width: number) => {
      const footerLines = [
        footer(width),
        ...(loadingMessage
          ? [pc.dim(`loading... (${loadingMessage.toLowerCase()})`)]
          : []),
      ];

      const availableChatRows = Math.max(
        0,
        tui.terminal.rows - footerLines.length
      );

      const renderedLines = [
        ...markdown({
          content: `${pc.bold(pc.blue('🤖 Greg'))} ${pc.dim(`v${version}`)}`,
          width,
          paddingX: 1,
          paddingY: 1,
        }),
        ...chat.component.render(width).slice(-availableChatRows),
        ...footerLines,
      ];

      const rowsToFill = Math.max(0, tui.terminal.rows - renderedLines.length);

      for (let index = 0; index < rowsToFill; index += 1) {
        renderedLines.push(' '.repeat(width));
      }

      return renderedLines;
    },
    handleInput: (input: string) => {
      chat.component.handleInput?.(input);
    },
    invalidate: () => {},
  };

  tui.addChild(app);
  tui.setFocus(app);

  setLoadingMessage('Loading config');
  config = await getConfig();

  setLoadingMessage('Validating');
  const validConfig = await validateConfig(config);

  if (!validConfig) {
    throw new Error('TUI usage requires a valid config');
  }

  setLoadingMessage('Creating client');
  const client = await createClient(sessionId, {
    onTurnStart() {
      chat.spinner('Thinking...');
    },
    onContent: (chunk) => {
      stream?.append(chunk);
    },
    onToolcall(name) {
      chat.spinner(`Calling ${name}()`);
    },
    onTurnStop() {
      finishTurn();
    },
    onTurnDone() {
      finishTurn();
    },
    onError(error) {
      chat.addMessage(error, 'System');
      finishTurn();
    },
    getReply: async (message: string) => {
      chat.addMessage(message, 'Greg');
      chat.setDisabled(false);
      return new Promise((resolve) => {
        captureMessage = (reply: string) => {
          chat.setDisabled(true);
          resolve(reply);
          captureMessage = null;
        };
      });
    },
    onThinkingLevelChange(level) {
      thinkingLevel = level;
      tui.requestRender();
    },
    onModelChange(newModel) {
      model = newModel;
      tui.requestRender();
    },
  });

  client.onCommands((commands) => {
    chat.setCommands(commands);
  });

  chat.onSubmit(handleMessage);
  setLoadingMessage(null);

  if (initialPrompt) {
    handleMessage(initialPrompt);
  } else {
    chat.setDisabled(false);
  }

  function handleMessage(message: string): void {
    if (captureMessage) {
      captureMessage(message);
      return;
    }

    if (stream) {
      return;
    }

    chat.setDisabled(true);
    stream = chat.stream('Greg');

    void client
      .prompt(`${message}\n\n[Sent from the TUI]`)
      .then(() => {
        stream?.close();
        stream = null;
      })
      .catch((error: unknown) => {
        stream?.close();
        stream = null;
        chat.hideSpinner();
        chat.addMessage(
          error instanceof Error ? error.message : String(error),
          'System'
        );
        chat.setDisabled(false);
      });
  }

  function finishTurn(): void {
    if (!voiceMode) {
      chat.hideSpinner();
      chat.setDisabled(false);
      return;
    }

    void playAssistantReply()
      .catch((error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        chat.addMessage(`Voice playback failed: ${errorMessage}`, 'System');
      })
      .finally(() => {
        chat.hideSpinner();
        chat.setDisabled(false);
      });
  }

  async function playAssistantReply(): Promise<void> {
    if (!voiceMode || isPlayingVoiceReply) {
      return;
    }

    const assistantReply = stream?.value().trim() ?? '';

    if (assistantReply === '') {
      return;
    }

    const voiceId = config?.voice?.elevenlabs?.voiceId;
    if (!voiceId) {
      chat.addMessage(
        'Voice playback is unavailable. Set voice.elevenlabs.voiceId in your config.',
        'System'
      );
      return;
    }

    isPlayingVoiceReply = true;
    chat.spinner('Playing reply...');

    try {
      const audioBuffer = await synthesizeToBuffer(assistantReply, {
        voiceId,
        useV3: false,
      });
      await play(audioBuffer);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      chat.addMessage(`Voice playback failed: ${errorMessage}`, 'System');
    } finally {
      isPlayingVoiceReply = false;
      chat.hideSpinner();
    }
  }
}

function getCurrentGitBranch(): string | undefined {
  const branchResult = spawnSync('git', ['branch', '--show-current'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (branchResult.status !== 0) {
    return undefined;
  }

  const branch = branchResult.stdout.trim();
  return branch === '' ? undefined : branch;
}
