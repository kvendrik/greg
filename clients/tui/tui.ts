import { tui as createTui } from './components/tui';
import { chat as createChat, type Stream } from './components/chat';
import { client as createClient } from './client';
import { validate as validateConfig, get as getConfig } from '../../config';

const tui = createTui();
const chat = createChat(tui);
let captureMessage: ((reply: string) => void) | null = null;

let stream: Stream | null = null;

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
    stream?.close();
    stream = null;
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

chat.onSubmit((message) => {
  if (captureMessage) {
    captureMessage(message);
    return;
  }
  if (stream) {
    return;
  }
  chat.setDisabled(true);
  stream = chat.stream('Greg');
  void client.prompt(message).then(() => {
    stream?.close();
    stream = null;
  });
});

tui.addChild(chat.component);

const config = await getConfig();
const validConfig = await validateConfig(config);
const primaryModel =
  config.models.find((m) => m.role === 'primary')?.model ?? null;

if (!validConfig) {
  throw new Error('TUI usage requires a valid config');
}

tui.addChild({
  render: () => (primaryModel ? [primaryModel.name] : []),
  invalidate: () => {},
});

tui.setFocus(chat.component);
tui.start();
