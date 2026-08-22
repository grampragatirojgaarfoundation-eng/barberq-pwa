const CACHE_NAME = 'barberq-v3-auto-update'; // Version updated to strictly force refresh
const ASSETS = ['/', '/index.html', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force activate new service worker instantly
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  self.clients.claim(); // Take control of all open PWA apps instantly
});

// STRICT NETWORK FIRST STRATEGY (Ensures immediate updates for users)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request)) // If offline, fallback to cache
  );
});