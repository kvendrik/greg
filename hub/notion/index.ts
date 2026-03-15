import { notionCommand } from './notion';

if (import.meta.main) {
  notionCommand.parse(process.argv);
}

export { notionCommand };
