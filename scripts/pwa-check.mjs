import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { TextEncoder } from 'node:util';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
const {
  Request,
  Response,
  FormData,
  File,
  Blob,
  TransformStream,
  TypeError,
  RangeError,
} = globalThis;
const indexedDB = new IDBFactory();
await new Promise((resolve, reject) => {
  const open = indexedDB.open('jingye', 20);
  open.onupgradeneeded = () =>
    open.result.createObjectStore('blobs', { keyPath: 'id' });
  open.onsuccess = () => {
    open.result.close();
    resolve();
  };
  open.onerror = () => reject(open.error);
});

// Execute the production Service Worker in Node, not a browser.
const directory = resolve('dist'),
  origin = 'https://jingye.test';
const stored = new Map(),
  handlers = new Map();
let connected = true,
  requests = 0,
  skipped = 0,
  claimed = 0;
const key = (input) => (typeof input === 'string' ? input : input.url);
const caches = {
  keys: async () => [...stored.keys()],
  has: async (name) => stored.has(name),
  delete: async (name) => stored.delete(name),
  open: async (name) => {
    if (!stored.has(name)) stored.set(name, new Map());
    const rows = stored.get(name);
    return {
      match: async (request) => rows.get(key(request))?.clone(),
      put: async (request, response) => {
        rows.set(key(request), response.clone());
      },
    };
  },
};
const scope = {
  registration: { scope: origin + '/' },
  caches,
  crypto: webcrypto,
  clients: {
    matchAll: async () => [{ id: 'reading-tab' }],
    claim: async () => {
      claimed++;
    },
  },
  skipWaiting: async () => {
    skipped++;
  },
  addEventListener: (type, handler) => {
    handlers.set(type, handler);
  },
  fetch: async (request) => {
    assert(connected, 'Offline route accessed the network');
    const url = new URL(key(request));
    assert.equal(url.origin, origin);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = resolve(directory, '.' + decodeURIComponent(pathname));
    assert(!relative(directory, path).startsWith('..' + sep));
    requests++;
    return new Response(await readFile(path));
  },
};
runInNewContext(await readFile(resolve(directory, 'sw.js'), 'utf8'), {
  self: scope,
  Request,
  Response,
  URL,
  TextEncoder,
  Uint8Array,
  Map,
  Promise,
  FormData,
  File,
  Blob,
  TransformStream,
  TypeError,
  RangeError,
  crypto: webcrypto,
  indexedDB,
  IDBKeyRange,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
});
async function lifecycle(type, extra = {}) {
  let completion;
  handlers.get(type)({
    ...extra,
    waitUntil: (promise) => {
      completion = promise;
    },
  });
  await completion;
}
await lifecycle('install');
assert.equal(skipped, 0);
await lifecycle('activate');
assert.equal(claimed, 1);
connected = false;
const requestCount = requests;
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
const expected = (await files(directory)).filter(
  (path) =>
    /\.(js|css|html|png|svg|webmanifest|txt)$/.test(path) &&
    path !== resolve(directory, 'sw.js'),
);
async function response(request) {
  let result;
  handlers.get('fetch')({
    request,
    respondWith: (value) => {
      result = value;
    },
  });
  assert(result, 'Expected resource was not intercepted');
  return await result;
}
for (const path of expected) {
  const url = origin + '/' + relative(directory, path).split(sep).join('/');
  assert.deepEqual(
    Buffer.from(await (await response(new Request(url))).arrayBuffer()),
    await readFile(path),
  );
}
for (const file of ['licenses.txt', 'fonts/OFL.txt']) {
  const request = new Request(origin + '/' + file);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  assert.deepEqual(
    Buffer.from(await (await response(request)).arrayBuffer()),
    await readFile(resolve(directory, file)),
  );
}
const fontAsset = JSON.parse(await readFile('src/app/fontAsset.json', 'utf8'));
const fontBytes = await readFile(resolve(directory, fontAsset.file));
assert.equal(fontBytes.length, fontAsset.size);
assert.equal(
  Buffer.from(await webcrypto.subtle.digest('SHA-256', fontBytes)).toString(
    'hex',
  ),
  fontAsset.sha256,
);
let fontIntercepted = false;
handlers.get('fetch')({
  request: new Request(origin + '/' + fontAsset.file),
  respondWith: () => {
    fontIntercepted = true;
  },
});
assert.equal(
  fontIntercepted,
  false,
  'Optional font was included in automatic precache',
);
const navigation = new Request(origin + '/?theme=night');
Object.defineProperty(navigation, 'mode', { value: 'navigate' });
assert.deepEqual(
  Buffer.from(await (await response(navigation)).arrayBuffer()),
  await readFile(resolve(directory, 'index.html')),
);
let externalIntercepted = false;
handlers.get('fetch')({
  request: new Request('https://external.test/test.png'),
  respondWith: () => {
    externalIntercepted = true;
  },
});
assert.equal(externalIntercepted, false);
assert.equal(requests, requestCount);
await lifecycle('message', { data: { type: 'SKIP_WAITING' } });
assert.equal(skipped, 1);
const manifest = JSON.parse(
  await readFile(resolve(directory, 'manifest.webmanifest'), 'utf8'),
);
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.orientation, 'any');
assert.equal(manifest.share_target.method, 'POST');
assert.equal(manifest.share_target.enctype, 'multipart/form-data');
assert(manifest.share_target.params.files[0].accept.includes('.epub'));
assert(manifest.file_handlers[0].accept['text/plain'].includes('.txt'));
assert(manifest.file_handlers[0].accept['text/markdown'].includes('.md'));
assert(manifest.file_handlers[0].accept['text/markdown'].includes('.markdown'));
const form = new FormData();
const sharedBytes = Buffer.from('第一章 分享验收\n全部留在本机。');
form.append(
  'files',
  new File([sharedBytes], '自编.txt', { type: 'text/plain' }),
);
form.set('text', '本机分享的文字');
form.set('url', 'https://external.test/article');
const incoming = await response(
  new Request(new URL(manifest.share_target.action, origin + '/'), {
    method: 'POST',
    body: form,
  }),
);
assert.equal(incoming.status, 303);
const target = new URL(incoming.headers.get('Location'));
assert.equal(target.origin, origin);
const record = await new Promise((resolve, reject) => {
  const open = indexedDB.open('jingye');
  open.onsuccess = () => {
    const transaction = open.result.transaction('blobs', 'readonly');
    const request = transaction
      .objectStore('blobs')
      .get('incoming:%2F:' + target.hash.slice(11));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => open.result.close();
  };
  open.onerror = () => reject(open.error);
});
assert(record, 'Share redirect returned before persistence');
const sharedForm = await new Response(record.data, {
  headers: { 'Content-Type': record.type },
}).formData();
assert.deepEqual(
  Buffer.from(await sharedForm.get('files').arrayBuffer()),
  sharedBytes,
);
assert.equal(
  record.value.text,
  '本机分享的文字\n\nhttps://external.test/article',
);
assert.equal(requests, requestCount, 'Shared links/files were sent to network');
for (const icon of manifest.icons) {
  const png = await readFile(resolve(directory, icon.src));
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
}
assert(manifest.icons.some((icon) => icon.purpose === 'maskable'));
assert(
  expected.some((path) => /parse\.worker.*\.js$/.test(path)),
  'Parser Worker missing',
);
assert(
  (await readFile(resolve(directory, 'index.html'), 'utf8')).includes(
    'apple-touch-icon',
  ),
);
process.stdout.write(
  JSON.stringify(
    {
      productionServiceWorker: true,
      precachedFiles: expected.length,
      licenseNavigationsBytesMatch: true,
      optionalFontNotPrecached: true,
      optionalFontHashMatches: true,
      offlineBytesMatch: true,
      parserWorkerIncluded: true,
      externalURLsNotIntercepted: true,
      explicitUpdateOnly: true,
      iconsDimensionsMatch: true,
      sharePostPersistedLocally: true,
      sharedBytesMatch: true,
      browserOrDeviceTest: false,
    },
    null,
    2,
  ) + '\n',
);
