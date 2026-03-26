import { type Component, type TUI } from '@mariozechner/pi-tui';
import pc from 'picocolors';

export class Spinner implements Component {
  private readonly frames: string[] = [
    '⠋',
    '⠙',
    '⠹',
    '⠸',
    '⠼',
    '⠴',
    '⠦',
    '⠧',
    '⠇',
    '⠏',
  ];
  private readonly tickMs = 80;
  private readonly spinnerColor = (text: string): string => pc.cyan(text);
  private readonly messageColor = (text: string): string => pc.dim(text);
  private readonly ui: TUI;
  private frameIndex = 0;
  private intervalHandle: ReturnType<typeof setInterval> | undefined =
    undefined;
  private running = false;
  private message = 'Thinking...';

  constructor(tui: TUI) {
    this.ui = tui;
  }

  start(message: string): void {
    this.message = message;
    if (this.running) {
      return;
    }
    this.running = true;
    this.intervalHandle = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.ui.requestRender();
    }, this.tickMs);
    this.ui.requestRender();
  }

  stop(): void {
    this.running = false;
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.ui.requestRender();
  }

  setMessage(message: string): void {
    this.message = message;
    this.ui.requestRender();
  }

  public render(_width: number): string[] {
    if (!this.running) {
      return [];
    }
    const frame = this.spinnerColor(this.frames[this.frameIndex]);
    const spinnerMessage = this.messageColor(this.message);
    return [` ${frame} ${spinnerMessage}`];
  }

  public invalidate(): void {}
}
