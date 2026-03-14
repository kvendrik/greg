import type { Command } from 'commander';
import { notionCommand } from './notion';
import { stravaCommand } from './strava';

export const hubCommands: Command[] = [notionCommand, stravaCommand];
