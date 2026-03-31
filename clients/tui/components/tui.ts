import { TUI, ProcessTerminal } from '@mariozechner/pi-tui';

export function tui(): TUI {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  let hasStoppedTui = false;

  // const enterAltScreen = (): void => {
  //   process.stdout.write('\x1b[?1049h');
  //   process.stdout.write('\x1b[?1007h');
  //   process.stdout.write('\x1b[?1000h');
  //   process.stdout.write('\x1b[?1002h');
  //   process.stdout.write('\x1b[?1006h');
  // };

  // const exitAltScreen = (): void => {
  //   process.stdout.write('\x1b[?1006l');
  //   process.stdout.write('\x1b[?1002l');
  //   process.stdout.write('\x1b[?1000l');
  //   process.stdout.write('\x1b[?1007l');
  //   process.stdout.write('\x1b[?1049l');
  // };

  const stopTui = (reason?: unknown): void => {
    if (reason) console.error(reason);
    if (hasStoppedTui) {
      return;
    }
    hasStoppedTui = true;
    tui.stop();
    //exitAltScreen();
    process.exit(0);
  };

  process.on('SIGINT', stopTui);
  process.on('SIGTERM', stopTui);
  process.on('uncaughtException', stopTui);
  process.on('unhandledRejection', stopTui);

  //enterAltScreen();

  tui.addInputListener((input) => {
    if (input === '\u0003') {
      stopTui();
      return { consume: true };
    }
    return {};
  });

  return tui;
}
