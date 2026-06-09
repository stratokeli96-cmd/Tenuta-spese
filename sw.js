/* Service worker — Tenuta Spese
 *
 * Obiettivo: avvio offline reale.
 *  - App shell (file locali) precaricata in installazione.
 *  - Asset CDN (Chart.js, Tesseract, pdf.js, Google Fonts, tessdata...) salvati
 *    in cache al primo caricamento online (runtime cache) e poi serviti offline.
 *
 * Nessun dato utente passa di qui: localStorage resta sul dispositivo.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = 'tenuta-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'tenuta-runtime-' + CACHE_VERSION;

/* File locali che compongono l'app shell. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Gestiamo solo le GET.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigazioni / app shell same-origin: network-first con fallback a cache.
  // Così gli aggiornamenti arrivano online, ma offline si serve la copia salvata.
  if (sameOrigin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) =>
            cached || caches.match('./index.html')
          )
        )
    );
    return;
  }

  // Asset cross-origin (CDN, font, tessdata): cache-first con runtime caching.
  // Al primo uso online vengono scaricati e salvati; dopo funzionano offline.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Salva anche le risposte opache (no-cors): non ispezionabili ma riservibili.
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});
