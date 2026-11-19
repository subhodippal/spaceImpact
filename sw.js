// Mono Strike service worker: offline play after first load.
const CACHE = 'mono-strike-v19';
const LOCAL = [
  './', './index.html', './style.css', './game.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];
const REMOTE = [
  'https://unpkg.com/three@0.160.0/build/three.module.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL);
    await Promise.all(REMOTE.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Own files: network first (so updates appear on a normal reload), cache as offline fallback.
// Pinned CDN files never change: cache first.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (!sameOrigin) {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch {
      return (await c.match(req, { ignoreSearch: req.mode === 'navigate' }))
        || (req.mode === 'navigate' ? await c.match('./index.html') : Response.error());
    }
  })());
});
