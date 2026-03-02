import { getModel } from '@mariozechner/pi-ai';
import { Config } from './config';

const config: Config = {
  id: 'pa-agent',
  workspace: '~/.pa-agent',
  port: '3000',
  models: [
    {
      role: 'primary',
      model: getModel('anthropic', 'claude-sonnet-4-6'),
      key: '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',
    },
    {
      role: 'fallback',
      command: 'openai',
      model: getModel('openai', 'gpt-5.2'),
      key: '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',
    },
    {
      role: null,
      command: 'gemini',
      model: getModel('google', 'gemini-3-flash-preview'),
      key: 'AIzaSyDSl1-wH6mKc42Q14ote7m6g_rcTykJiEo',
    },
  ],
  tools: {
    browser: {
      key: 'bu_py0s4TYA7qmR_vle2VQ2cG0Jnk4k-JZFeMe1XaE7FqM',
    },
    notion: {
      key: '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',
    },
    strava: {
      clientId: '150190',
      clientSecret: '1374658bf3da5c4af3474cde02af1327ab3f1bba',
    },
  },
  clients: {
    default: 'cli',
    telegram: {
      botToken: '8330532183:AAFmFeoWbqRLg4PqJjF7F43si0rTxgoCgkk',
      senderId: '279197517',
    },
  },
};

export default config;
