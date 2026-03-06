/**
 * STELARIS PRO 2.0 — Service Worker
 * Caching strategy: Cache-first for static assets, network-first for dynamic.
 */
const CACHE_NAME = 'stelaris-pro-v3.0.0';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './stelaris_config.js',
    './manifest.json',
    './favicon.ico',
    './icon-192x192.png',
    './icon-512x512.png',
];

// Install — cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch — cache-first for known assets
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request).catch(() => {
                // Fallback for navigation requests
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
