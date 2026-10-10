export interface PrecacheEntry {
  url: string;
  revision?: string | null;
}

export interface OfflineEnvironment {
  scope: string;
  caches: CacheStorage;
  fetch: typeof fetch;
  crypto: Crypto;
  windowCount: () => Promise<number>;
  claim: () => Promise<void>;
}

/** A separate immutable cache per build keeps open tabs' hashed chunks available. */
export function createOffline(
  entries: readonly PrecacheEntry[],
  environment: OfflineEnvironment,
) {
  const scope = new URL(environment.scope);
  const prefix =
    'jingye-precache-v1-' + encodeURIComponent(scope.pathname) + '-';
  const assets = new Map<string, PrecacheEntry>();
  for (const entry of entries) {
    const url = new URL(entry.url, scope);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
      throw new Error('离线清单只能包含应用同源资源。');
    url.hash = '';
    assets.set(url.href, entry);
  }
  const name = environment.crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)))
    .then(
      (digest) =>
        prefix +
        [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(''),
    );
  const index = new URL('index.html', scope).href;

  return {
    async install() {
      const cacheName = await name;
      const existed = await environment.caches.has(cacheName);
      const cache = await environment.caches.open(cacheName);
      try {
        await Promise.all(
          [...assets.keys()].map(async (url) => {
            if (await cache.match(url)) return;
            // Static hosts can redirect index.html to its directory. Request the
            // canonical directory directly, retaining index.html as the cache key.
            const download = url === index ? new URL('./', scope).href : url;
            const response = await environment.fetch(
              new Request(download, {
                cache: 'reload',
                credentials: 'same-origin',
              }),
            );
            if (
              !response.ok ||
              response.type === 'opaque' ||
              response.redirected
            )
              throw new Error('离线资源下载失败。');
            await cache.put(url, response);
          }),
        );
      } catch (error) {
        if (!existed) await environment.caches.delete(cacheName);
        throw error;
      }
    },
    async activate() {
      // Do not remove an old build while an existing tab may still load its Worker.
      if ((await environment.windowCount()) === 0) {
        const current = await name;
        await Promise.all(
          (await environment.caches.keys())
            .filter((key) => key.startsWith(prefix) && key !== current)
            .map((key) => environment.caches.delete(key)),
        );
      }
      await environment.claim();
    },
    handles(request: Request) {
      const url = new URL(request.url);
      return (
        request.method === 'GET' &&
        url.origin === scope.origin &&
        url.pathname.startsWith(scope.pathname) &&
        (request.mode === 'navigate' ||
          assets.has(url.href) ||
          url.pathname.startsWith(new URL('assets/', scope).pathname))
      );
    },
    async respond(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.mode === 'navigate') url.search = '';
      const key =
        request.mode === 'navigate' && !assets.has(url.href) ? index : url.href;
      const cache = await environment.caches.open(await name);
      const current = await cache.match(key);
      if (current) return current;
      // A tab running the previous build may request a lazily started parser Worker.
      if (request.mode !== 'navigate') {
        for (const cacheName of (await environment.caches.keys()).filter(
          (key) => key.startsWith(prefix),
        )) {
          const cached = await (
            await environment.caches.open(cacheName)
          ).match(key);
          if (cached) return cached;
        }
      }
      return environment.fetch(request);
    },
  };
}
