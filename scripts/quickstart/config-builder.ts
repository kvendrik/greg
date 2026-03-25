import * as prettier from 'prettier';

export function createConfigBuilder(): {
  get: () => Promise<string>;
  add: (key: string, entry: string, position?: 'tool' | 'root') => void;
} {
  let configContent = `import { type Config, getModel, exec } from '@kvendrik/greg/config';
  
  const config: Config = {
    [...]
    heartbeat: {
      enabled: false,
    },
    tools: {
      [T...]
      guard: {
        enabled: true,
        ask: true,
        exec: {
          profiles: exec.profiles,
          allowBins: exec.merge<typeof exec.profiles>(
            exec.readOnly,
            exec.safeWrite
          ),
        },
      },
    },
  };
  
  export default config;
  `;

  return {
    get: () => {
      const content = configContent.replace('[T...]', '').replace('[...]', '');

      return prettier.format(content, {
        parser: 'typescript',
        semi: true,
        singleQuote: true,
        tabWidth: 2,
        useTabs: false,
      });
    },
    add: (key: string, entry: string, position: 'tool' | 'root' = 'root') => {
      const placeholder = position === 'tool' ? `[T...]` : `[...]`;
      const nextPlaceholder = position === 'tool' ? `\n[T...]` : `\n[...]`;
      configContent = configContent.replace(
        placeholder,
        `${key}: ${entry},${nextPlaceholder}`
      );
    },
  };
}
