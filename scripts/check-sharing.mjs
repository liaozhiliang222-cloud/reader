import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { format } from 'prettier';

const manifest = JSON.parse(
  await readFile('artifacts/sharing-run.json', 'utf8'),
);
assert.match(manifest.runId, /^[a-f0-9-]{36}$/);
assert.equal(manifest.reports, resolve('.e2e-sharing', manifest.runId));
const reports = [];
for (const file of (await readdir(manifest.reports)).sort()) {
  assert.ok(file.endsWith('.json'));
  reports.push(
    JSON.parse(await readFile(join(manifest.reports, file), 'utf8')),
  );
}
const expected = {
  'SHARE-FILE': {
    consumed: true,
    originalShaEqual: true,
    oldReadingAndBookmarkPreserved: true,
    bookCount: 2,
  },
  'SHARE-TEXT': {
    textAndUrlPreserved: true,
    reloadBeforeSave: true,
    consumedAfterSave: true,
    originalShaEqual: true,
    bookCount: 1,
  },
  'SHARE-MIXED': {
    retryOnlyFailedFile: true,
    badFileHashPreserved: true,
    savedTextKeepsFailedFile: true,
    unsavedEditorUnchanged: true,
    explicitDiscardOnly: true,
    bookCount: 2,
  },
};
assert.deepEqual(
  reports
    .map(({ engine, title }) => `${engine}/${title.split('：')[0]}`)
    .sort(),
  ['Pixel-7', 'iPhone-14']
    .flatMap((engine) =>
      Object.keys(expected).map((scenario) => `${engine}/${scenario}`),
    )
    .sort(),
);
for (const report of reports) {
  assert.equal(report.runId, manifest.runId);
  assert.equal(report.status, 'passed');
  assert.ok(Date.parse(report.checkedAt) >= Date.parse(manifest.startedAt));
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.errors, []);
  for (const worker of report.workers)
    assert.equal(new URL(worker).origin, report.origin);
  assert.equal(report.automaticCspGuard, true);
  assert.equal(report.physicalSystemShareAcceptance, false);
  assert.equal(report.posts.length, 1);
  for (const post of report.posts) {
    assert.equal(post.status, 303);
    assert.equal(post.fromServiceWorker, true);
    assert.equal(new URL(post.location).origin, report.origin);
    assert.equal(
      new URL(post.location).hash,
      `#/incoming/${report.details.incomingId}`,
    );
  }
  const scenario = report.title.split('：')[0];
  if (scenario !== 'SHARE-TEXT') {
    assert.ok(report.details.fileNames.length > 0);
    for (const name of report.details.fileNames)
      assert.equal(/^[\x20-\x7e]+$/.test(name), report.engine === 'iPhone-14');
  }
  assert.ok(report.workers.length > 0);
  for (const [key, value] of Object.entries(expected[scenario]))
    assert.equal(report.details[key], value);
}
await writeFile(
  'artifacts/sharing-regression.json',
  await format(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      runId: manifest.runId,
      realMultipartNavigationAndServiceWorker: true,
      nativeIndexedDbAndOriginalHashes: true,
      physicalSystemShareAcceptance: false,
      fileNameCoverage: {
        chromium: 'Chinese filenames',
        webkit:
          'ASCII filenames only; native Windows WebKit multipart UTF-8 filename failure reproduced separately',
      },
      reports,
    }),
    { parser: 'json' },
  ),
);
console.log(
  'Both engines: native multipart share navigation, local pending data, retry, text preservation and independent tabs verified.',
);
