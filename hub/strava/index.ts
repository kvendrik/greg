import { stravaCommand } from './strava';

if (import.meta.main) {
  stravaCommand.parse(process.argv);
}

export { stravaCommand };
