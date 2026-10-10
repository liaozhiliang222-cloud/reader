import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { createOffline, type PrecacheEntry } from './offline';

function memoryCaches() {
  const contents = new Map<string, Map<string, Response>>();
  const cache = (rows: Map<string, Response>) =>
    ({
      match: async (input: string | Request) =>
        rows.get(typeof input === 'string' ? input : input.url)?.clone(),
      put: async (input: string | Request, response: Response) => {
        rows.set(
          typeof input === 'string' ? input : input.url,
          response.clone(),
        );
      },
    }) as unknown as Cache;
  const storage = {
    keys: async () => [...contents.keys()],
    has: async (key: string) => contents.has(key),
    delete: async (key: string) => contents.delete(key),
    open: async (key: string) => {
      if (!contents.has(key)) contents.set(key, new Map());
      return cache(contents.get(key)!);
    },
  } as unknown as CacheStorage;
  return { contents, storage };
}
let caches = memoryCaches();
const network = vi.fn<typeof fetch>();
const claim = vi.fn(async () => {});
const entries: PrecacheEntry[] = [
  { url: 'index.html', revision: 'v1' },
  { url: 'assets/main-1.js', revision: null },
  { url: 'assets/parser-1.js', revision: null },
  { url: 'manifest.webmanifest', revision: 'v1' },
];
function reader(
  list = entries,
  count = 1,
  scope = 'https://local.test/reader/',
) {
  return createOffline(list, {
    scope,
    caches: caches.storage,
    fetch: network,
    crypto: webcrypto as unknown as Crypto,
    windowCount: async () => count,
    claim,
  });
}
function navigation(url = 'https://local.test/reader/?theme=night') {
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
}
beforeEach(() => {
  caches = memoryCaches();
  network
    .mockReset()
    .mockImplementation(
      async (input) =>
        new Response(String(input instanceof Request ? input.url : input)),
    );
  claim.mockClear();
});
it('断网导航带查询参数仍命中应用壳，解析 Worker 从同一预缓存返回，不触发网络', async () => {
  const offline = reader();
  await offline.install();
  network.mockClear().mockRejectedValue(new Error('断网'));
  expect(await (await offline.respond(navigation())).text()).toBe(
    'https://local.test/reader/',
  );
  const worker = await offline.respond(
    new Request('https://local.test/reader/assets/parser-1.js'),
  );
  expect(await worker.text()).toContain('parser-1.js');
  expect(network).not.toHaveBeenCalled();
  expect(offline.handles(navigation())).toBe(true);
  expect(offline.handles(new Request('https://remote.test/image.png'))).toBe(
    false,
  );
  expect(offline.handles(new Request('https://local.test/other/'))).toBe(false);
  expect(
    offline.handles(
      new Request('https://local.test/reader/', { method: 'POST' }),
    ),
  ).toBe(false);
  expect(
    offline.handles(new Request('https://local.test/reader/user-data.json')),
  ).toBe(false);
});
it('静态托管的index.html重定向：直接下载作用域根页面并按原清单键缓存，其他重定向仍拒绝', async () => {
  network.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const response = new Response(url);
    if (url.endsWith('index.html'))
      Object.defineProperty(response, 'redirected', { value: true });
    return response;
  });
  const offline = reader();
  await offline.install();
  expect(
    network.mock.calls.some(
      ([input]) =>
        input instanceof Request && input.url === 'https://local.test/reader/',
    ),
  ).toBe(true);
  expect(
    network.mock.calls.some(
      ([input]) => input instanceof Request && input.url.endsWith('index.html'),
    ),
  ).toBe(false);
  network.mockClear().mockRejectedValue(new Error('断网'));
  expect(
    await (
      await offline.respond(navigation('https://local.test/reader/index.html'))
    ).text(),
  ).toBe('https://local.test/reader/');
  expect(network).not.toHaveBeenCalled();
  const previous = await caches.storage.keys();
  const redirected = new Response('unexpected redirect');
  Object.defineProperty(redirected, 'redirected', { value: true });
  network.mockResolvedValue(redirected);
  await expect(
    reader([...entries, { url: 'assets/redirected.js' }]).install(),
  ).rejects.toThrow('离线资源下载失败');
  expect(await caches.storage.keys()).toEqual(previous);
});
it('一项资源失败不留下可激活的残缺新缓存，不清除旧版本和其他存储', async () => {
  const old = reader();
  await old.install();
  await caches.storage.open('other-app');
  const previous = await caches.storage.keys();
  network.mockResolvedValue(new Response('出错', { status: 503 }));
  const next = reader([...entries, { url: 'assets/new.js' }]);
  await expect(next.install()).rejects.toThrow('离线资源下载失败');
  expect(await caches.storage.keys()).toEqual(previous);
  // Reusing an identical resource manifest does not redownload or destroy its cache.
  network.mockClear();
  await old.install();
  expect(network).not.toHaveBeenCalled();
});
it('导航到已缓存的许可文本返回原资源，不被应用壳兜底覆盖', async () => {
  const offline = reader([
    ...entries,
    { url: 'licenses.txt' },
    { url: 'fonts/OFL.txt' },
  ]);
  await offline.install();
  network.mockClear().mockRejectedValue(new Error('断网'));
  expect(
    await (
      await offline.respond(
        navigation('https://local.test/reader/licenses.txt?source=about'),
      )
    ).text(),
  ).toBe('https://local.test/reader/licenses.txt');
  expect(
    await (
      await offline.respond(
        navigation('https://local.test/reader/fonts/OFL.txt'),
      )
    ).text(),
  ).toBe('https://local.test/reader/fonts/OFL.txt');
  expect(network).not.toHaveBeenCalled();
});
it('更新保留打开中的旧标签资源，无标签激活时只清理自身作用域的过期缓存', async () => {
  await reader().install();
  const nextEntries = [
    { url: 'index.html', revision: 'v2' },
    { url: 'assets/main-2.js' },
  ];
  const next = reader(nextEntries);
  await next.install();
  await next.activate();
  network.mockRejectedValue(new Error('断网'));
  const worker = await next.respond(
    new Request('https://local.test/reader/assets/parser-1.js'),
  );
  expect(await worker.text()).toContain('parser-1.js');
  network.mockResolvedValue(new Response('other'));
  await reader(entries, 0, 'https://local.test/another/').install();
  await caches.storage.open('jingye-optional-fonts');
  await reader(nextEntries, 0).activate();
  expect((await caches.storage.keys()).length).toBe(3);
  expect(claim).toHaveBeenCalledTimes(2);
});
it('清单中的跨源或越出部署目录资源拒绝注册', () => {
  expect(() => reader([{ url: 'https://remote.test/font.woff2' }])).toThrow(
    '同源',
  );
  expect(() => reader([{ url: '../secret.json' }])).toThrow('同源');
});
