import patterns from './patterns.json' assert { type: 'json' };
import config from '../../../../.greg';

const CLASSIFIER_TIMEOUT_MS = config.tools.guard?.timeout ?? 15_000;
const CLASSIFIER_PORT = config.tools.guard?.port ?? 7234;
const CLASSIFIER_URL = `http://127.0.0.1:${CLASSIFIER_PORT}`;
const GUARD_ONLINE_TIMEOUT_MS = 200;

export type GuardMethods = 'patterns' | 'classifier' | 'all';

export async function available(): Promise<boolean> {
  if (!config.tools.guard?.enabled) {
    return false;
  }
  const use = config.tools.guard.use;
  if (use === 'patterns') {
    return true;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GUARD_ONLINE_TIMEOUT_MS);
    const res = await fetch(`${CLASSIFIER_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    console.error(
      '[Guard] Guard classifier is not reachable. Run `greg guard status` to check if it is running.'
    );
    return false;
  }
}

export async function isSafe(
  text: string,
  {
    use,
    name,
    logging = true,
  }: { use: GuardMethods; name: string; logging?: boolean }
): Promise<
  | {
      success: boolean;
      safe: false;
      reason: string;
      evaluatedBy: 'patterns' | 'classifier';
      message: string;
    }
  | {
      success: true;
      safe: true;
      reason: null;
      evaluatedBy: 'patterns' | 'classifier';
    }
> {
  if (logging) {
    console.log(`[Guard] Running guard on content for "${name}".`);
  }

  if (use === 'patterns' || use === 'all') {
    for (const { pattern, reason } of patterns) {
      if (new RegExp(pattern, 'i').test(text)) {
        logResult({ name, performance: 0, safe: false, reason });
        return {
          success: true,
          safe: false,
          reason,
          evaluatedBy: 'patterns',
          message: `Flagged as unsafe by guard. Reason: ${reason}`,
        };
      }
    }
  }

  if (use === 'patterns') {
    logResult({ name, performance: 0, safe: true, reason: null });
    return {
      success: true,
      safe: true,
      reason: null,
      evaluatedBy: 'patterns',
    };
  }

  const start = performance.now();
  let response: { injection: boolean; score: number; label: string };
  let end: number = 0;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
    const res = await fetch(`${CLASSIFIER_URL}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 4096) }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error ?? `Classifier returned ${res.status}`);
    }

    response = data;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';

    if (isTimeout) {
      end = performance.now();
      logResult({
        name,
        performance: end - start,
        safe: false,
        reason: 'Timeout',
      });
      return {
        success: false,
        safe: false,
        reason: null,
        evaluatedBy: 'classifier',
        message: `Scanning content failed. Content is too large to be scanned in under ${CLASSIFIER_TIMEOUT_MS / 1000} seconds`,
      };
    }

    throw err;
  }

  end = performance.now();

  const safe = response.label === 'LEGITIMATE';

  if (safe) {
    logResult({ name, performance: end - start, safe: true, reason: null });
    return {
      success: true,
      safe: true,
      reason: null,
      evaluatedBy: 'classifier',
    };
  } else {
    const reason = `Flagged as unsafe by classifier.`;
    logResult({ name, performance: end - start, safe: false, reason });
    return {
      success: true,
      safe: false,
      reason,
      evaluatedBy: 'classifier',
      message: `Flagged as unsafe by guard. Reason: classifier flagged content as unsafe.`,
    };
  }

  function logResult({
    name,
    performance,
    safe,
    reason,
  }: {
    name: string;
    performance: number;
    safe: boolean;
    reason: string | null;
  }) {
    if (logging) {
      const performanceMs = `${Math.round(performance)}ms`;
      console.log(
        `[Guard] Done running guard on content for "${name}" (took ${performanceMs}). Flagged as ${safe ? 'safe' : `unsafe.${reason ? ` Reason: ${reason}` : ''}`}.`
      );
    }
  }
}
