import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import { truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';
import pc from 'picocolors';
import { tui as createTui } from './components/tui';
import { chat as createChat, type Stream } from './components/chat';
import { footer } from './components/footer';
import { discoverSkills } from '../../agent/tools/skills';
import { client as createClient, type Client as TuiClient } from './client';
import { markdown } from './components/markdown';
import { version } from '../../package.json';
import { getInfo as getMemoryInfo } from '../../agent/tools/memory';
import { play, synthesizeToBuffer } from '../../voice/speech';
import { validate as validateConfig, get as getConfig } from '../../config';
import { prettify } from '../../agent/tools/utilities/policy/prettify';

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
  const config = await getConfig();

  let model = config.models.find((entry) => entry.role === 'primary')?.model;

  if (!model) {
    throw new Error('No primary model in config.models.');
  }

  const skills = discoverSkills(config);

  let thinkingLevel: ThinkingLevel = 'medium';
  let isPlayingVoiceReply = false;
  let client: TuiClient | null = null;

  let loadingMessage: string | null = null;
  const setLoadingMessage = (message: string | null): void => {
    loadingMessage = message;
    tui.requestRender();
  };

  tui.start();
  chat.setDisabled(true);

  let captureMessage: ((reply: string) => void) | null = null;
  let stream: Stream | null = null;

  const fitLineToWidth = (line: string, width: number): string => {
    return visibleWidth(line) <= width ? line : truncateToWidth(line, width);
  };

  const app = {
    render: (width: number) => {
      const headerLines = markdown({
        content: `${pc.bold(pc.blue('🤖 Greg'))} ${pc.dim(`v${version}`)}`,
        paddingX: 1,
        paddingY: 1,
      }).render(width);

      const footerLines = [
        ...footer({
          width,
          sessionId,
          model: (model?.name ?? 'unknown').toLowerCase(),
          thinkingLevel,
          usage: client?.usage ?? null,
        }),
        ...(loadingMessage
          ? [
              fitLineToWidth(
                pc.dim(`loading... (${loadingMessage.toLowerCase()})`),
                width
              ),
            ]
          : []),
      ];

      const bodyLines = [
        ...helpMessage()
          .split('\n')
          .map((l) => fitLineToWidth(pc.dim(l), width)),
        ...chat.component.render(width),
      ];

      const availableBodyRows =
        Math.max(
          0,
          tui.terminal.rows - headerLines.length - footerLines.length
        ) * 3;

      const renderedLines = [
        ...headerLines,
        ...bodyLines.slice(-availableBodyRows),
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

  setLoadingMessage('Validating');
  const validConfig = await validateConfig(config);

  if (!validConfig) {
    throw new Error('TUI usage requires a valid config');
  }

  const toolCalls = new Map<
    string,
    { name: string; args: Record<string, unknown> }
  >();

  setLoadingMessage('Creating client');
  client = await createClient(sessionId, {
    onTurnStart() {
      chat.spinner('Thinking...');
    },
    onContent: (chunk) => {
      stream?.append(chunk);
    },
    onToolcall(id, name, args) {
      chat.spinner(`Calling ${name}()`);
      toolCalls.set(id, { name, args });
    },
    onToolcallResult(id, name, result) {
      const call = toolCalls.get(id) ?? null;
      if (call === null) {
        return;
      }
      chat.addMessage(
        `${pc.yellow(call.name)}(${prettify(call.args)})\n\n${result}`,
        'Tool'
      );
      stream?.reset();
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
    onCompactStart(oldMessages) {
      chat.spinner(`Compacting ${oldMessages.length} messages...`);
      chat.setDisabled(true);
    },
    onCompactDone(newMessages) {
      chat.addMessage(`Compacted to ${newMessages.length} messages`, 'System');
      chat.hideSpinner();
      chat.setDisabled(false);
    },
  });

  client.onPermissionRequest((commands: Record<string, string>) => {
    chat.setCommands(commands);
  });

  client.onPermissionRequestDone(() => {
    chat.resetCommands();
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

    const activeClient = client;
    if (activeClient === null) {
      chat.addMessage('TUI client is not ready yet.', 'System');
      chat.setDisabled(false);
      stream?.close();
      stream = null;
      return;
    }

    void activeClient
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

    const voiceId = config.voice?.elevenlabs?.voiceId;
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

  function helpMessage(): string {
    const memoryInfo = getMemoryInfo(config);
    return `
    Usage Legend:
      ↑ fresh input tokens
      ↓ output tokens
      R cached tokens reused
      W cached tokens written
      $ cost of last assistant turn
      Σ$ cumulative session cost
      W% model context window used
      C% compaction threshold used

    Session location:
      ~/.greg/workspace/sessions/${sessionId}.jsonl

    Memory files:
${memoryInfo.map((info) => `      ${info.location.replace(process.env.HOME ?? '', '~')} ${info.injected ? '(injected)' : ''}`).join('\n')}

    Loaded skills:
${skills.map((skill) => `      ${skill.location.replace(process.env.HOME ?? '', '~')}`).join('\n')}
`;
  }
}
