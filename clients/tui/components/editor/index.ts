import type { TUI } from '@mariozechner/pi-tui';
import { createTextEditor } from './text';
import { createVoiceEditor } from './voice';

export interface Tools {
  render: (width: number) => string[];
  onSubmit: (callback: (text: string) => void) => void;
  setDisabled: (disabled: boolean) => void;
  handleInput: (input: string) => void;
  setCommands: (commands: Record<string, string>) => void;
}

export function editor(tui: TUI, { voiceMode }: { voiceMode: boolean }): Tools {
  return voiceMode ? createVoiceEditor(tui) : createTextEditor(tui);
}
