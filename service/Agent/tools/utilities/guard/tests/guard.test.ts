import type { AgentConfig } from '../../../../types';
import { isSafe } from '../guard';
import { tests } from './tests';
import pc from 'picocolors';

const mockGuardConfig: AgentConfig = {
  id: 'test',
  workspace: '',
  port: '3000',
  models: [],
  tools: {
    guard: {
      enabled: true,
      use: 'all',
      port: 7234,
      timeout: 15_000,
    },
  },
};

async function runTests(): Promise<{
  passed: number;
  failed: number;
  total: number;
  averageMs: number;
}> {
  const durationsMs: number[] = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const testCase = tests[i];
    console.log(`Running test ${i + 1}/${tests.length}: ${testCase.title}...`);

    const start = performance.now();
    const result = await isSafe(mockGuardConfig, testCase.prompt, {
      use: 'all',
      name: testCase.title,
    });
    const time = performance.now() - start;

    durationsMs.push(time);

    const expected =
      testCase.expectedClassification === 'BENIGN' ? true : false;

    if (result.safe === expected) {
      const speed =
        time > 500
          ? pc.yellow(`${Math.round(time)}ms`)
          : `${Math.round(time)}ms`;
      console.log(
        `\tpassed in ${speed}.\n\tmarked as ${result.safe ? 'safe' : `unsafe\n\treason: ${result.reason}`}\n\tevaluated by ${result.evaluatedBy}`
      );
      passed++;
    } else {
      failed++;
      console.error(
        pc.red(
          `"${testCase.title}": expected ${testCase.expectedClassification}, got ${result.safe} (Evaluated by ${result.evaluatedBy})`
        )
      );
    }
  }

  const total = tests.length;
  const averageMs =
    durationsMs.reduce((sum, d) => sum + d, 0) / durationsMs.length;
  return { passed, failed, total, averageMs };
}

runTests()
  .then((stats) => {
    if (stats.failed > 0) {
      console.error(`\n${stats.failed}/${stats.total} tests failed.`);
      process.exit(1);
    }
    console.log(`\nAll (${stats.passed}) tests passed.`);
    console.log(
      `\nAverage classifier speed: ${Math.round(stats.averageMs)} ms`
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nTest failed:', err.message);
    process.exit(1);
  });
