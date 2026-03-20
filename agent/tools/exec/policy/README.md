```ts
export const config = {
  ...
  tools: {
    guard: {
      exec: {
        allowBins: {
          '/some/absolute/path/greg': { profiles: ['greg_read'] },
        },
        profiles: {
          greg_read: {
            // allowFlags: strict allowlist.
            // Only flags present in allowFlags are permitted.
            allowFlags: {
              '--help': { takesValue: false },
              '-n': {
                takesValue: true,
                value: { type: 'int', min: 1, max: 200 },
              },
            },
            // denylist mode (instead of allowFlags):
            // - omit allowFlags entirely
            // - set denyFlags to a non-empty array
            // In denylist mode, all flags are allowed except the ones in denyFlags.
            denyFlags: ['-n'],
            allowSubcommands: [
               ['logs'],
               // will only allow `greg telegram`
              ['telegram'],
              // will only allow `greg telegram <another_command>`
              ['telegram', '*'],
              // will allow `greg telegram <...any number of commands>`
              ['telegram', '**'],
            ],
          },
        },
      },
    },
  },
  ...
};
```
