import {
  type Component,
  type TUI,
  CancellableLoader,
  Box,
  Text,
} from '@mariozechner/pi-tui';
import pc from 'picocolors';
import { markdown } from './markdown';
import { editor as createEditor } from './editor';

export interface Stream {
  append: (chunk: string) => void;
  value: () => string;
  close: () => void;
  reset: () => void;
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
  resetCommands: () => void;
}

type Role = 'Greg' | 'System' | 'Tool';
type MessageRole = Role | 'You';

interface ChatMessage {
  role: MessageRole;
  content: string;
}

export const chat = (
  tui: TUI,
  { voiceMode }: { voiceMode: boolean }
): Tools => {
  let streamOpen = false;
  let showSpinner = false;
  let isSpinnerRunning = false;
  let onSubmit: (message: string) => void = () => {};

  const messages: ChatMessage[] = [];
  const editor = createEditor(tui, { voiceMode });
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
    tui.requestRender();
  };

  const stopSpinner = (): void => {
    if (isSpinnerRunning) {
      loader.stop();
      isSpinnerRunning = false;
    }
    showSpinner = false;
    tui.requestRender();
  };

  editor.onSubmit((text) => {
    messages.push({ role: 'You', content: text });
    startSpinner('Thinking...');
    onSubmit(text);
  });

  return {
    setDisabled: editor.setDisabled,
    setCommands: editor.setCommands,
    resetCommands: () => {
      editor.resetCommands();
    },
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
        reset: () => {
          messageIndex = null;
        },
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
        value: () =>
          messageIndex === null ? '' : messages[messageIndex].content,
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
            paddingX: 1,
            paddingY: 0,
          });

          if (message.role === 'You') {
            const box = new Box(1, 1, (text) => pc.bgBlack(text));
            box.addChild(renderedContent);
            return box.render(width);
          }

          if (message.role === 'Tool') {
            const box = new Box(1, 0, (text) => pc.dim(text));
            box.addChild(renderedContent);
            return box.render(width);
          }

          if (message.role === 'System') {
            const text = new Text(pc.dim(`System: ${message.content}`));
            return text.render(width);
          }

          const box = new Box(1, 0, (text) => text);
          box.addChild(renderedContent);
          return box.render(width);
        };

        const renderedLines: string[] = [];

        for (const [index, message] of messages.entries()) {
          if (index > 0) renderedLines.push('');
          renderedLines.push(...renderMessage(message));
        }

        if (showSpinner) {
          renderedLines.push(...loader.render(width));
          return [...renderedLines, ...editor.render(width)];
        } else {
          return [...renderedLines, '', '', ...editor.render(width)];
        }
      },
      handleInput: (input) => {
        editor.handleInput(input);
      },
      invalidate: () => {},
    },
  };
};
