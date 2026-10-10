import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { UpdateBuild, UpdateManifest } from './globalSetup';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
export async function updateServer() {
  const manifest: UpdateManifest = JSON.parse(
    await readFile('.e2e-update/manifest.json', 'utf8'),
  );
  const headers = await readFile(
    join(manifest.a.directory, '_headers'),
    'utf8',
  );
  const csp = headers.match(/^ {2}Content-Security-Policy: (.+)$/m)![1]!;
  let current: UpdateBuild = manifest.a;
  const requests: { path: string; version: string; status: number }[] = [];
  let fail = '';
  const server = createServer(async (request, response) => {
    const deployed = current;
    try {
      const path = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      response.setHeader('Content-Security-Policy', csp);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      if (path === fail) {
        requests.push({ path, version: deployed.version, status: 503 });
        response.writeHead(503).end('Expected update-download failure');
        return;
      }
      const root = resolve(deployed.directory),
        target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!target.startsWith(root + sep)) {
        response.writeHead(400).end();
        return;
      }
      const bytes = await readFile(target);
      const extension =
        path === '/' ? '.html' : path.slice(path.lastIndexOf('.'));
      response.setHeader(
        'Content-Type',
        mime[extension] ?? 'application/octet-stream',
      );
      requests.push({ path, version: deployed.version, status: 200 });
      response.writeHead(200).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No isolated test server port');
  return {
    manifest,
    url: `http://127.0.0.1:${address.port}`,
    requests,
    deployB(broken = false) {
      current = manifest.b;
      fail = broken ? manifest.b.main : '';
    },
    close: () =>
      new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      ),
  };
}
