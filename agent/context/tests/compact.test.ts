import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { Model, Api } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { SUMMARY_PREFIX } from '../summarize';

function userMessage(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: Date.now() };
}

function assistantMessage(
  text: string,
  usageOverrides: Record<string, unknown> = {}
): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      ...usageOverrides,
    },
  } as AgentMessage;
}

function summaryMessage(text: string): AgentMessage {
  return userMessage(`${SUMMARY_PREFIX}${text}`);
}

const mockModel = {
  model: {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet',
    provider: 'anthropic',
    contextWindow: 200_000,
  } as Model<Api>,
  key: 'test-key',
};

let summarizeCalls: AgentMessage[][] = [];

void mock.module('../summarize', () => ({
  SUMMARY_PREFIX,
  summarize: (messages: AgentMessage[]) => {
    summarizeCalls.push(messages);
    return [summaryMessage('Summary of compacted messages.')];
  },
}));

const { compact } = await import('../compact');

describe('compact', () => {
  beforeEach(() => {
    summarizeCalls = [];
  });

  describe('compact()', () => {
    it('skips compaction when context is under the soft limit', async () => {
      const messages = [
        userMessage('hello'),
        assistantMessage('hi there', { input: 100 }),
      ];

      const result = await compact(messages, { model: mockModel });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toBe(messages);
      expect(!result.didCompact && result.reason).toContain('within budget');
    });

    it('compacts when force is true even if context is small', async () => {
      const messages = [
        userMessage('msg 1'),
        assistantMessage('reply 1'),
        userMessage('msg 2'),
        assistantMessage('reply 2'),
        userMessage('msg 3'),
        assistantMessage('reply 3'),
      ];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(true);
      expect(summarizeCalls.length).toBe(1);
    });

    it('preserves the tail starting from the earliest available user message when fewer than 5 user turns', async () => {
      const messages = [
        userMessage('msg 1'),
        assistantMessage('reply 1'),
        userMessage('msg 2'),
        assistantMessage('reply 2'),
        userMessage('msg 3'),
        assistantMessage('reply 3'),
      ];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(true);
      expect(result.messages.length).toBeGreaterThan(1);

      const summaryMsg = result.messages[0];
      expect(
        typeof summaryMsg.content === 'string' &&
          summaryMsg.content.startsWith(SUMMARY_PREFIX)
      ).toBe(true);
    });

    it('preserves 5 recent user turns and their surrounding messages', async () => {
      const messages: AgentMessage[] = [];

      for (let turn = 1; turn <= 8; turn++) {
        messages.push(userMessage(`msg ${turn}`));
        messages.push(assistantMessage(`reply ${turn}`));
      }

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(true);

      const preserved = result.messages.slice(1);
      const preservedUserMessages = preserved.filter(
        (msg) => msg.role === 'user'
      );
      expect(preservedUserMessages.length).toBeLessThanOrEqual(5);
    });

    it('skips compaction when no user messages exist', async () => {
      const messages = [assistantMessage('hello')];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toBe(messages);
      expect(!result.didCompact && result.reason).toContain('No user messages');
    });

    it('skips compaction when preserved tail covers the full conversation', async () => {
      const messages = [userMessage('only message')];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toBe(messages);
      expect(!result.didCompact && result.reason).toContain(
        'covers the full conversation'
      );
    });

    it('falls back to fewer preserved turns when the tail exceeds the token budget', async () => {
      const bigContent = 'x'.repeat(200_000);
      const messages: AgentMessage[] = [];

      for (let turn = 1; turn <= 8; turn++) {
        messages.push(userMessage(`msg ${turn}`));
        messages.push(assistantMessage(bigContent));
      }

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(true);

      const preserved = result.messages.slice(1);
      const preservedUserMessages = preserved.filter(
        (msg) => msg.role === 'user'
      );
      expect(preservedUserMessages.length).toBeLessThan(5);
    });

    it('passes instructions through to the summarizer', async () => {
      const messages = [
        userMessage('msg 1'),
        assistantMessage('reply 1'),
        userMessage('msg 2'),
        assistantMessage('reply 2'),
        userMessage('msg 3'),
        assistantMessage('reply 3'),
      ];

      let capturedInstructions: string | undefined;
      void mock.module('../summarize', () => ({
        SUMMARY_PREFIX,
        summarize: (msgs: AgentMessage[], opts: { instructions?: string }) => {
          capturedInstructions = opts.instructions;
          summarizeCalls.push(msgs);
          return [summaryMessage('Summary.')];
        },
      }));

      const { compact: freshCompact } = await import('../compact');

      await freshCompact(messages, {
        model: mockModel,
        force: true,
        instructions: { content: 'focus on decisions', strategy: 'append' },
      });

      expect(capturedInstructions).toBe('focus on decisions');
    });

    it('handles repeated compaction without error', async () => {
      const messages: AgentMessage[] = [
        summaryMessage('Previous summary from an earlier compaction.'),
        userMessage('msg after first compact 1'),
        assistantMessage('reply 1'),
        userMessage('msg after first compact 2'),
        assistantMessage('reply 2'),
        userMessage('msg after first compact 3'),
        assistantMessage('reply 3'),
      ];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(true);
      expect(result.messages.length).toBeGreaterThan(0);

      const summaries = result.messages.filter(
        (msg) =>
          typeof msg.content === 'string' &&
          msg.content.startsWith(SUMMARY_PREFIX)
      );
      expect(summaries.length).toBe(1);
    });
  });
});
