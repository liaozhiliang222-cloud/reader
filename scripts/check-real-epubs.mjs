import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { format } from 'prettier';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = JSON.parse(
  await readFile('artifacts/compatibility-run.json', 'utf8'),
);
assert.match(run.runId, /^[a-f0-9-]{36}$/);
assert.equal(run.reports, resolve('.e2e-compat', run.runId));
const sourceBytes = await readFile('scripts/real-epub-sources.json');
assert.equal(
  run.sourceSha256,
  hash(sourceBytes),
  'Sources changed after run setup',
);
assert.deepEqual(run.sources, JSON.parse(sourceBytes));
assert.equal(
  run.productionIndexSha256,
  hash(await readFile('dist/index.html')),
  'Production changed after run setup',
);
const rawBytes = await readFile('artifacts/compatibility-results.json');
const raw = JSON.parse(rawBytes);
assert.deepEqual(raw.errors, []);
assert.equal(raw.stats.unexpected, 0);
assert.equal(raw.stats.flaky, 0);
const startedAt = Date.parse(run.startedAt);
const endedAt = Date.parse(raw.stats.startTime) + raw.stats.duration;
assert.ok(startedAt >= Date.parse(raw.stats.startTime) && startedAt <= endedAt);
const specs = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []),
    ...specs(suite.suites ?? []),
  ]);
const cases = specs(raw.suites).flatMap((spec) =>
  spec.tests.map((test) => ({ title: spec.title, ...test })),
);
const engines = ['Pixel-7', 'iPhone-14'];
assert.deepEqual(
  cases.map((test) => `${test.projectName}/${test.title}`).sort(),
  engines
    .flatMap((engine) =>
      run.sources.map(
        (source) =>
          `${engine}/${source.title} [${source.id}]: 真实原文件导入、目录跳转、翻页与重载`,
      ),
    )
    .sort(),
  'Run must contain the complete current corpus in both engines',
);
assert.deepEqual(
  run.availability.map((entry) => entry.id).sort(),
  run.sources.map((source) => source.id).sort(),
);
const reports = [];
const downloads = [],
  unavailable = [];
for (const source of run.sources) {
  const available = run.availability.find((entry) => entry.id === source.id);
  assert.equal(
    available.file,
    resolve('test-books/real-epubs', `${source.id}.epub`),
  );
  assert.equal(available.available, existsSync(available.file));
  if (available.available) {
    const bytes = await readFile(available.file);
    assert.equal(hash(bytes), available.sha256);
    assert.equal(bytes.length, available.bytes);
    const metadata = JSON.parse(
      await readFile(available.file.replace(/\.epub$/, '.json'), 'utf8'),
    );
    assert.equal(metadata.sha256, available.sha256);
    assert.equal(metadata.size, available.bytes);
    assert.equal(metadata.download, source.download);
    assert.equal(source.inspectionStatus, 'original-source-reviewed');
    downloads.push({
      ...source,
      ...available,
      downloadedAt: metadata.downloadedAt,
      resolvedDownload: metadata.resolvedDownload,
    });
  } else {
    assert.equal(source.inspectionStatus, 'download-unavailable');
    unavailable.push({
      id: source.id,
      title: source.title,
      page: source.page,
      reason:
        'Official original unavailable; never counted or substituted with a synthetic book',
    });
  }
  for (const engine of engines) {
    const test = cases.find(
      (entry) =>
        entry.projectName === engine && entry.title.includes(`[${source.id}]`),
    );
    assert.equal(test.results.length, 1);
    const result = test.results[0];
    assert.ok(Date.parse(result.startTime) >= startedAt);
    assert.equal(result.retry, 0);
    assert.deepEqual(result.errors, []);
    assert.equal(result.status, available.available ? 'passed' : 'skipped');
    const reportFile = join(run.reports, `${engine}-${source.id}.json`);
    if (!available.available) {
      assert.equal(existsSync(reportFile), false);
      continue;
    }
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    const attachment = result.attachments.find(
      (entry) => entry.name === '真实EPUB验收',
    );
    assert.ok(attachment, 'A real passing test must attach its evidence');
    assert.deepEqual(
      report,
      JSON.parse(Buffer.from(attachment.body, 'base64').toString()),
    );
    assert.equal(report.runId, run.runId);
    assert.equal(report.startedAt, run.startedAt);
    assert.equal(report.sourceSha256, run.sourceSha256);
    assert.equal(report.id, source.id);
    assert.equal(report.engine, engine);
    assert.equal(report.title, source.title);
    assert.equal(report.publisher, source.publisher);
    assert.equal(report.sha256, available.sha256);
    assert.equal(report.bytes, available.bytes);
    const checkedAt = Date.parse(report.checkedAt);
    assert.ok(
      checkedAt >= Math.max(startedAt, Date.parse(result.startTime)) &&
        checkedAt <= endedAt,
    );
    for (const flag of [
      'realWorkerImport',
      'nativeIndexedDb',
      'automaticCspGuard',
      'bodyTextActuallyVisible',
      'rawFileHashPreserved',
      'imageBoundsChecked',
      'textBoundsChecked',
    ])
      assert.equal(report[flag], true);
    assert.equal(report.physicalDeviceAcceptance, false);
    assert.equal(report.bodyContains, source.bodyContains);
    assert.equal(report.tocOccurrence, source.tocOccurrence);
    assert.equal(report.tocSection, source.tocTitle);
    assert.equal(report.parserVersion, 3);
    assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.pageErrors, []);
    assert.ok(report.workers.length > 0);
    for (const worker of report.workers)
      assert.equal(new URL(worker).origin, 'http://127.0.0.1:4180');
    assert.deepEqual(report.additionalBodyProbes, source.additionalProbes);
    assert.deepEqual(
      report.bodyScreenshots.map((shot) => shot.kind),
      ['body', ...source.additionalProbes.map((probe) => probe.kind)],
    );
    if (source.id === 'idpf-kusamakura') {
      assert.equal(report.sourceVerticalWriting, true);
      assert.equal(report.uniformHorizontalLayout, true);
    }
    if (source.id === 'eloquent-javascript') assert.equal(report.svgAssets, 21);
    for (const shot of report.bodyScreenshots) {
      assert.equal(
        shot.path,
        join(run.reports, `${engine}-${source.id}-${shot.kind}.png`),
      );
      assert.equal(hash(await readFile(shot.path)), shot.sha256);
    }
    assert.equal(
      report.screenshot,
      join(run.reports, `${engine}-${source.id}.png`),
    );
    assert.ok(!relative(run.reports, report.screenshot).startsWith('..'));
    reports.push({
      ...report,
      reloadScreenshotSha256: hash(await readFile(report.screenshot)),
    });
  }
}
assert.equal(raw.stats.expected, downloads.length * engines.length);
assert.equal(raw.stats.skipped, unavailable.length * engines.length);
assert.deepEqual(
  (await readdir(run.reports)).filter((file) => file.endsWith('.json')).sort(),
  reports.map((report) => `${report.engine}-${report.id}.json`).sort(),
);
const visualPath = 'artifacts/compatibility-visual-review.json';
let visualReviews = [];
if (existsSync(visualPath)) {
  const review = JSON.parse(await readFile(visualPath, 'utf8'));
  if (review.runId === run.runId) {
    assert.equal(review.sourceSha256, run.sourceSha256);
    assert.ok(Date.parse(review.reviewedAt) >= startedAt);
    visualReviews = review.entries;
    const expectedShots = reports.flatMap((report) =>
      report.bodyScreenshots.map((shot) => ({
        engine: report.engine,
        id: report.id,
        kind: shot.kind,
        sha256: shot.sha256,
      })),
    );
    assert.deepEqual(
      visualReviews
        .map(({ engine, id, kind, sha256 }) => ({ engine, id, kind, sha256 }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      expectedShots.sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    );
    for (const entry of visualReviews)
      assert.equal(entry.status, 'reviewed-selected-page');
  }
}
const output = {
  checkedAt: new Date().toISOString(),
  runId: run.runId,
  sourceSha256: run.sourceSha256,
  productionIndexSha256: run.productionIndexSha256,
  rawResultsSha256: hash(rawBytes),
  rawResultsPath: resolve('.e2e-compat', `${run.runId}-results.json`),
  targetBooks: 20,
  realBooks: downloads.length,
  publisherCount: new Set(downloads.map((source) => source.publisher)).size,
  sampleCountTargetReached: downloads.length >= 20,
  completeCorpusPassedBothEngines: true,
  selectedPagesVisualReviewed: visualReviews.length > 0,
  entireBooksVisualReviewed: false,
  physicalDeviceAcceptance: false,
  browserPassed: raw.stats.expected,
  missingFileSkipped: raw.stats.skipped,
  downloads,
  unavailable,
  visualReviews,
  reports,
};
await writeFile(output.rawResultsPath, rawBytes);
await writeFile(
  resolve('.e2e-compat', `${run.runId}-run.json`),
  JSON.stringify(run, null, 2) + '\n',
);
await writeFile(
  'artifacts/compatibility-progress.json',
  await format(JSON.stringify(output), { parser: 'json' }),
);
console.log(
  `${downloads.length} original works, ${output.publisherCount} producers; ${raw.stats.expected} native browser passes, ${raw.stats.skipped} unavailable-file skips. Selected-page visual review: ${output.selectedPagesVisualReviewed}.`,
);
