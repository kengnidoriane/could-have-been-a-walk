// Offline support for the walk page: connectivity drops (hello, Monrovia), the walk goes on.
// The route, the agenda and the turn-back logic need no network once the app is cached;
// map tiles already seen stay available too.

const APP = 'cbaw-app-v1';
const TILES = 'cbaw-tiles-v1';
const MAX_TILES = 400;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(APP)
      .then((cache) => cache.addAll(['./', './manifest.webmanifest', './favicon.svg'])),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map((k) => cache.delete(k)),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Map tiles: the ones you've looked at, kept for when the network goes (no prefetching:
  // the OpenStreetMap tile servers are run by volunteers).
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone()).then(trimTiles);
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // Everything else that isn't this app (routing, weather) or is the local API: network only.
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  // Pages: network first, so a new version shows up; the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void caches.open(APP).then((cache) => cache.put('./', response.clone()));
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Built assets have hashed names: cache first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok)
            void caches.open(APP).then((cache) => cache.put(request, response.clone()));
          return response;
        }),
    ),
  );
});
