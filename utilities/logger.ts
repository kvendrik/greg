type Log = (string | object)[];

export interface Logger {
  log: (...logs: Log) => void;
  info: (...logs: Log) => void;
  warn: (...logs: Log) => void;
  error: (...logs: Log) => void;
  write: (...logs: Log) => void;
}

export function createLogger(
  serviceId?: string,
  options?: { addTimestamp?: boolean }
): Logger {
  const { addTimestamp = true } = options ?? {
    addTimestamp: Boolean(serviceId),
  };

  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return {
    log: (...logs: Log) => !isMuted() && console.log(join(logs)),
    info: (...logs: Log) => !isMuted() && console.log(join(logs)),
    warn: (...logs: Log) => !isMuted() && console.warn(join(logs)),
    error: (...logs: Log) => { console.error(join(logs)); },
    write: (...logs: Log) => !isMuted() && process.stdout.write(join(logs)),
  };

  function join(logs: Log) {
    const p = prefix();
    return p.length > 0 ? `${p} ${transform(logs)}` : transform(logs);
  }

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
    return `${addTimestamp ? `[${timeFormat.format(new Date())}]` : ''}${serviceId ? `[${serviceId}]` : ''}`;
  }

  function isMuted() {
    return process.env.GREG_LOG === 'silent';
  }
}
