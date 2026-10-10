import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const allowed =
  /^(?:index\.html|_headers|sw\.js|manifest\.webmanifest|licenses\.txt|assets\/[\w.-]+-[\w-]{8}\.(?:js|css)|icons\/(?:icon\.svg|(?:icon-192|icon-512|maskable-512|apple-touch-icon)\.png)|fonts\/(?:README\.md|OFL\.txt|wenkai-gb2312-v1\.522\.woff2))$/;
// Dynamic diagram chunks must be fingerprinted build outputs in the offline list.
const cachedAssets = new Set(
  (await readFile('dist/sw.js', 'utf8')).match(
    /\bassets\/[\w.-]+\.(?:js|css)\b/g,
  ),
);
assert.ok(cachedAssets.size > 0, 'Missing offline application assets');
const files = [];
async function inventory(directory = '') {
  for (const entry of await readdir(join('dist', directory), {
    withFileTypes: true,
  })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink(), `Symlink refused: ${path}`);
    if (entry.isDirectory()) {
      assert.ok(['assets', 'icons', 'fonts'].includes(path), path);
      await inventory(path);
    } else {
      assert.ok(
        entry.isFile() && allowed.test(path),
        `Unexpected asset: ${path}`,
      );
      if (path.startsWith('assets/'))
        assert.ok(cachedAssets.has(path), `Asset not in offline list: ${path}`);
      const bytes = await readFile(join('dist', path));
      assert.ok(bytes.length <= 25 * 1024 * 1024, `Pages asset limit: ${path}`);
      files.push({
        path,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
await inventory();
for (const required of [
  'index.html',
  '_headers',
  'sw.js',
  'manifest.webmanifest',
])
  assert.ok(
    files.some((file) => file.path === required),
    required,
  );
assert.deepEqual(
  await readFile('dist/_headers'),
  await readFile('public/_headers'),
);
files.sort((a, b) => a.path.localeCompare(b.path));
const report = {
  preparedAt: new Date().toISOString(),
  directory: 'dist',
  version: JSON.parse(await readFile('package.json', 'utf8')).version,
  files,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  staticOnly: true,
  sourceMapsOrUserBooksIncluded: false,
};
await writeFile(
  'artifacts/deployment-build.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  `Verified ${files.length} static assets, ${report.totalBytes} bytes. Only dist is ready to upload.`,
);
