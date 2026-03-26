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
}

type Role = 'Greg' | 'System';

export const chat = (tui: TUI): Tools => {
  let streamOpen = false;
  let showSpinner = false;
  let onSubmit: (message: string) => void = () => {};

  const messages: string[] = [];
  const editor = createEditor(tui);
  const loader = new CancellableLoader(
    tui,
    (s) => pc.cyan(s),
    (s) => pc.gray(s)
  );

  editor.onSubmit((text) => {
    messages.push(`${pc.dim('You: ')}\n${text}`);
    onSubmit(text);

    loader.start();
    loader.setMessage('Thinking...');

    setTimeout(() => {
      loader.stop();
    }, 3000);
  });

  return {
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

      messages.push();
      tui.requestRender();

      let messageIndex: number | null = null;

      return {
        append: (chunk: string) => {
          if (!messageIndex) {
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
      loader.start();
      loader.setMessage(message);
      showSpinner = true;
    },
    hideSpinner: () => {
      loader.stop();
      showSpinner = false;
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

        const lastFadedMessages = messages.slice(-10, -12);
        const lastVisibleMessages = messages.slice(-10);

        for (const message of lastFadedMessages) {
          renderedLines.push(
            ...markdown({
              content: pc.dim(message),
              width,
              paddingX: 1,
              paddingY: 0,
            })
          );
          renderedLines.push('');
        }

        for (const message of lastVisibleMessages) {
          renderedLines.push(
            ...markdown({
              content: message,
              width,
              paddingX: 1,
              paddingY: 0,
            })
          );
          renderedLines.push('');
        }

        if (showSpinner) renderedLines.push(...loader.render(width));
        renderedLines.push(...editor.render(width));

        const rowsToFill = Math.max(
          0,
          tui.terminal.rows - renderedLines.length
        );

        for (let index = 0; index < rowsToFill; index += 1) {
          renderedLines.push(' '.repeat(width));
        }

        return renderedLines;
      },
      handleInput: (input) => {
        editor.handleInput(input);
      },
      invalidate: () => {},
    },
  };
};
