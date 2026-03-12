export function createLogger(serviceId: string) {
  return {
    info: (...logs: string[]) => console.log(`[${serviceId}]`, ...logs),
    error: (...logs: string[]) => console.error(`[${serviceId}]`, ...logs),
    write: (...logs: string[]) =>
      process.stdout.write(`[${serviceId}] ${logs.join(' ')}\n`),
  };
}
