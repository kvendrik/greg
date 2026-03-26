import pc from 'picocolors';
import { tui as createTui } from './components/tui';
import { chat as createChat, type Stream } from './components/chat';
//import { overlay as createOverlay } from './components/overlay';
import { client as createClient } from './client';
import {
  validate as validateConfig,
  get as getConfig,
  type Config,
} from '../../config';

process.env.GREG_LOG = 'silent';

const tui = createTui();
const chat = createChat(tui);

let config: Config | null = null;

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
  const left = currentWorkingDirectory.replace(process.env.HOME ?? '', '~');
  const primaryModel =
    config?.models.find((m) => m.role === 'primary')?.model ?? null;
  const right = primaryModel?.name.toLowerCase() ?? '';
  return `${pc.dim(left)}${' '.repeat(Math.max(1, width - left.length - right.length))}${pc.dim(right)}`;
};

const app = {
  render: (width: number) => {
    const renderedLines = [
      ...chat.component.render(width),
      ...[
        footer(width),
        ...(loadingMessage
          ? [pc.dim(`loading... (${loadingMessage.toLowerCase()})`)]
          : []),
      ],
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
const client = await createClient({
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
    chat.hideSpinner();
    chat.setDisabled(false);
  },
  onTurnDone() {
    chat.hideSpinner();
    chat.setDisabled(false);
  },
  onError(error) {
    chat.hideSpinner();
    chat.addMessage(error, 'System');
    chat.setDisabled(false);
  },
  getReply: async (message: string) => {
    chat.addMessage(message, 'Greg');
    return new Promise((resolve) => {
      captureMessage = (reply: string) => {
        resolve(reply);
        captureMessage = null;
      };
    });
  },
});

client.onCommands((commands) => {
  chat.setCommands(commands);
});

chat.onSubmit(handleMessage);
setLoadingMessage(null);
chat.setDisabled(false);

const initialPrompt = process.argv[2]?.trim();
if (initialPrompt) handleMessage(initialPrompt);

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
  void client.prompt(`${message}\n\n[Sent from the TUI]`).then(() => {
    stream?.close();
    stream = null;
  });
}
