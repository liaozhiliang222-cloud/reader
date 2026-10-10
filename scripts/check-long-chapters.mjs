import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { format } from 'prettier';

const manifest = JSON.parse(
  await readFile('artifacts/long-chapters-run.json', 'utf8'),
);
assert.match(manifest.runId, /^[a-f0-9-]{36}$/);
assert.equal(manifest.reports, resolve('.e2e-long', manifest.runId));
const reports = [];
for (const file of (await readdir(manifest.reports)).sort()) {
  assert.ok(file.endsWith('.json'));
  reports.push(
    JSON.parse(await readFile(join(manifest.reports, file), 'utf8')),
  );
}
assert.deepEqual(
  reports
    .map(({ engine, title }) => `${engine}/${title.split('：')[0]}`)
    .sort(),
  ['Pixel-7', 'iPhone-14']
    .flatMap((engine) =>
      ['LONG-SINGLE', 'LONG-MANY', 'LONG-EPUB'].map(
        (scenario) => `${engine}/${scenario}`,
      ),
    )
    .sort(),
);
for (const report of reports) {
  assert.equal(report.runId, manifest.runId);
  assert.ok(Date.parse(report.checkedAt) >= Date.parse(manifest.startedAt));
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.errors, []);
  assert.ok(report.workers.length > 0);
  for (const worker of report.workers)
    assert.equal(new URL(worker).origin, report.origin);
  assert.equal(report.automaticCspGuard, true);
  assert.equal(report.physicalDeviceAcceptance, false);
  assert.equal(report.details.linesInsidePage, true);
  assert.equal(report.details.persistedContentAndAnnotationsEqual, true);
  assert.equal(report.details.noteJumpVisibleAfterReloadAndResize, true);
  assert.ok(report.details.sourceChars >= 120000);
  assert.ok(report.details.peakRootsBeforeReload <= 4);
  assert.ok(report.details.peakRootsAfterReload <= 4);
  if (report.title.startsWith('LONG-EPUB')) {
    for (const field of [
      'rubyCompleteAtBoundary',
      'textOnlyAnnotationPaint',
      'bothImagesDecodedAndSeen',
      'crossParagraphUtf16SpanRetained',
      'originalZipAndRestoredShaEqual',
    ])
      assert.equal(report.details[field], true);
  }
}
await writeFile(
  'artifacts/long-chapters-regression.json',
  await format(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      runId: manifest.runId,
      nativeWorkersAndIndexedDb: true,
      realColumnGeometry: true,
      viewportResizeOnly: true,
      physicalDeviceAcceptance: false,
      deviceTimingFpsOrThirtyMinuteMemoryAcceptance: false,
      reports,
    }),
    { parser: 'json' },
  ),
);
console.log(
  'Both engines: real long-chapter block boundaries, original offsets, bounded reading DOM and retained notes/bookmarks after reflow/reload verified.',
);
