import { fetch as fetchNotion } from './notion';
import { execSync } from 'child_process';
import { embed } from './qmd';

console.log('Fetching Notion...');
await fetchNotion();

console.log('...indexing');
embed();
