import { tui as createTui } from './components/tui';
import { chat as createChat, type Stream } from './components/chat';
import { client } from './client';
import { validate as validateConfig, get as getConfig } from '../../config';

const tui = createTui();
const chat = createChat(tui);
let captureMessage: ((reply: string) => void) | null = null;

let stream: Stream | null = null;

const { prompt } = await client({
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
    stream?.close();
    stream = null;
  },
  onTurnDone() {
    chat.hideSpinner();
  },
  onError(error) {
    chat.hideSpinner();
    chat.addMessage(error, 'System');
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

chat.onSubmit((message) => {
  if (captureMessage) {
    captureMessage(message);
    return;
  }
  if (stream) {
    return;
  }
  stream = chat.stream('Greg');
  void prompt(message).then(() => {
    stream?.close();
    stream = null;
  });
});

tui.addChild(chat.component);
tui.setFocus(chat.component);

tui.start();

const config = await getConfig();
const validConfig = await validateConfig(config);

if (!validConfig) {
  throw new Error('TUI usage requires a valid config');
}
