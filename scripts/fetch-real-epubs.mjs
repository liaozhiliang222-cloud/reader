import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'test-books/real-epubs';
await mkdir(root, { recursive: true });
const sources = JSON.parse(
  await readFile('scripts/real-epub-sources.json', 'utf8'),
);
const selected = new Set(process.argv.slice(2));
for (const id of selected)
  assert.ok(
    sources.some((source) => source.id === id),
    `Unknown source: ${id}`,
  );
const previous = await readFile(join(root, 'manifest.json'), 'utf8').then(
  JSON.parse,
  () => ({ failures: [] }),
);
const priorFailures = new Map(
  previous.failures.map((failure) => [failure.id, failure.error]),
);
const records = [];
const failures = [];
let failedRequests = 0;
for (const source of sources) {
  assert.match(source.id, /^[a-z0-9-]+$/);
  assert.ok(source.licenseBasis && source.page && source.download);
  const file = `${source.id}.epub`;
  const metadataFile = join(root, `${source.id}.json`);
  try {
    let bytes, metadata;
    try {
      metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
      bytes = await readFile(join(root, file));
      assert.equal(metadata.download, source.download);
      assert.equal(metadata.size, bytes.byteLength);
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        metadata.sha256,
      );
    } catch {
      if (selected.size && !selected.has(source.id)) {
        failures.push({
          id: source.id,
          error:
            priorFailures.get(source.id) ??
            'Not downloaded; not requested in this run.',
        });
        continue;
      }
      const response = await fetch(source.download, {
        signal: AbortSignal.timeout(60_000),
      });
      assert.ok(response.ok, `${source.id}: HTTP ${response.status}`);
      assert.ok(response.body, `${source.id}: missing response body`);
      const parts = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.byteLength;
        assert.ok(size <= 50 * 1024 * 1024, `${source.id}: exceeds 50 MiB`);
        parts.push(part);
      }
      bytes = Buffer.concat(parts);
      assert.equal(
        bytes.subarray(0, 4).toString('hex'),
        '504b0304',
        `${source.id}: not a ZIP/EPUB`,
      );
      metadata = {
        ...source,
        file,
        downloadedAt: new Date().toISOString(),
        resolvedDownload: response.url,
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      // Keep downloaded bytes unchanged, with attribution outside the archive too.
      await writeFile(join(root, file), bytes);
      await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    }
    metadata = { ...metadata, ...source, file };
    await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
    records.push(metadata);
    console.log(
      `${source.id}: ${bytes.byteLength} bytes, SHA-256 ${metadata.sha256}`,
    );
  } catch (error) {
    failures.push({ id: source.id, error: String(error) });
    failedRequests++;
    console.error(`${source.id}: ${error}`);
  }
}
await writeFile(
  join(root, 'manifest.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      requestedIds: [...selected],
      records,
      failures,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${records.length} real editions saved; ${failedRequests} failed requests this run; ${failures.length} editions unavailable in total. Files remain under ignored test-books/.`,
);
if (failedRequests) process.exitCode = 1;
