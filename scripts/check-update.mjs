import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pnpm = process.env.npm_execpath;
assert.ok(pnpm, 'Run with pnpm check:update');
assert.ok(process.argv.slice(2).every((argument) => argument === '--collect'));
if (!process.argv.includes('--collect')) {
  const result = spawnSync(
    process.execPath,
    [pnpm, 'exec', 'playwright', 'test', 'e2e/update.spec.ts'],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const manifest = JSON.parse(
  await readFile('.e2e-update/manifest.json', 'utf8'),
);
const reports = [];
for (const file of (await readdir(manifest.reports)).sort())
  reports.push(
    JSON.parse(await readFile(join(manifest.reports, file), 'utf8')),
  );
assert.equal(
  reports.length,
  6,
  'All three scenarios must have evidence from both engines',
);
assert.deepEqual(
  reports.map(({ engine, scenario }) => `${engine}/${scenario}`).sort(),
  ['Pixel-7', 'iPhone-14']
    .flatMap((engine) =>
      [
        'automatic-wait-click',
        'disabled-failure-retry',
        'other-tab-activation',
      ].map((scenario) => `${engine}/${scenario}`),
    )
    .sort(),
);
for (const report of reports) {
  assert.equal(report.beforeSha256, report.afterSha256);
  assert.equal(report.nativeIdbTablesEqual, true);
  assert.equal(Object.keys(report.tableCounts).length, 7);
  assert.notEqual(report.builds.a, report.builds.b);
  assert.notEqual(report.mainChunks.a, report.mainChunks.b);
}
await writeFile(
  'artifacts/update-regression.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      realProductionBuilds: true,
      localDeploymentOnly: true,
      physicalDeviceAcceptance: false,
      reports,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Both engines: real SW update, unchanged seven IDB tables/Blob hashes, disabled checking, failed-download retry and uninterrupted reading in another tab verified.',
);
