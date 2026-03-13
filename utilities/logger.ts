export function createLogger(serviceId: string) {
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return {
    log: (...logs: string[]) => console.log(prefix(), ...logs),
    info: (...logs: string[]) => console.log(prefix(), ...logs),
    warn: (...logs: string[]) => console.warn(prefix(), ...logs),
    error: (...logs: string[]) => console.error(prefix(), ...logs),
    write: (...logs: string[]) =>
      process.stdout.write(`${prefix()} ${logs.join(' ')}\n`),
  };

  function prefix() {
    return `[${timeFormat.format(new Date())}][${serviceId}]`;
  }
}
