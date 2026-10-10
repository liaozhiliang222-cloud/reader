import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { format } from 'prettier';

const run = JSON.parse(
  await readFile('artifacts/deployment-update-run.json', 'utf8'),
);
assert.ok(
  Date.parse(run.startedAt) > Date.now() - 20 * 60_000,
  'Stale live update run',
);
assert.equal(run.reports, resolve('.e2e-live-update', run.runId));
const raw = await readFile('artifacts/deployment-update-results.json');
const results = JSON.parse(raw);
assert.deepEqual(results.errors, []);
assert.equal(results.stats.expected, 2);
assert.equal(results.stats.unexpected, 0);
assert.equal(results.stats.flaky, 0);
assert.equal(results.stats.skipped, 0);
assert.ok(
  Date.parse(results.stats.startTime) >= Date.parse(run.startedAt) - 60_000,
);
const collect = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) => spec.tests),
    ...collect(suite.suites ?? []),
  ]);
const tests = collect(results.suites);
assert.deepEqual(tests.map((test) => test.projectName).sort(), [
  'Pixel-7',
  'iPhone-14',
]);
for (const test of tests) {
  assert.equal(test.status, 'expected');
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
}
const build = JSON.parse(
  await readFile('artifacts/deployment-build.json', 'utf8'),
);
assert.equal(build.preparedAt, run.preparedAt);
assert.equal(
  build.files.find((file) => '/' + file.path === run.newMain)?.sha256,
  run.newMainSha256,
);
const http = JSON.parse(
  await readFile('artifacts/deployment-http.json', 'utf8'),
);
assert.equal(http.preparedAt, run.preparedAt);
assert.equal(new URL(http.url).origin, run.origin);
assert.notEqual(run.oldMain, run.newMain);
const reports = [];
for (const engine of ['Pixel-7', 'iPhone-14']) {
  const report = JSON.parse(
    await readFile(join(run.reports, `${engine}-passed.json`), 'utf8'),
  );
  assert.ok(Date.parse(report.checkedAt) >= Date.parse(run.startedAt));
  assert.ok(
    Date.parse(report.checkedAt) <=
      Date.parse(results.stats.startTime) + results.stats.duration,
  );
  assert.equal(report.engine, engine);
  for (const field of [
    'origin',
    'oldMain',
    'newMain',
    'preparedAt',
    'newMainSha256',
  ])
    assert.equal(report[field], run[field]);
  for (const field of [
    'secureContext',
    'oldReaderDocumentPreserved',
    'explicitUpdate',
    'sevenNativeTablesEqual',
    'progressBookmarkAndNoteReopened',
  ])
    assert.equal(report[field], true);
  assert.equal(report.beforeSha256, report.afterSha256);
  assert.equal(report.newMainCacheSha256, run.newMainSha256);
  assert.equal(Object.keys(report.tableCounts).length, 7);
  assert.equal(report.originalBlobs.length, 1);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.external, []);
  assert.equal(report.physicalDeviceAcceptance, false);
  reports.push(report);
}
await writeFile(
  'artifacts/deployment-update-regression.json',
  await format(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      runId: run.runId,
      playwrightReportSha256: createHash('sha256').update(raw).digest('hex'),
      actualCloudflareDeployments: true,
      windowTimersAdvancedOnly: true,
      physicalDeviceAcceptance: false,
      stats: results.stats,
      reports,
    }),
    { parser: 'json' },
  ),
);
console.log(
  'Both native engines: old HTTPS readers remained open, explicit real-deployment updates preserved seven tables and original bytes; new cached main matches uploaded SHA.',
);
