import {
  type Component,
  type TUI,
  CancellableLoader,
  Text,
} from '@mariozechner/pi-tui';
import pc from 'picocolors';
import { markdown } from './markdown';
import { editor as createEditor } from './editor';

export interface Stream {
  append: (chunk: string) => void;
  close: () => void;
}

interface Tools {
  component: Component;
  addMessage: (message: string, role: Role) => void;
  onSubmit: (callback: (message: string) => void) => void;
  onAbort: (callback: () => void) => void;
  stream: (role: Role) => Stream | null;
  spinner: (message: string) => void;
  hideSpinner: () => void;
  setDisabled: (disabled: boolean) => void;
  setCommands: (commands: Record<string, string>) => void;
}

type Role = 'Greg' | 'System';
type MessageRole = Role | 'You';

interface ChatMessage {
  role: MessageRole;
  content: string;
}

export const chat = (tui: TUI): Tools => {
  let streamOpen = false;
  let showSpinner = false;
  let isSpinnerRunning = false;
  let onSubmit: (message: string) => void = () => {};

  const messages: ChatMessage[] = [];
  const editor = createEditor(tui);
  const loader = new CancellableLoader(
    tui,
    (s) => pc.cyan(s),
    (s) => pc.gray(s)
  );

  const startSpinner = (message: string): void => {
    if (!isSpinnerRunning) {
      loader.start();
      isSpinnerRunning = true;
    }
    loader.setMessage(message);
    showSpinner = true;
  };

  const stopSpinner = (): void => {
    if (isSpinnerRunning) {
      loader.stop();
      isSpinnerRunning = false;
    }
    showSpinner = false;
  };

  editor.onSubmit((text) => {
    messages.push({ role: 'You', content: text });
    onSubmit(text);
    startSpinner('Thinking...');
  });

  return {
    setDisabled: editor.setDisabled,
    setCommands: editor.setCommands,
    onSubmit: (callback: (message: string) => void) => {
      onSubmit = callback;
    },
    onAbort: (callback: () => void) => {
      loader.onAbort = callback;
    },
    addMessage: (message: string, role: Role) => {
      messages.push({ role, content: message });
      tui.requestRender();
    },
    stream: (role: Role) => {
      if (streamOpen) return null;
      streamOpen = true;
      tui.requestRender();

      let messageIndex: number | null = null;

      return {
        append: (chunk: string) => {
          if (messageIndex === null) {
            messages.push({ role, content: chunk });
            messageIndex = messages.length - 1;
            tui.requestRender();
            return;
          }

          messages[messageIndex].content += chunk;
          tui.requestRender();
        },
        close: () => {
          streamOpen = false;
        },
      };
    },
    spinner: (message: string) => {
      startSpinner(message);
    },
    hideSpinner: () => {
      stopSpinner();
    },
    component: {
      render: (width) => {
        const renderMessage = (message: ChatMessage): string[] => {
          const renderedContent = markdown({
            content: message.content,
            width,
            paddingX: 1,
            paddingY: 0,
          });

          return [
            ...new Text(pc.dim(message.role), 1, 0).render(width),
            ...renderedContent,
          ];
        };

        const renderedLines: string[] = [];

        for (const [index, message] of messages.entries()) {
          if (index > 0) renderedLines.push('');
          renderedLines.push(...renderMessage(message));
        }

        if (showSpinner) renderedLines.push(...loader.render(width));

        renderedLines.push(...editor.render(width));
        return renderedLines;
      },
      handleInput: (input) => {
        editor.handleInput(input);
      },
      invalidate: () => {},
    },
  };
};
