type Log = (string | object)[];

export function createLogger(serviceId: string) {
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return {
    log: (...logs: Log) => console.log(prefix(), transform(logs)),
    info: (...logs: Log) => console.log(prefix(), transform(logs)),
    warn: (...logs: Log) => console.warn(prefix(), transform(logs)),
    error: (...logs: Log) => console.error(prefix(), transform(logs)),
    write: (...logs: Log) =>
      process.stdout.write(`${prefix()} ${transform(logs)}\n`),
  };

  function transform(logs: Log) {
    return logs
      .map((log) => {
        if (typeof log === 'object') {
          return JSON.stringify(log, null, 2);
        }
        return log;
      })
      .join(' ');
  }

  function prefix() {
    return `[${timeFormat.format(new Date())}][${serviceId}]`;
  }
}
