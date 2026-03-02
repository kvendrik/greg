import { Config } from './config-types';

const config: Config = {
  workspace: '~/.pa-agent',
  port: '3000',
  providers: {
    anthropic: {
      key: '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',
    },
    openai: {
      key: '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',
    },
    gemini: {
      key: 'AIzaSyDSl1-wH6mKc42Q14ote7m6g_rcTykJiEo',
    },
    roles: {
      primary: 'anthropic',
      fallback: 'openai',
    },
  },
  tools: {
    browser: {
      key: 'bu_py0s4TYA7qmR_vle2VQ2cG0Jnk4k-JZFeMe1XaE7FqM',
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
