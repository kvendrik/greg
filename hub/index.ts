import type { Command } from 'commander';
import { notionCommand } from './notion';
import { stravaCommand } from './strava';
import { voicecallCommand } from './voicecall';

export const hubCommands: Command[] = [
  notionCommand,
  stravaCommand,
  voicecallCommand,
];
