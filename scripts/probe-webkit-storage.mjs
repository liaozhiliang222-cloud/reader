import { createServer } from 'node:http';
import { webkit } from '@playwright/test';

const server = createServer((_request, response) =>
  response.end('<!doctype html><title>Storage probe</title>'),
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
try {
  for (const persistent of [false, true]) {
    const browser = persistent ? undefined : await webkit.launch();
    const context = persistent
      ? await webkit.launchPersistentContext('', { headless: true })
      : await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`);
      console.log(
        persistent ? 'persistent' : 'ephemeral',
        await page.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('probe', 1);
            request.onupgradeneeded = () =>
              request.result.createObjectStore('data');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const results = {};
          for (const [kind, value] of [
            ['blob', new Blob(['test'])],
            ['bytes', new Uint8Array([1, 2, 3])],
          ]) {
            results[kind] = await new Promise((resolve) => {
              const tx = db.transaction('data', 'readwrite');
              tx.objectStore('data').put(value, kind);
              tx.oncomplete = () => resolve('ok');
              tx.onabort = () => resolve(String(tx.error));
            });
          }
          db.close();
          return results;
        }),
      );
    } finally {
      await context.close();
      await browser?.close();
    }
  }
} finally {
  server.close();
}
