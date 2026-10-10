import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
import { format } from 'prettier';

const server = createServer((_req, res) =>
  res.end('<!doctype html><title>Native staged Blob probe</title>'),
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const reports = [];
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const context = await type.launchPersistentContext('', { headless: true });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('staged-probe', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('data');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const transaction = (action) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction('data', 'readwrite');
            action(tx.objectStore('data'));
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
          });
        const get = (key) =>
          new Promise((resolve, reject) => {
            const r = db.transaction('data').objectStore('data').get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
        const results = [];
        try {
          for (const mode of ['nested-blob', 'bytes']) {
            const original = new Blob([new Uint8Array(4096).fill(73)], {
              type: 'application/octet-stream',
            });
            const value =
              mode === 'bytes' ? await original.arrayBuffer() : original;
            await transaction((store) =>
              store.put(
                { data: new Blob([]), prepared: { blobs: [value] } },
                'stage',
              ),
            );
            const staged = (await get('stage')).prepared.blobs[0];
            await transaction((store) =>
              store.put(
                {
                  data:
                    mode === 'bytes'
                      ? new Blob([staged], { type: original.type })
                      : staged,
                },
                'final',
              ),
            );
            await transaction((store) => store.delete('stage'));
            try {
              const final = (await get('final')).data;
              const bytes = new Uint8Array(await final.arrayBuffer());
              results.push({
                mode,
                length: bytes.length,
                allBytesMatch: bytes.every((byte) => byte === 73),
              });
            } catch (error) {
              results.push({ mode, error: String(error) });
            }
            await transaction((store) => store.clear());
          }
        } finally {
          db.close();
        }
        return results;
      });
      reports.push({ engine, result });
    } finally {
      await context.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
const report = await format(
  JSON.stringify({
    checkedAt: new Date().toISOString(),
    applicationCode: false,
    reports,
  }),
  { parser: 'json' },
);
await writeFile('artifacts/staged-blob-native-probe.json', report);
console.log(report);
