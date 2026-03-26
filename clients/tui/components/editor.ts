import { Editor, type TUI } from '@mariozechner/pi-tui';
import { CombinedAutocompleteProvider } from '@mariozechner/pi-tui';
import { get as getConfig } from '../../../config';
import { listCommands } from '../../../agent/commands';
import pc from 'picocolors';

const config = await getConfig();
const commands = listCommands(config);

interface Tools {
  render: (width: number) => string[];
  onSubmit: (callback: (text: string) => void) => void;
  setDisabled: (disabled: boolean) => void;
  handleInput: (input: string) => void;
}

export function editor(tui: TUI): Tools {
  const editor = new Editor(tui, {
    borderColor: (text) => pc.dim(text),
    selectList: {
      selectedPrefix: (text) => pc.cyan(text),
      selectedText: (text) => pc.bold(text),
      description: (text) => pc.dim(text),
      scrollInfo: (text) => pc.gray(text),
      noMatch: (text) => pc.yellow(text),
    },
  });

  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      commands.map((command) => ({ name: command, description: '' })),
      process.cwd()
    )
  );

  return {
    render: (width) => {
      return editor.render(width);
    },
    onSubmit(callback) {
      editor.onSubmit = (text) => {
        editor.addToHistory(text);
        callback(text);
        tui.requestRender();
      };
    },
    handleInput(input) {
      editor.handleInput(input);
    },
    setDisabled(disabled: boolean) {
      editor.disableSubmit = disabled;
    },
  };
}
