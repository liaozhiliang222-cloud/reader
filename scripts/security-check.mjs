import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const allowed = JSON.parse(
  await readFile('scripts/security-urls.json', 'utf8'),
);
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (/\.(js|css|html|webmanifest)$/.test(path)) result.push(path);
  }
  return result;
}
const inventory = [];
for (const file of await files('dist')) {
  const source = await readFile(file, 'utf8');
  const urls = [
    ...new Set(
      source.match(
        /https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:\/[a-zA-Z0-9/_#?=&%+.-]*)?/g,
      ) ?? [],
    ),
  ].map((url) => url.replace(/\.$/, ''));
  for (const url of urls) {
    assert.ok(allowed[url], `Unreviewed external URL in ${file}: ${url}`);
    inventory.push({
      file: file.replaceAll('\\', '/'),
      url,
      reason: allowed[url],
    });
  }
}
const html = await readFile('dist/index.html', 'utf8');
const meta = html.match(
  /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"[^>]*>/i,
);
assert.ok(meta, 'Production HTML must contain CSP fallback');
const fallbackPolicy = meta[1].replace(/&#(?:39|x27);/g, "'");
assert.ok(
  html.indexOf(meta[0]) < html.indexOf('<script'),
  'CSP must precede scripts',
);
assert.ok(
  html.indexOf(meta[0]) < html.indexOf('<link'),
  'CSP must precede resources',
);
assert.ok(
  !meta[1].includes('frame-ancestors'),
  'Header-only directives do not belong in meta',
);
assert.ok(
  !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html),
  'No inline script in production HTML',
);
const headers = await readFile('dist/_headers', 'utf8');
const csp = headers.match(/^ {2}Content-Security-Policy: (.+)$/m)?.[1];
assert.ok(csp?.includes("script-src 'self'"));
assert.ok(!/script-src[^;]*(unsafe-inline|unsafe-eval)/.test(csp));
assert.equal(
  csp
    .split('; ')
    .filter((item) => !item.startsWith('frame-ancestors '))
    .join('; '),
  fallbackPolicy,
);
assert.match(
  headers,
  /\/sw\.js\s+Cache-Control: no-store, no-cache, max-age=0, must-revalidate\s+Cloudflare-CDN-Cache-Control: no-store/,
);
assert.match(
  headers,
  /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/,
);
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/security-resources.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      csp,
      externalUrlInventory: inventory,
      unreviewedExternalUrls: [],
      note: 'Static string inventory. Normal-flow CSP/network E2E is separate evidence; this is not a full security audit.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Production CSP/meta/cache rules verified; ${inventory.length} inert URL occurrences reviewed, no unreviewed URLs.`,
);
