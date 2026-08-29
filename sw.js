/* Service worker — Tenuta Spese
 *
 * Obiettivo: avvio offline reale.
 *  - App shell (file locali) precaricata in installazione.
 *  - Asset CDN (Chart.js, Tesseract, pdf.js, Google Fonts, tessdata...) salvati
 *    in cache al primo caricamento online (runtime cache) e poi serviti offline.
 *
 * Nessun dato utente passa di qui: localStorage resta sul dispositivo.
 */

// Da incrementare ad ogni release insieme a APP_VERSION in index.html:
// forza l'eliminazione della shell cache precedente (vedi 'activate' sotto).
const CACHE_VERSION = 'v7';
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
      // addAll() passerebbe per la cache HTTP: si precarica esplicitamente
      // con cache 'reload' per non installare subito una shell già vecchia.
      .then((cache) => Promise.all(SHELL_ASSETS.map((u) =>
        fetch(new Request(u, { cache: 'reload' })).then((res) => cache.put(u, res))
      )))
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

/**
 * fetch() che ignora la cache HTTP del browser, con fallback alla fetch
 * normale se l'opzione non è supportata o la richiesta non la accetta.
 */
function fetchSenzaCacheHttp(req) {
  try {
    return fetch(new Request(req, { cache: 'reload' }));
  } catch (_) {
    return fetch(req);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Gestiamo solo le GET.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigazioni / app shell same-origin: network-first con fallback a cache.
  // Così gli aggiornamenti arrivano online, ma offline si serve la copia salvata.
  //
  // IMPORTANTE: la fetch va forzata a saltare la cache HTTP del browser
  // (cache: 'reload'). Senza, GitHub Pages serve index.html con un max-age e
  // il ramo "network-first" riceve comunque la copia vecchia: l'app resta
  // ferma a una versione precedente anche con la rete attiva.
  if (sameOrigin) {
    event.respondWith(
      fetchSenzaCacheHttp(req)
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
