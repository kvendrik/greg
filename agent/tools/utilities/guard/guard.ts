import patterns from './patterns.json' assert { type: 'json' };
import config from '../../../../.greg';

const CLASSIFIER_TIMEOUT_MS = config.tools.guard?.timeout ?? 15_000;
const CLASSIFIER_URL = 'http://127.0.0.1:7234';

export type GuardMethods = 'patterns' | 'classifier' | 'all';

export async function isSafe(
  text: string,
  { use }: { use: GuardMethods }
): Promise<
  | {
      success: boolean;
      safe: false;
      reason: string;
      evaluatedBy: 'patterns' | 'classifier';
      message: string;
      performance?: string;
    }
  | {
      success: true;
      safe: true;
      reason: null;
      evaluatedBy: 'patterns' | 'classifier';
      performance?: string;
    }
> {
  if (use === 'patterns' || use === 'all') {
    for (const { pattern, reason } of patterns) {
      if (new RegExp(pattern, 'i').test(text)) {
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
    return {
      success: true,
      safe: true,
      reason: null,
      evaluatedBy: 'patterns',
    };
  }

  const start = performance.now();
  let response: { injection: boolean; score: number; label: string };

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

  const end = performance.now();
  const performanceMs = `${Math.round(end - start)}ms`;

  const safe = response.label === 'LEGITIMATE';

  if (safe) {
    return {
      success: true,
      safe: true,
      reason: null,
      evaluatedBy: 'classifier',
      performance: performanceMs,
    };
  } else {
    return {
      success: true,
      safe: false,
      reason: 'Flagged as unsafe by classifier',
      evaluatedBy: 'classifier',
      message: `Flagged as unsafe by guard. Reason: classifier flagged content as unsafe.`,
      performance: performanceMs,
    };
  }
}
