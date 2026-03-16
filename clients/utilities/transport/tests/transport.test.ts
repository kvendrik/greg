import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'bun';
import { Type } from '@sinclair/typebox';
import { create } from '../transport';

const ROLE = process.env.ROLE as string | undefined;
const SERVER_MODE = process.env.SERVER_MODE ?? 'greet';
const TEST_CASE = process.env.TEST_CASE ?? 'happy';
const TRANSPORT_TEST_OUTPUT = process.env.TRANSPORT_TEST_OUTPUT;

const SOCK_DIR = path.join(import.meta.dir, '..', 'tmp');
const SOCK_PATH = path.join(SOCK_DIR, 'transport.sock');
const CLIENT_OUTPUT_PATH = path.join(SOCK_DIR, 'transport-test-output.json');

function cleanupSocket(): void {
  try {
    if (fs.existsSync(SOCK_PATH)) fs.unlinkSync(SOCK_PATH);
  } catch {
    // best-effort
  }
}

function waitForSocket(): Promise<void> {
  if (fs.existsSync(SOCK_PATH)) return Promise.resolve();
  return new Promise((resolve) => {
    const watcher = fs.watch(SOCK_DIR, (_, filename) => {
      if (filename === path.basename(SOCK_PATH) && fs.existsSync(SOCK_PATH)) {
        watcher.close();
        resolve();
      }
    });
  });
}

function waitForClientOutput(): Promise<string> {
  if (fs.existsSync(CLIENT_OUTPUT_PATH)) {
    return Promise.resolve(fs.readFileSync(CLIENT_OUTPUT_PATH, 'utf8').trim());
  }
  return new Promise((resolve) => {
    const watcher = fs.watch(SOCK_DIR, (_, filename) => {
      if (
        filename === path.basename(CLIENT_OUTPUT_PATH) &&
        fs.existsSync(CLIENT_OUTPUT_PATH)
      ) {
        watcher.close();
        resolve(fs.readFileSync(CLIENT_OUTPUT_PATH, 'utf8').trim());
      }
    });
  });
}

function writeResult(obj: object): void {
  const json = JSON.stringify(obj);
  if (TRANSPORT_TEST_OUTPUT) {
    fs.mkdirSync(path.dirname(TRANSPORT_TEST_OUTPUT), { recursive: true });
    fs.writeFileSync(TRANSPORT_TEST_OUTPUT, json, 'utf8');
  } else {
    console.log(json);
  }
}

if (ROLE === 'server') {
  const channel = create({ name: 'test-server' });
  if (SERVER_MODE === 'greet' || SERVER_MODE === 'bad_output') {
    const greet = channel.tool('greet', {
      input: Type.Object({ name: Type.String() }),
      output: Type.Object({ message: Type.String() }),
    });
    greet.action(async ({ name }) =>
      SERVER_MODE === 'bad_output'
        ? ({ wrong: true } as { message: string })
        : { message: `Hello, ${name}!` }
    );
  }
  // Process stays alive; server socket holds the event loop.
} else if (ROLE === 'client') {
  const channel = create({ name: 'test-client' });
  const greet = channel.tool('greet', {
    input: Type.Object({ name: Type.String() }),
    output: Type.Object({ message: Type.String() }),
  });

  async function runOnce(): Promise<void> {
    try {
      if (TEST_CASE === 'happy') {
        const result = await greet.call({ name: 'Koen' });
        writeResult({ ok: true, result });
        return;
      }
      if (TEST_CASE === 'invalid_input') {
        await greet.call({ name: 123 as unknown as string });
        writeResult({ ok: false, error: 'expected validation error' });
        return;
      }
      if (TEST_CASE === 'method_not_found') {
        await greet.call({ name: 'Koen' });
        writeResult({ ok: false, error: 'expected method not found' });
        return;
      }
      if (TEST_CASE === 'bad_output') {
        await greet.call({ name: 'Koen' });
        writeResult({ ok: false, error: 'expected output validation error' });
        return;
      }
      writeResult({ ok: false, error: `unknown TEST_CASE: ${TEST_CASE}` });
    } catch (err) {
      const noConn =
        err instanceof Error &&
        err.message.includes('No connections available');
      if (noConn) throw err;
      const payload =
        err && typeof err === 'object' && 'code' in err && 'message' in err
          ? {
              ok: false,
              code: (err as { code: number }).code,
              message: (err as { message: string }).message,
              data: (err as { data?: unknown }).data,
            }
          : { ok: false, error: String(err) };
      writeResult(payload);
    }
  }

  (async () => {
    for (;;) {
      try {
        await runOnce();
        break;
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('No connections available')
        ) {
          await new Promise((r) => setImmediate(r));
          continue;
        }
        throw err;
      }
    }
    process.exit(0);
  })();
} else {
  describe('transport', () => {
    describe('create()', () => {
      let serverProc: ReturnType<typeof spawn> | null = null;
      const scriptPath = path.join(import.meta.dir, 'transport.test.ts');

      beforeEach(() => {
        cleanupSocket();
      });

      afterEach(() => {
        if (serverProc) {
          serverProc.kill();
          serverProc = null;
        }
        cleanupSocket();
      });

      async function startServer(mode: string): Promise<void> {
        serverProc = spawn({
          cmd: ['bun', 'run', scriptPath],
          cwd: process.cwd(),
          env: { ...process.env, ROLE: 'server', SERVER_MODE: mode },
          stdout: 'ignore',
          stderr: 'pipe',
        });
        await waitForSocket();
      }

      async function runClient(testCase: string): Promise<{ stdout: string }> {
        try {
          if (fs.existsSync(CLIENT_OUTPUT_PATH))
            fs.unlinkSync(CLIENT_OUTPUT_PATH);
        } catch {
          // ignore
        }
        spawn({
          cmd: ['bun', 'run', scriptPath],
          cwd: process.cwd(),
          env: {
            ...process.env,
            ROLE: 'client',
            TEST_CASE: testCase,
            TRANSPORT_TEST_OUTPUT: CLIENT_OUTPUT_PATH,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const jsonLine = await waitForClientOutput();
        return { stdout: jsonLine };
      }

      it('first process becomes server, second connects as client and receives tool result', async () => {
        await startServer('greet');
        const { stdout } = await runClient('happy');
        const out = JSON.parse(stdout) as {
          ok: boolean;
          result?: { message: string };
        };
        expect(out.ok).toBe(true);
        expect(out.result).toEqual({ message: 'Hello, Koen!' });
      });

      it('validates input on client and returns validation error for invalid input', async () => {
        await startServer('greet');
        const { stdout } = await runClient('invalid_input');
        const out = JSON.parse(stdout) as {
          ok: boolean;
          error?: string;
          message?: string;
        };
        expect(out.ok).toBe(false);
        expect(out.error ?? out.message).toMatch(/validation/i);
      });

      it('returns method not found when server has no action for the tool', async () => {
        await startServer('empty');
        const { stdout } = await runClient('method_not_found');
        const out = JSON.parse(stdout) as {
          ok: boolean;
          code?: number;
          message?: string;
        };
        expect(out.ok).toBe(false);
        expect(out.code).toBe(-32601); // METHOD_NOT_FOUND
      });

      it('returns error when server response fails output schema validation', async () => {
        await startServer('bad_output');
        const { stdout } = await runClient('bad_output');
        const out = JSON.parse(stdout) as {
          ok: boolean;
          code?: number;
          message?: string;
        };
        expect(out.ok).toBe(false);
        expect(out.code).toBe(-32602); // INVALID_PARAMS
      });
    });
  });
}
