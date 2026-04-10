// ─── Cache version ────────────────────────────────────────────────────────────
// To push an update to users: bump this version string (e.g. v1.1, v1.2 …),
// then deploy.  The browser will install the new SW, delete the old cache,
// and serve fresh assets on the next page load.
const CACHE_NAME = 'flatspace-commander-v1.11';

// ─── Assets to pre-cache on install ───────────────────────────────────────────
const ASSETS = [
    '/',
    '/index.html?v=1775853369888',
    '/manifest.json',
    '/css/style.css?v=1775853369888',
    '/js/main.js?v=1775853369888',
    '/js/metrics.js?v=1775317593465',
    '/js/combat.js?v=1775853369888',
    '/js/procedural.js?v=1775853369888',
    '/js/vendor/howler.js?v=1775853369888',
    '/img/background.png',
    '/img/philip-newborough-yellow-512x512-rounded.png',
    '/audio/blue-danube.mp3',
    '/audio/button1.mp3',
    '/audio/button2.mp3',
    '/audio/button3.mp3',
    '/audio/collect.mp3',
    '/audio/explosion-alien.mp3',
    '/audio/explosion-asteroid.mp3',
    '/audio/explosion-pirates.mp3',
    '/audio/explosion-player.mp3',
    '/audio/laser-alien.mp3',
    '/audio/laser-beam.mp3',
    '/audio/laser-military.mp3',
    '/audio/laser-mining.mp3',
    '/audio/laser-pirates.mp3',
    '/audio/laser-pulse.mp3',
    '/audio/space-flying.mp3',
    '/audio/station-ambience.mp3',
    '/audio/station-exit.mp3',
    '/audio/warning-combat.mp3',
    '/apple-touch-icon.png',
    '/favicon.ico',
    '/icon-16x16.png',
    '/icon-32x32.png',
    '/icon-48x48.png',
    '/icon-64x64.png',
    '/icon-96x96.png',
    '/icon-128x128.png',
    '/icon-144x144.png',
    '/icon-152x152.png',
    '/icon-192x192.png',
    '/icon-256x256.png',
    '/icon-512x512.png',
    '/screenshot-mobile.png',
    '/screenshot-wide.png',
];

// ─── Install: pre-cache all assets ────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// ─── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// ─── Fetch: cache-first, fall back to network ─────────────────────────────────
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                if (response.ok) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            });
        })
    );
});
