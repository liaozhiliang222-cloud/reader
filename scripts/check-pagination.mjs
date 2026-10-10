import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Run alone through pnpm. Restore the exact original bytes in finally and never
// accept new screenshot baselines during this deliberately broken build.
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('请使用 pnpm check:pagination 执行。');
const path = new URL('../src/reader/paginator.ts', import.meta.url);
const original = await readFile(path);
const marker = 'Math.round(fontSize * lineHeight * 100) / 100';
const source = original.toString('utf8');
if (source.split(marker).length !== 2)
  throw new Error('行高计算已变化，请更新变异检查。');
await mkdir('artifacts', { recursive: true });
function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [pnpm, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status;
}
const reportPath = 'artifacts/pagination-mutation-report.json';
let mutationDetected;
async function restoreSource() {
  await writeFile(path, original);
  if (!(await readFile(path)).equals(original))
    throw new Error('源文件恢复校验失败。');
  if (run(['build']) !== 0) throw new Error('恢复后的构建失败。');
}
try {
  await writeFile(
    path,
    source.replace(
      marker,
      'Math.round(fontSize * lineHeight * 1.15 * 100) / 100',
    ),
  );
  if (run(['build']) !== 0) throw new Error('变异构建失败，不能算截图检出。');
  const code = run(
    [
      'exec',
      'playwright',
      'test',
      'pagination.spec.ts',
      '--update-snapshots=none',
      '--reporter=list,json',
    ],
    { PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
  );
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const tests = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) tests.push(...spec.tests);
    for (const child of suite.suites ?? []) visit(child);
  };
  report.suites.forEach(visit);
  mutationDetected =
    code === 1 &&
    tests.length === 2 &&
    tests.every((test) =>
      test.results.some(
        (result) =>
          result.status === 'failed' &&
          result.errors.some((error) => /toHaveScreenshot/.test(error.message)),
      ),
    );
  if (!mutationDetected)
    throw new Error('失败原因不是两个引擎都检测到截图差异，请查看报告。');
} finally {
  await restoreSource();
}
const restoredPassed =
  run([
    'exec',
    'playwright',
    'test',
    'pagination.spec.ts',
    '--update-snapshots=none',
  ]) === 0;
await writeFile(
  'artifacts/pagination-regression.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      platform: process.platform,
      mutation: 'lineHeight × 1.15',
      mutationDetected,
      restoredPassed,
      sourceSha256: createHash('sha256').update(original).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
if (!restoredPassed) throw new Error('恢复后截图回归未通过。');
