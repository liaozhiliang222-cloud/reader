import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { format } from 'prettier';

assert.ok(process.argv.slice(2).every((argument) => argument === '--full'));
const run = JSON.parse(
  await readFile('artifacts/interactions-run.json', 'utf8'),
);
assert.equal(run.reports, resolve('.e2e-interactions', run.runId));
const startedAt = Date.parse(run.startedAt);
assert.ok(startedAt > Date.now() - 30 * 60_000, 'Stale interaction run');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(
  hash(await readFile('dist/index.html')),
  run.productionIndexSha256,
);
for (const source of run.sources)
  assert.equal(hash(await readFile(source.path)), source.sha256, source.path);
const input = process.argv.includes('--full')
  ? 'artifacts/full-browser-results.json'
  : 'artifacts/interactions-results.json';
const bytes = await readFile(input),
  raw = JSON.parse(bytes);
assert.deepEqual(raw.errors, []);
assert.equal(raw.stats.unexpected, 0);
assert.equal(raw.stats.flaky, 0);
const suiteStart = Date.parse(raw.stats.startTime),
  suiteEnd = suiteStart + raw.stats.duration;
assert.ok(suiteStart <= startedAt && startedAt < suiteEnd);
const cases = [];
function visit(suite) {
  for (const spec of suite.specs ?? []) {
    if (!spec.file.endsWith('interactions.spec.ts')) continue;
    for (const test of spec.tests) cases.push({ title: spec.title, ...test });
  }
  for (const child of suite.suites ?? []) visit(child);
}
raw.suites.forEach(visit);
const scenarios = [
  'M2-05-REGIONS',
  'M2-05-SELECTION',
  'M2-04-MOTION',
  'M2-04-OVERLAYS',
];
assert.deepEqual(
  cases
    .map((test) => `${test.projectName}/${test.title.split('：')[0]}`)
    .sort(),
  ['Pixel-7', 'iPhone-14']
    .flatMap((engine) => scenarios.map((scenario) => `${engine}/${scenario}`))
    .sort(),
);
const reports = [];
for (const test of cases) {
  assert.equal(test.status, 'expected');
  assert.equal(test.results.length, 1);
  const result = test.results[0];
  assert.equal(result.status, 'passed');
  assert.equal(result.retry, 0);
  assert.deepEqual(result.errors, []);
  const start = Date.parse(result.startTime),
    end = start + result.duration;
  assert.ok(start >= startedAt && end <= suiteEnd);
  const path = join(
    run.reports,
    `${test.projectName}-${test.title.split('：')[0]}.json`,
  );
  const report = JSON.parse(await readFile(path, 'utf8'));
  const attachment = result.attachments.find(
    (item) => item.name === 'interaction-evidence',
  );
  assert.ok(attachment?.path);
  assert.deepEqual(JSON.parse(await readFile(attachment.path, 'utf8')), report);
  assert.equal(report.runId, run.runId);
  assert.equal(report.engine, test.projectName);
  assert.equal(report.title, test.title);
  assert.ok(
    Date.parse(report.checkedAt) >= start &&
      Date.parse(report.checkedAt) <= end,
  );
  assert.equal(report.origin, 'http://127.0.0.1:4180');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.external, []);
  assert.equal(report.nativeTouchInput, true);
  assert.equal(report.nativeAnimationObserver, true);
  assert.equal(report.rawOriginalHashPreserved, true);
  assert.equal(report.automaticCspGuard, true);
  assert.equal(report.physicalDeviceAcceptance, false);
  assert.ok(
    report.workers.length > 0 &&
      report.workers.every((url) => new URL(url).origin === report.origin),
  );
  assert.ok(
    report.evidence.pointers.some((event) => event.pointerType === 'touch'),
  );
  assert.ok(report.evidence.pointers.every((event) => event.trusted));
  if (test.title.startsWith('M2-04-MOTION：')) {
    const motions = report.evidence.animations;
    assert.equal(motions.length, 4);
    assert.deepEqual(
      motions.map((motion) => motion.duration),
      [220, 160, 220, 220],
    );
    assert.ok(motions[0].frames.length > 0);
    assert.ok(
      motions[1].frames.some(
        (frame) => Number(frame.opacity) > 0 && Number(frame.opacity) < 1,
      ),
    );
    assert.ok(
      motions[2].cancelledAt !== undefined &&
        motions[2].finishedAt === undefined,
    );
  }
  reports.push(report);
}
assert.deepEqual(
  (await readdir(run.reports)).filter((file) => file.endsWith('.json')).sort(),
  cases
    .map((test) => `${test.projectName}-${test.title.split('：')[0]}.json`)
    .sort(),
);
const immutableRaw = resolve('.e2e-interactions', `${run.runId}-results.json`);
await writeFile(immutableRaw, bytes);
await writeFile(
  resolve('.e2e-interactions', `${run.runId}-run.json`),
  JSON.stringify(run, null, 2) + '\n',
);
await writeFile(
  'artifacts/interactions-regression.json',
  await format(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      runId: run.runId,
      productionIndexSha256: run.productionIndexSha256,
      sourceResults: input,
      rawResultsSha256: hash(bytes),
      rawResultsPath: immutableRaw,
      nativeTouchAndAnimationEvidence: true,
      physicalDeviceAcceptance: false,
      reports,
    }),
    { parser: 'json' },
  ),
);
console.log(
  'Both engines: trusted touch regions, selection/menu protection, native page/CSS motion and live reduced-motion cancellation verified.',
);
