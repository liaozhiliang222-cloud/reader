/// <reference lib="webworker" />
import { createOffline, type PrecacheEntry } from './workers/offline';
import { isShareTarget, receiveShare } from './workers/shareTarget';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: PrecacheEntry[];
};

const offline = createOffline(self.__WB_MANIFEST, {
  scope: self.registration.scope,
  caches: self.caches,
  fetch: self.fetch.bind(self),
  crypto: self.crypto,
  windowCount: async () =>
    (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .length,
  claim: () => self.clients.claim(),
});
self.addEventListener('install', (event) => event.waitUntil(offline.install()));
self.addEventListener('activate', (event) =>
  event.waitUntil(offline.activate()),
);
self.addEventListener('fetch', (event) => {
  if (isShareTarget(event.request, self.registration.scope)) {
    event.respondWith(receiveShare(event.request, self.registration.scope));
    return;
  }
  if (offline.handles(event.request))
    event.respondWith(offline.respond(event.request));
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
