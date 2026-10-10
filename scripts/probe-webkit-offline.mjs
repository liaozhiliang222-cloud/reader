import { createServer } from 'node:http';
import { chromium, webkit } from '@playwright/test';

const server = createServer((request, response) => {
  if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`addEventListener('install', e => e.waitUntil(skipWaiting()));
      addEventListener('activate', e => e.waitUntil(clients.claim()));
      addEventListener('fetch', e => e.respondWith(new Response('<!doctype html><title>offline-probe</title><p>local response</p>', {headers: {'Content-Type':'text/html'}})));`);
  } else response.end('<!doctype html><title>online-probe</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  for (const [name, engine] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const context = await engine.launchPersistentContext('', {
      headless: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      console.log(name, 'online controlled:', await page.title());
      await context.setOffline(true);
      try {
        await page.reload({ timeout: 10000 });
        console.log(name, 'offline:', await page.title());
      } catch (error) {
        console.log(name, 'offline:', error.message);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  server.close();
}
