const CACHE_NAME = 'redia-play-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css?v=5',
  './js/app.js?v=5',
  './js/audio-engine.js?v=5',
  './js/format-engine.js?v=5',
  './js/blob-store.js?v=5',
  './js/music-engine.js?v=5',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first for the app's own files: always try to fetch the latest
// version first, and only fall back to the cached copy if there's no
// connection (that's what actually makes this "work offline" without also
// meaning "never see an update" — cache-first was the wrong choice here,
// since it would keep serving whatever was cached on the very first visit
// forever, no matter how many times the files change on the server after
// that). Anything not on this app's own origin (APIs, embeds, proxies)
// is never intercepted, same as before.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  // force a genuinely fresh network request — plain fetch(event.request) still
  // respects normal HTTP cache-control headers, which is exactly what let a
  // stale copy keep coming back even after "network-first" was already added.
  const freshRequest = new Request(event.request.url, { cache: 'no-store' });
  event.respondWith(
    fetch(freshRequest)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
