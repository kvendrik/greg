import {
  type Component,
  type TUI,
  CancellableLoader,
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

export const chat = (tui: TUI): Tools => {
  let streamOpen = false;
  let showSpinner = false;
  let isSpinnerRunning = false;
  let onSubmit: (message: string) => void = () => {};

  const messages: string[] = [];
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
    messages.push(`${pc.dim('You: ')}\n${text}`);
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
      messages.push(`${pc.dim(`${role}: `)}\n${message}`);
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
            const prefix = pc.dim(`${role}:\n`);
            messages.push(`${prefix}${chunk}`);
            messageIndex = messages.length - 1;
            tui.requestRender();
            return;
          }

          messages[messageIndex] += chunk;
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
        const renderedLines: string[] = [];

        renderedLines.push(
          ...markdown({
            content: '# 🤖 Greg',
            width,
            paddingX: 1,
            paddingY: 1,
          })
        );

        const lastFadedMessages = messages.slice(-5, -8);
        const lastVisibleMessages = messages.slice(-5);

        for (const [index, message] of lastFadedMessages.entries()) {
          if (index > 0) renderedLines.push('');
          renderedLines.push(
            ...markdown({
              content: pc.dim(message),
              width,
              paddingX: 1,
              paddingY: 0,
            })
          );
        }

        for (const [index, message] of lastVisibleMessages.entries()) {
          if (index > 0) renderedLines.push('');
          renderedLines.push(
            ...markdown({
              content: message,
              width,
              paddingX: 1,
              paddingY: 0,
            })
          );
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
