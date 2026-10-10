import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = new URL(process.argv[2]);
const reportPath = process.argv[3] ?? 'artifacts/deployment-http.json';
assert.ok(
  [
    'artifacts/deployment-http.json',
    'artifacts/deployment-unique-http.json',
  ].includes(reportPath),
  'Unexpected deployment report destination',
);
assert.equal(base.protocol, 'https:');
assert.match(base.hostname, /\.pages\.dev$/);
assert.equal(base.pathname, '/');
assert.ok(!base.username && !base.password && !base.search && !base.hash);
const build = JSON.parse(
  await readFile('artifacts/deployment-build.json', 'utf8'),
);
const headers = await readFile('public/_headers', 'utf8');
const expectedCsp = headers
  .match(/Content-Security-Policy: ([^\n]+)/)?.[1]
  ?.trim();
assert.ok(expectedCsp);
const resources = [];
const requestFailures = [];
async function download(file, attempt = 1) {
  try {
    const response = await fetch(new URL(file.path, base), {
      signal: AbortSignal.timeout(45_000),
      cache: 'no-store',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, bytes };
  } catch (error) {
    requestFailures.push({
      path: file.path,
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
    if (attempt >= 3)
      throw new Error(`${file.path}: HTTPS transfer failed`, { cause: error });
    console.warn(`${file.path}: transfer failed; retrying (${attempt}/2).`);
    return download(file, attempt + 1);
  }
}
for (const file of build.files.filter((file) => file.path !== '_headers')) {
  const local = await readFile(`dist/${file.path}`);
  assert.equal(
    createHash('sha256').update(local).digest('hex'),
    file.sha256,
    'Build changed after inventory',
  );
  const { response, bytes } = await download(file);
  assert.ok(response.ok, `${file.path}: HTTP ${response.status}`);
  assert.equal(new URL(response.url).origin, base.origin);
  assert.equal(bytes.length, file.size, `${file.path}: byte count`);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    file.sha256,
    `${file.path}: hash`,
  );
  assert.equal(
    response.headers.get('content-security-policy'),
    expectedCsp,
    `${file.path}: CSP`,
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (file.path.startsWith('assets/') || file.path.endsWith('.woff2')) {
    assert.match(cacheControl, /max-age=31536000/);
    assert.match(cacheControl, /immutable/);
    assert.doesNotMatch(cacheControl, /no-cache/);
  } else if (
    [
      'index.html',
      'sw.js',
      'manifest.webmanifest',
      'licenses.txt',
      'fonts/OFL.txt',
    ].includes(file.path)
  ) {
    assert.match(cacheControl, /no-cache/);
    assert.doesNotMatch(cacheControl, /immutable/);
  }
  if (file.path === 'sw.js') {
    assert.match(cacheControl, /\bno-store\b/);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  }
  resources.push({
    ...file,
    status: response.status,
    cacheControl,
    contentType: response.headers.get('content-type'),
    hashMatchesBuild: true,
    securityHeadersMatch: true,
  });
}
const report = {
  checkedAt: new Date().toISOString(),
  url: base.origin,
  version: build.version,
  preparedAt: build.preparedAt,
  resources,
  requestFailures,
  physicalDeviceAcceptance: false,
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(
  `HTTPS, bytes/SHA and security/cache headers verified for ${resources.length} deployed assets at ${base.origin}.`,
);
