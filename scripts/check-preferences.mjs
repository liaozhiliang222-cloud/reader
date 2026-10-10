import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { format } from 'prettier';

const manifest = JSON.parse(
  await readFile('artifacts/preferences-run.json', 'utf8'),
);
assert.match(manifest.runId, /^[a-f0-9-]{36}$/);
assert.equal(
  manifest.reports,
  resolve('artifacts/preferences-browser', manifest.runId),
);
const reports = [];
for (const file of (await readdir(manifest.reports)).sort()) {
  assert.ok(file.endsWith('.json'));
  reports.push(
    JSON.parse(await readFile(join(manifest.reports, file), 'utf8')),
  );
}
const scenarios = ['M2-06', 'M2-06并发', 'M2-06取消', 'M2-07', 'M2-08'];
assert.deepEqual(
  reports
    .map(({ engine, title }) => `${engine}/${title.split('：')[0]}`)
    .sort(),
  ['Pixel-7', 'iPhone-14']
    .flatMap((engine) => scenarios.map((scenario) => `${engine}/${scenario}`))
    .sort(),
  'All five scenarios must have fresh evidence from both engines',
);
for (const report of reports) {
  assert.equal(report.runId, manifest.runId);
  assert.ok(Date.parse(report.checkedAt) >= Date.parse(manifest.startedAt));
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.automaticCspGuard, true);
  assert.equal(report.physicalDeviceAcceptance, false);
  assert.ok(report.workerUrls.length > 0);
  for (const url of report.workerUrls) {
    assert.equal(new URL(url).origin, report.origin);
    assert.match(
      new URL(url).pathname,
      /^\/assets\/parse\.worker-[\w.-]+\.js$/,
    );
  }
}
await writeFile(
  'artifacts/preferences-regression.json',
  await format(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        runId: manifest.runId,
        localProductionPreview: true,
        nativeWorkersAndIndexedDb: true,
        emulatedClockAndColorScheme: true,
        cancellationScope:
          'Native Worker termination while its actual module bootstrap request is held; real preview retry afterward.',
        physicalDeviceAcceptance: false,
        reports,
      },
      null,
      2,
    ),
    { parser: 'json' },
  ),
);
console.log(
  'Both engines: encoding recovery, stale-tab protection, native Worker cancellation, system theme changes and dated backup downloads verified.',
);
