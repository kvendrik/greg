import type { Component, TUI } from '@mariozechner/pi-tui';
import pc from 'picocolors';

interface Tools {
  show: (message: string) => void;
  setMessage: (message: string) => void;
  hide: () => void;
}

export function overlay(tui: TUI): Tools {
  let overlayHandle: ReturnType<TUI['showOverlay']> | null = null;

  const component: Component = {
    render: (width: number): string[] => {
      const renderedLines = Array.from({ length: tui.terminal.rows }, () =>
        ' '.repeat(width)
      );
      const centeredMessage = centerMessage(pc.dim(messageText), width);
      const centerRow = Math.floor(tui.terminal.rows / 2);
      renderedLines[centerRow] = centeredMessage;
      return renderedLines;
    },
    invalidate: () => {},
  };

  let messageText = 'Loading...';

  return {
    show(message: string): void {
      messageText = message;
      if (overlayHandle) {
        tui.requestRender();
        return;
      }

      overlayHandle = tui.showOverlay(component, {
        row: 0,
        col: 0,
        width: '100%',
      });
      tui.requestRender();
    },
    setMessage(message: string): void {
      messageText = message;
      if (overlayHandle) {
        tui.requestRender();
      }
    },
    hide(): void {
      if (!overlayHandle) {
        return;
      }
      overlayHandle.hide();
      overlayHandle = null;
      tui.requestRender();
    },
  };
}

function centerMessage(message: string, width: number): string {
  const messageWidth = message.length;
  if (messageWidth >= width) {
    return message.slice(0, width);
  }

  const leftPadding = Math.max(0, Math.floor((width - messageWidth) / 2));
  const rightPadding = Math.max(0, width - leftPadding - messageWidth);
  return `${' '.repeat(leftPadding)}${pc.bold(message)}${' '.repeat(rightPadding)}`;
}
