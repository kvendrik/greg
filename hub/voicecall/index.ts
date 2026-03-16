import { voicecallCommand } from './cli';

if (import.meta.main) {
  voicecallCommand.parse(process.argv);
}

export { voicecallCommand };
