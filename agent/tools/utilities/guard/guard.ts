import { pipeline } from '@huggingface/transformers';
import patterns from './patterns.json' assert { type: 'json' };
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../../../.greg';

const CLASSIFIER_TIMEOUT_MS = config.tools.guard?.timeout ?? 15_000;
const ONNX_MODEL_FILE = 'model';
const guardDir = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_MODEL_PATH = path.join(
  guardDir,
  'models',
  'Llama-Prompt-Guard-2-22M-onnx'
);

type ClassificationResult = {
  label: 'BENIGN' | 'MALICIOUS';
  score: number;
}[];

type Classifier = (
  texts: string | string[],
  options?: { top_k?: number }
) => Promise<ClassificationResult>;

export type GuardMethods = 'patterns' | 'classifier' | 'all';
let classifier: Classifier | null = null;

function configUsesClassifier(): boolean {
  if (!config.tools.guard) {
    return false;
  }

  if (
    config.tools.guard?.use === 'classifier' ||
    config.tools.guard?.use === 'all'
  ) {
    return true;
  }
  const allowlist = config.tools.guard.allowlist ?? {};
  const allEntries = Object.values(allowlist).flatMap((group) =>
    Object.values(group ?? {})
  );
  return allEntries.some(
    (entry) => 'use' in entry && entry.use === 'classifier'
  );
}

export async function load(
  options: { logging: 'on' | 'off' } = { logging: 'on' }
): Promise<void> {
  if (!configUsesClassifier()) {
    return;
  }

  if (options.logging === 'on') {
    console.log('[Guard] Loading...');
  }
  const loadStart = performance.now();

  classifier = (await pipeline('text-classification', LOCAL_MODEL_PATH, {
    model_file_name: ONNX_MODEL_FILE,
    local_files_only: true,
    dtype: 'fp32',
  })) as unknown as Classifier;

  await classifier('warmup', {});

  const loadEnd = performance.now();

  if (options.logging === 'on') {
    console.log(`[Guard] Loaded in ${Math.round(loadEnd - loadStart)}ms`);
  }
}

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

  if (!classifier) {
    throw new Error('Classifier not loaded');
  }

  const start = performance.now();
  let classification: ClassificationResult;

  try {
    classification = await new Promise<ClassificationResult>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('TIMEOUT')),
          CLASSIFIER_TIMEOUT_MS
        );
        classifier!(text, {})
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      }
    );
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'TIMEOUT';

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

  const safe =
    classification[0].label === 'BENIGN' && classification[0].score > 0.85;

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
