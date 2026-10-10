import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const run = JSON.parse(
  await readFile('artifacts/deployment-update-run.json', 'utf8'),
);
assert.equal(run.reports, resolve('.e2e-live-update', run.runId));
const build = JSON.parse(
  await readFile('artifacts/deployment-build.json', 'utf8'),
);
assert.equal(build.preparedAt, run.preparedAt);
for (const engine of ['Pixel-7', 'iPhone-14']) {
  const ready = JSON.parse(
    await readFile(join(run.reports, `${engine}-ready.json`), 'utf8'),
  );
  assert.equal(ready.origin, run.origin);
  assert.equal(ready.main, run.oldMain);
  assert.equal(ready.preparedAt, run.preparedAt);
  assert.ok(Date.parse(ready.checkedAt) >= Date.parse(run.startedAt));
  assert.ok(Date.parse(ready.checkedAt) > Date.now() - 10 * 60_000);
  assert.equal(ready.original.length, 1);
}
for (const path of [
  'artifacts/deployment-unique-http.json',
  'artifacts/deployment-http.json',
]) {
  const http = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(http.preparedAt, run.preparedAt);
  assert.ok(Date.parse(http.checkedAt) >= Date.parse(run.startedAt));
  if (path.endsWith('/deployment-http.json'))
    assert.equal(new URL(http.url).origin, run.origin);
  assert.equal(http.resources.length, build.files.length - 1);
  for (const expected of build.files.filter(
    (file) => file.path !== '_headers',
  )) {
    const actual = http.resources.find(
      (resource) => resource.path === expected.path,
    );
    assert.equal(actual?.size, expected.size);
    assert.equal(actual?.sha256, expected.sha256);
  }
}
await writeFile(
  join(run.reports, 'deployed.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      preparedAt: run.preparedAt,
      url: run.origin,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Both old clients and unique/stable HTTPS byte reports verified; released live update gate.',
);
