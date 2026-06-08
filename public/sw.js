/* ════════════════════════════════════════════════
   Service Worker — Nossa Linha do Tempo
   Estratégia:
   - Shell do app (HTML, fontes, scripts CDN) → cache-first
   - Fotos Supabase → stale-while-revalidate
   - APIs REST → network-first (nunca cacheadas)
════════════════════════════════════════════════ */
const CACHE_NAME = 'nossa-linha-v8';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './assets/audio/die-with-a-smile-official-music-video.mp3',
];

/* ── Install: cacheia o shell ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL.map(function(u) {
        return new Request(u, { cache: 'reload' });
      }));
    }).then(function() {
      return self.skipWaiting();
    }).catch(function(){})
  );
});

/* ── Activate: limpa caches antigos ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k)   { return caches.delete(k);  })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* ── Fetch: estratégia por tipo ── */
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // APIs REST do Supabase → sempre network (nunca cache)
  if (url.includes('/rest/v1/') || url.includes('/auth/v1/')) return;

  // Fotos do Storage Supabase → stale-while-revalidate
  if (url.includes('/storage/v1/object/')) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // Fontes Google → cache-first longo
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // CDN scripts (GSAP, Supabase) → cache-first
  if (url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Same-origin (shell) → cache-first, atualiza em background
  if (e.request.url.startsWith(self.location.origin)) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }
});

function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request).then(function(response) {
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(request, clone); });
      }
      return response;
    }).catch(function() { return caches.match('./index.html'); });
  });
}

function staleWhileRevalidate(request) {
  var fetchPromise = fetch(request).then(function(response) {
    if (response.ok) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(c) { c.put(request, clone); });
    }
    return response;
  }).catch(function(){});

  return caches.match(request).then(function(cached) {
    return cached || fetchPromise;
  });
}
