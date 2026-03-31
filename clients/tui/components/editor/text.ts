import {
  Editor,
  type TUI,
  CombinedAutocompleteProvider,
} from '@mariozechner/pi-tui';
import { listCommands } from '../../../../agent/commands';
import { get as getConfig } from '../../../../config';
import pc from 'picocolors';
import type { Tools } from './index';

const config = await getConfig();
const globalCommands = listCommands(config).map((commandInfo) => ({
  name: commandInfo.command.replace('/', ''),
  description: commandInfo.description,
}));

const selectListTheme = {
  selectedPrefix: (text: string) => pc.bold(text),
  selectedText: (text: string) => pc.bold(pc.blue(text)),
  description: (text: string) => pc.dim(text),
  scrollInfo: (text: string) => pc.gray(text),
  noMatch: (text: string) => pc.yellow(text),
};

export function createTextEditor(tui: TUI): Tools {
  const editor = new Editor(
    tui,
    {
      borderColor: (text) => pc.dim(text),
      selectList: selectListTheme,
    },
    {
      paddingX: 2,
    }
  );

  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(globalCommands, process.env.PWD)
  );

  return {
    render: (width) => editor.render(width),
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
    setDisabled(nextDisabled: boolean) {
      editor.disableSubmit = nextDisabled;
    },
    setCommands(cmds: Record<string, string>) {
      const prov = new CombinedAutocompleteProvider(
        Object.entries(cmds).map(([name, description]) => ({
          name,
          description,
        })),
        process.cwd()
      );
      editor.setAutocompleteProvider(prov);
      editor.setText('');
      editor.handleInput('/');
    },
    resetCommands() {
      const prov = new CombinedAutocompleteProvider(
        globalCommands,
        process.env.PWD
      );
      editor.setAutocompleteProvider(prov);
    },
  };
}
