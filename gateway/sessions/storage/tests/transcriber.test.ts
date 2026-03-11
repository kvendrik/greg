import { afterEach, describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import config from '../../../.greg';
import { getWorkspacePath } from '../../Agent/utilities';
import type { Callbacks, PromptInput, Agent } from '../../Agent/Agent';
import { createTranscripter } from '../transcriber';

function getLatestTranscriptPath(sessionId: string): string | null {
  const transcriptsDir = path.join(getWorkspacePath(config), 'transcripts');
  const files = fs
    .readdirSync(transcriptsDir)
    .filter((name) => name.endsWith(`_${sessionId}.jsonl`))
    .sort();

  if (!files.length) {
    return null;
  }

  return path.join(transcriptsDir, files[files.length - 1]);
}

function readLatestTranscript(sessionId: string): string[] {
  const filePath = getLatestTranscriptPath(sessionId);
  if (!filePath) {
    throw new Error('No transcript file found');
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.trim().split('\n');
}

const TEST_SESSION_ID = 'transcriber-test-session';

afterEach(() => {
  const filePath = getLatestTranscriptPath(TEST_SESSION_ID);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});

describe('transcriber', () => {
  it('writes JSONL entries for a basic turn', () => {
    const transcripter = createTranscripter(TEST_SESSION_ID);

    const callbacks: Callbacks = {};
    const agent = {} as Agent;
    const proxied = transcripter.proxy(callbacks, agent);

    const prompt: PromptInput = { content: 'Hi', images: [] };

    proxied.onTurnStart?.(prompt);
    proxied.onThinking?.('thinking...');
    proxied.onContent?.('hello');
    proxied.onTurnDone?.();

    const lines = readLatestTranscript(TEST_SESSION_ID);
    expect(lines.length).toBeGreaterThanOrEqual(4);

    const entries = lines.map((line) => JSON.parse(line) as { type: string });
    expect(entries[0].type).toBe('session_start');
    expect(entries.some((e) => e.type === 'user')).toBe(true);
    expect(entries.some((e) => e.type === 'assistant_start')).toBe(true);
    expect(entries.some((e) => e.type === 'thinking')).toBe(true);
    expect(entries.some((e) => e.type === 'content')).toBe(true);
    expect(entries.some((e) => e.type === 'assistant_end')).toBe(true);
  });
});

