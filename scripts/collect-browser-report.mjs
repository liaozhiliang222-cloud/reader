import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { format } from 'prettier';

// Preserve the completed local suite before deployment tests replace its HTML.
const html = await readFile('playwright-report/index.html');
const encoded = html
  .toString('utf8')
  .match(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/)?.[1];
assert.ok(encoded, 'No embedded Playwright report');
const zip = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
const report = JSON.parse(await zip.file('report.json').async('string'));
assert.ok(report.startTime > Date.now() - 20 * 60_000, 'Stale report');
assert.deepEqual(report.projectNames.toSorted(), ['Pixel-7', 'iPhone-14']);
assert.deepEqual(report.errors, []);
assert.equal(report.stats.unexpected, 0);
assert.equal(report.stats.flaky, 0);
assert.equal(report.stats.ok, true);
const expectedFiles = (await readdir('e2e'))
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();
assert.deepEqual(
  report.files.map((file) => file.fileName).sort(),
  expectedFiles,
  'Report is not the complete local suite',
);
let skipped = 0;
for (const file of report.files) {
  assert.deepEqual(
    [...new Set(file.tests.map((test) => test.projectName))].sort(),
    file.fileName === 'gestures.spec.ts'
      ? ['Pixel-7']
      : ['Pixel-7', 'iPhone-14'],
  );
  for (const test of file.tests) {
    if (test.outcome === 'skipped') {
      assert.equal(file.fileName, 'storage-layout.spec.ts');
      assert.equal(test.projectName, 'iPhone-14');
      assert.equal(test.title, '离线重载与离线 Worker 导入');
      skipped++;
    } else {
      assert.equal(test.outcome, 'expected');
      assert.equal(test.ok, true);
      assert.equal(test.results.length, 1, 'Unexpected retry');
    }
  }
}
assert.ok(skipped <= 1);
assert.equal(report.stats.skipped, skipped);
assert.equal(report.stats.expected, report.stats.total - skipped);
const backup = report.files.find(
  (file) => file.fileName === 'backup-staging.spec.ts',
);
assert.equal(backup.stats.total, 4);
assert.equal(backup.stats.expected, 4);
for (const engine of report.projectNames) {
  const download = JSON.parse(
    await readFile(`artifacts/backup-export-browser/${engine}.json`, 'utf8'),
  );
  assert.equal(download.engine, engine);
  assert.ok(Date.parse(download.checkedAt) >= report.startTime);
  assert.ok(
    Date.parse(download.checkedAt) <= report.startTime + report.duration,
  );
  assert.equal(download.nativeDownload, true);
  assert.equal(download.originalsEqual, true);
  assert.equal(download.workerPreviewOnlyMetadata, true);
  assert.equal(download.preparedRepliesEachSingleBook, true);
  assert.equal(download.exportInputOnlyMetadata, true);
  assert.equal(download.sourceReadsAfterWorkerStart, true);
  assert.equal(download.files.length, 13);
}
const common = {
  checkedAt: new Date().toISOString(),
  htmlReportSha256: createHash('sha256').update(html).digest('hex'),
  startTime: report.startTime,
};
await writeFile(
  'artifacts/full-browser-regression.json',
  await format(
    JSON.stringify({
      ...common,
      duration: report.duration,
      stats: report.stats,
      files: report.files,
    }),
    { parser: 'json' },
  ),
);
await writeFile(
  'artifacts/backup-staging-regression.json',
  await format(
    JSON.stringify({
      ...common,
      physicalDeviceOrPeakRamAcceptance: false,
      ...backup,
    }),
    { parser: 'json' },
  ),
);
console.log(
  `Preserved actual full-suite results: ${report.stats.expected} passed, ${skipped} known skip; both backup downloads belong to this run.`,
);
