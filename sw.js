// Service worker: maakt de app offline bruikbaar (alleen de app zelf; gegevens staan in IndexedDB).
const CACHE = 'boodschappenbrein-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Eigen bestanden: netwerk eerst (altijd de nieuwste versie), cache als terugval.
// Bibliotheken van CDN's: cache eerst (ze zijn versie-vast).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url.host);
  if (!sameOrigin && !cdn) return; // prijsdata e.d. niet cachen
  if (sameOrigin && url.pathname.endsWith('/version.json')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (cdn) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }
    try {
      // no-cache: altijd bij de server controleren of het bestand nieuwer is (anders houdt iOS het tot 10 min vast)
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
