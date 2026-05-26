// ============================================================
//  SERVICE WORKER — Smart Finance PWA
//
//  Strategie:
//   - App shell (HTML/CSS/JS locali + icone): precache, cache-first.
//   - Librerie CDN (Chart.js, treemap): runtime cache, stale-while-revalidate.
//   - Asset pesanti OCR (Tesseract core/wasm, traineddata, pdf.js worker):
//     runtime cache, cache-first dopo il primo download → OCR offline.
//   - API GitHub (sync): SEMPRE dalla rete (mai cache).
// ============================================================

const VERSION = 'sf-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/maskable-512.png'
];

// Host che NON devono mai essere serviti dalla cache (dati live / sync).
const NETWORK_ONLY_HOSTS = [
  'api.github.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((e) => console.warn('precache parziale:', e))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Dati live e auth: solo rete, mai cache.
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.endsWith(h))) {
    return; // lascia passare alla rete normalmente
  }

  // 2) Navigazioni (HTML): network-first con fallback alla shell (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // 3) Asset locali della shell: cache-first.
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetchAndCache(req, SHELL_CACHE))
    );
    return;
  }

  // 4) CDN (librerie, OCR core/wasm/lang, pdf.js, font): cache-first runtime.
  //    Dopo il primo download restano disponibili offline.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetchAndCache(req, RUNTIME_CACHE);
      return cached || network;
    })
  );
});

function fetchAndCache(req, cacheName) {
  return fetch(req).then((res) => {
    // Non cacheare risposte opache problematiche tranne quelle utili (font/cdn ok).
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(cacheName).then((cache) => cache.put(req, copy)).catch(() => {});
    }
    return res;
  });
}
