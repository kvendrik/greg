export interface Config {
  /**
   * Path to your workspace folder (Markdown memory files live here).
   * Will be created if it doesn't exist.
   */
  workspace: string;
  /**
   * Port for the agent server. `greg start` to start the server.
   */
  port: string;
  /**
   * LLM providers to use for the agent.
   */
  providers: {
    anthropic: {
      /**
       * https://console.anthropic.com/settings/keys
       */
      key: string;
    };
    openai: {
      /**
       * https://platform.openai.com/api-keys
       */
      key: string;
    };
    gemini: {
      /**
       * https://aistudio.google.com/apikey
       */
      key: string;
    };
    /**
     * Providers to use as your main LLM and which one to use as the fallback
     * in case your main provider isn't available.
     */
    roles: {
      primary: Exclude<keyof Config['providers'], 'roles'>;
      fallback: Exclude<keyof Config['providers'], 'roles'>;
    };
  };
  tools: {
    browser: {
      /**
       * https://cloud.browser-use.com/settings?tab=api-keys&new=1
       */
      key: string;
    };
  };
  clients?: {
    /**
     * When running `greg` in the CLI without any arguments, the first time the server will start.
     * If the server is already running, running `greg` again will start whatever client is set as the default.
     */
    default?: 'cli' | 'telegram';
    telegram?: {
      /**
       * https://core.telegram.org/bots#how-do-i-create-a-bot
       */
      botToken: string;
      /**
       * Your user ID (e.g. from [@userinfobot](https://t.me/userinfobot)).
       */
      senderId: string;
    };
  };
}
