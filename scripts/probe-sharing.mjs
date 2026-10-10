import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
import { format } from 'prettier';

// Native-only reproduction: no application, database, parser, or intercepted requests.
const sw = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if(e.request.method !== 'POST') return;
  e.respondWith((async () => {
    const request = e.request;
    const raw = await request.clone().text();
    const describe = form => Array.from(form, ([key, value]) => ({key, kind: typeof value,
      ...(typeof value === 'string' ? {value} : {name: value.name, size: value.size, type: value.type})}));
    const direct = describe(await request.clone().formData());
    const streamed = describe(await new Response(request.body.pipeThrough(new TransformStream()), {headers: request.headers}).formData());
    return Response.json({raw, direct, streamed});
  })());
});`;
const server = createServer((req, res) => {
  if (req.url === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(sw);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><form action="/share" method="POST" enctype="multipart/form-data"><input type="file" name="files"><button>send</button></form>',
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const reports = [];
try {
  for (const [engine, type] of Object.entries({ chromium, webkit })) {
    const context = await type.launchPersistentContext('', { headless: true });
    try {
      for (const name of ['sample.txt', '分享.txt']) {
        const page = await context.newPage();
        await page.goto(origin);
        await page.evaluate(async () => {
          await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller)
            await new Promise((resolve) =>
              navigator.serviceWorker.addEventListener(
                'controllerchange',
                resolve,
                { once: true },
              ),
            );
        });
        await page.locator('input').setInputFiles({
          name,
          mimeType: 'text/plain',
          buffer: Buffer.from('original 中文'),
        });
        const response = page.waitForResponse(
          (r) => r.request().method() === 'POST',
        );
        await page.getByRole('button', { name: 'send' }).click();
        const result = await response;
        reports.push({
          engine,
          name,
          fromServiceWorker: result.fromServiceWorker(),
          ...(await result.json()),
        });
        await page.close();
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
const report = await format(
  JSON.stringify({ checkedAt: new Date().toISOString(), reports }),
  { parser: 'json' },
);
await writeFile('artifacts/sharing-native-probe.json', report);
console.log(report);
