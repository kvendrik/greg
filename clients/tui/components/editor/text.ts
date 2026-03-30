import {
  Editor,
  truncateToWidth,
  type TUI,
  CombinedAutocompleteProvider,
  visibleWidth,
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

const ansiReset = '\x1b[0m';
const blackBackground = '\x1b[40m';

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
    render: (width) => {
      const originalEditor = editor.render(width);
      const borderLines = originalEditor
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.includes('─'));

      if (borderLines.length < 2) {
        return originalEditor;
      }

      const contentStartIndex = borderLines[0].index + 1;
      const contentEndIndex = borderLines[borderLines.length - 1].index;
      const contentLines = originalEditor.slice(
        contentStartIndex,
        contentEndIndex
      );
      const extraLines = originalEditor.slice(contentEndIndex + 1);

      const contentLineIndex = 1;
      const cursorToken = '\x1b[7m \x1b[0m';
      const placeholderLineIndex = contentLineIndex - 1;
      const contentLine = contentLines[placeholderLineIndex];
      const cursorIndex = contentLine.indexOf(cursorToken);

      if (editor.getText() === '' && cursorIndex !== -1) {
        const lineBeforePlaceholder = contentLine.slice(
          0,
          cursorIndex + cursorToken.length
        );

        const lineAfterPlaceholder = contentLine.slice(
          cursorIndex + cursorToken.length
        );

        const placeholder = truncateToWidth(
          pc.dim('Message or / for commands...'),
          visibleWidth(lineAfterPlaceholder)
        );

        const placeholderWidth = visibleWidth(placeholder);

        contentLines[placeholderLineIndex] =
          `${lineBeforePlaceholder}${placeholder}` +
          lineAfterPlaceholder.slice(placeholderWidth);
      }

      const renderedContent = [
        renderBlackBackgroundLine('', width),
        ...contentLines.map((line) => renderBlackBackgroundLine(line, width)),
        renderBlackBackgroundLine('', width),
      ];

      return [...renderedContent, ...extraLines];
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
  };
}

function renderBlackBackgroundLine(line: string, width: number): string {
  const paddedLine = line + ' '.repeat(Math.max(0, width - visibleWidth(line)));

  return (
    blackBackground +
    paddedLine.replaceAll(ansiReset, `${ansiReset}${blackBackground}`) +
    ansiReset
  );
}
