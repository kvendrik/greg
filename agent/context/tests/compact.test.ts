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
      input: 4_200,
      output: 800,
      cacheRead: 8_500,
      cacheWrite: 3_200,
      totalTokens: 16_700,
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
        userMessage('Can you refactor the auth middleware to use JWT?'),
        assistantMessage(
          'I\'ll update the middleware to validate JWTs using the jsonwebtoken library. Here\'s the refactored version with token verification and role-based access control.',
        ),
      ];

      const result = await compact(messages, { model: mockModel });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toBe(messages);
      expect(!result.didCompact && result.reason).toContain('within budget');
    });

    it('compacts when force is true even if context is small', async () => {
      const messages = [
        userMessage('Add error handling for database connection timeouts.'),
        assistantMessage(
          'I\'ve wrapped the database calls in a retry loop with exponential backoff and added a ConnectionTimeoutError class.',
        ),
        userMessage('Also add a circuit breaker pattern for repeated failures.'),
        assistantMessage(
          'Done. The CircuitBreaker class tracks failures and opens after 5 consecutive timeouts, with a 30-second recovery window.',
        ),
        userMessage('Can you write tests for both the retry logic and the circuit breaker?'),
        assistantMessage(
          'Here are the tests covering timeout retries, backoff intervals, circuit breaker state transitions, and the recovery window.',
        ),
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
        userMessage('What\'s the best approach for rate limiting our API?'),
        assistantMessage(
          'I recommend a sliding window approach using Redis. Here\'s an implementation with configurable limits per endpoint.',
        ),
        userMessage('Can you add different tiers for free vs paid users?'),
        assistantMessage(
          'Updated the rate limiter with a tier-based config. Free users get 100 req/min, paid get 1000 req/min.',
        ),
        userMessage('Add a 429 response with a Retry-After header when the limit is hit.'),
        assistantMessage(
          'Added the 429 handler with Retry-After set to the window reset time. Also included the X-RateLimit-Remaining header.',
        ),
      ];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(true);
      expect(result.messages.length).toBeGreaterThan(1);

      const summaryMsg = result.messages[0]!;
      expect(
        typeof summaryMsg.content === 'string' &&
          summaryMsg.content.startsWith(SUMMARY_PREFIX)
      ).toBe(true);
    });

    it('preserves 5 recent user turns and their surrounding messages', async () => {
      const turns = [
        ['Set up the project with TypeScript and ESLint.', 'Initialized the project with tsconfig.json, ESLint flat config, and added the dev dependencies.'],
        ['Add a PostgreSQL connection pool using pg.', 'Created a connection pool with a max of 20 connections, idle timeout of 30s, and health check queries.'],
        ['Create the users table migration.', 'Here\'s the migration with id, email, password_hash, created_at, and updated_at columns plus a unique index on email.'],
        ['Build the user registration endpoint.', 'Added POST /api/users with email validation, bcrypt hashing, and duplicate email detection.'],
        ['Add email verification with a token-based flow.', 'Created the verification_tokens table, a mailer service, and the GET /api/verify endpoint.'],
        ['Implement login with session cookies.', 'Added POST /api/login with bcrypt comparison, httpOnly secure cookies, and CSRF protection.'],
        ['Add a password reset flow.', 'Built the forgot-password and reset-password endpoints with time-limited tokens and email notifications.'],
        ['Write integration tests for the full auth flow.', 'Here are the integration tests covering registration, verification, login, and password reset with a test database.'],
      ] as const;

      const messages: AgentMessage[] = [];
      for (const [userText, assistantText] of turns) {
        messages.push(userMessage(userText));
        messages.push(assistantMessage(assistantText));
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
      const messages = [
        assistantMessage('Welcome! I\'m ready to help you with your project.'),
      ];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toBe(messages);
    });

    it('skips compaction when preserved tail covers the full conversation', async () => {
      const messages = [
        userMessage('Explain how the WebSocket reconnection logic works.'),
      ];

      const result = await compact(messages, {
        model: mockModel,
        force: true,
      });

      expect(result.didCompact).toBe(false);
      expect(result.messages).toBe(messages);
    });

    it('falls back to fewer preserved turns when the tail exceeds the token budget', async () => {
      const turns = [
        ['Scaffold the entire data access layer for all 12 database tables.', 'Here are the complete CRUD modules for all 12 tables with typed queries, transactions, and connection management.'],
        ['Generate the full OpenAPI spec and all route handlers.', 'Created the OpenAPI 3.1 spec and all 47 route handlers with request validation, error handling, and response serialization.'],
        ['Write comprehensive test suites for every module.', 'Here are the test suites with unit, integration, and edge case coverage for all modules including database fixtures.'],
        ['Build the admin dashboard with all CRUD views.', 'Generated the full admin dashboard with data tables, forms, filters, and role-based access for all 12 entities.'],
        ['Create the CI/CD pipeline config and Docker setup.', 'Here\'s the multi-stage Dockerfile, docker-compose for local dev, and the GitHub Actions pipeline with test, build, and deploy stages.'],
        ['Add monitoring, alerting, and structured logging across all services.', 'Integrated OpenTelemetry tracing, Prometheus metrics, PagerDuty alerting rules, and structured JSON logging throughout.'],
        ['Generate the API client SDK with full type safety.', 'Built the typed API client from the OpenAPI spec with request/response types, error handling, and retry logic.'],
        ['Write the full end-to-end test suite.', 'Here are the E2E tests covering all critical user flows with Playwright, including auth, CRUD operations, and admin workflows.'],
      ] as const;

      const messages: AgentMessage[] = [];
      for (const [userText, assistantText] of turns) {
        messages.push(userMessage(userText));
        messages.push(assistantMessage(assistantText, { output: 18_000 }));
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
        userMessage('Refactor the payment module to support Stripe and PayPal.'),
        assistantMessage(
          'Created a PaymentProvider interface with Stripe and PayPal implementations, and a factory for runtime selection.',
        ),
        userMessage('Add webhook handlers for payment status updates.'),
        assistantMessage(
          'Added webhook endpoints for both providers with signature verification and idempotent status updates.',
        ),
        userMessage('Handle partial refunds and disputed charges.'),
        assistantMessage(
          'Implemented partial refund logic with amount validation and dispute handling with automatic evidence submission.',
        ),
      ];

      let capturedInstructions: { content: string; strategy: string } | undefined;
      void mock.module('../summarize', () => ({
        SUMMARY_PREFIX,
        summarize: (msgs: AgentMessage[], opts: { instructions?: { content: string; strategy: string } }) => {
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

      expect(capturedInstructions).toEqual({ content: 'focus on decisions', strategy: 'append' });
    });

    it('handles repeated compaction without re-summarizing existing summaries', async () => {
      const messages: AgentMessage[] = [
        summaryMessage(
          'Set up a TypeScript project with PostgreSQL. Built user registration, email verification, and login with session cookies. Added rate limiting with Redis and tiered access for free/paid users.',
        ),
      ];

      const turns = [
        ['Add a password reset flow with time-limited tokens.', 'Built forgot-password and reset-password endpoints with 1-hour token expiry and email notifications.'],
        ['Implement OAuth2 login with Google and GitHub.', 'Added OAuth2 providers with callback handlers, account linking, and automatic profile population.'],
        ['Add two-factor authentication using TOTP.', 'Implemented TOTP-based 2FA with QR code generation, backup codes, and enforcement for admin accounts.'],
        ['Build an audit log for all auth events.', 'Created an append-only audit_events table with structured JSON payloads and a query API with date range filters.'],
        ['Add session management with device tracking.', 'Built a sessions dashboard showing active devices, last activity, and remote revocation support.'],
        ['Write integration tests for the full auth flow.', 'Here are integration tests covering OAuth, 2FA enrollment, session management, and audit log entries.'],
        ['Add API key authentication for service-to-service calls.', 'Created an api_keys table with scoped permissions, rate limiting per key, and automatic rotation reminders.'],
        ['Set up Prometheus metrics for auth endpoints.', 'Added login attempt counters, 2FA success/failure rates, session duration histograms, and a Grafana dashboard config.'],
      ] as const;

      for (const [userText, assistantText] of turns) {
        messages.push(userMessage(userText));
        messages.push(assistantMessage(assistantText));
      }

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
      expect(summaries.length).toBe(2);

      const compactedMessages = summarizeCalls[0]!;
      const summariesInCompacted = compactedMessages.filter(
        (msg) =>
          typeof msg.content === 'string' &&
          msg.content.startsWith(SUMMARY_PREFIX)
      );
      expect(summariesInCompacted.length).toBe(0);
    });
  });
});
