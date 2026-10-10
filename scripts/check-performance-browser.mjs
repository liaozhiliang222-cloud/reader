import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { format } from 'prettier';

const manifest = JSON.parse(
  await readFile('artifacts/performance-browser-run.json', 'utf8'),
);
assert.match(manifest.runId, /^[a-f0-9-]{36}$/);
assert.equal(manifest.reports, resolve('.e2e-performance', manifest.runId));
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
      ['PERF-THOUSAND', 'PERF-SHELF'].map(
        (scenario) => `${engine}/${scenario}`,
      ),
    )
    .sort(),
);
for (const report of reports) {
  assert.equal(report.runId, manifest.runId);
  assert.equal(report.status, 'passed');
  assert.equal(report.reducedMotion, false);
  assert.ok(Date.parse(report.checkedAt) >= Date.parse(manifest.startedAt));
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.errors, []);
  assert.ok(report.workers.length > 0);
  for (const worker of report.workers)
    assert.equal(new URL(worker).origin, report.origin);
  assert.equal(report.automaticCspGuard, true);
  assert.equal(report.physicalDeviceAcceptance, false);
  const samples = report.details.openMs ?? report.details.shelfMs;
  assert.equal(samples.length, 3);
  const limit = report.details.openMs ? 1500 : 500;
  assert.ok(samples.every((ms) => Number.isFinite(ms) && ms > 0 && ms < limit));
  if (report.details.openMs) {
    assert.equal(report.details.chapterCount, 1000);
    assert.ok(report.details.sourceBytes >= 10 * 1024 * 1024);
    assert.equal(report.details.rawShaEqual, true);
    assert.equal(report.details.lastChapterReopened, true);
    assert.ok(report.details.tocMs > 0 && report.details.tocMs < 300);
    assert.ok(report.details.tocRows <= 24);
    assert.ok(report.details.peakRoots <= 4);
  } else {
    assert.equal(report.details.bookCount, 100);
    assert.equal(report.details.nativeBlobHashesEqual, true);
    assert.equal(report.details.keyboardEndsAndReload, true);
    assert.ok(report.details.maximumShelfRows <= 14);
    assert.equal(report.details.scroll.length, 9);
    for (const sample of report.details.scroll)
      for (let i = sample.expectedStart; i < sample.expectedEnd; i++)
        assert.ok(sample.indices.includes(i));
  }
}
await writeFile(
  'artifacts/performance-browser.json',
  await format(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      runId: manifest.runId,
      scope:
        'Local Windows native engines, production preview, mobile viewport emulation, normal motion preference, no CPU/network throttling.',
      measurement:
        'Native capture-phase click to matching laid-out DOM plus two requestAnimationFrame callbacks; import time excluded.',
      scrollScope:
        'Nine scripted native scroll positions with visible row coverage; not physical touch or FPS.',
      physicalDeviceAcceptance: false,
      fpsOrThirtyMinuteMemoryAcceptance: false,
      reports,
    }),
    { parser: 'json' },
  ),
);
console.log(
  'Both engines: real 1000-chapter/10MB and 100-book imports, local native open/shelf/TOC timing, bounded DOM, scroll coverage and keyboard navigation verified.',
);
