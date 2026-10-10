import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import process from 'node:process';

const directory = resolve('dist');
async function scripts(dir) {
  const results = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) results.push(...(await scripts(path)));
    else if (/\.(js|css)$/.test(entry.name)) results.push(path);
  }
  return results;
}
const files = (await scripts(directory)).sort();
let total = 0;
for (const name of files) {
  const bytes = await readFile(name);
  const gzipBytes = gzipSync(bytes).length;
  total += gzipBytes;
  process.stdout.write(
    `${name.slice(directory.length + 1)}: raw ${(bytes.length / 1000).toFixed(2)} KB, gzip ${(gzipBytes / 1000).toFixed(2)} KB\n`,
  );
}
process.stdout.write(
  `All JS + CSS (including parser + Service Worker): gzip ${(total / 1000).toFixed(2)} KB\n`,
);
if (total >= 150_000) {
  // 用户于 2026-10-02 将 150 KB 调整为参考目标，允许小幅超出。
  process.stdout.write(
    'Size notice: above the 150 KB reference target; review growth, not a check failure.\n',
  );
}
