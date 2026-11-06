# Tenuta Spese

PWA per la gestione delle spese personali. App single-file, nessun framework, nessun build step.

## Stack

- `index.html` — app: markup, CSS e JS inline (~5500 righe). Nessun bundler né build step.
- `logic.js` — logica pura (default stato, migrazione, `validaStato`/`importaStato`, calcoli, utility). Nessun DOM/localStorage: è testata da `tests/`. Caricata da `index.html` e usabile in Node (`module.exports`).
- `archivio.js` — archivio IndexedDB dei mesi chiusi (movimenti/scontrini); in localStorage restano solo i totali. Spec: `docs/superpowers/specs/2026-11-06-storico-mesi-design.md`.
- `sw.js` — service worker. `CACHE_VERSION` deve essere identica a `APP_VERSION` di `index.html` (lo verifica un test): vanno bumpate insieme a ogni release.
- `manifest.json` — manifest PWA.
- `gen_icons.py` — genera le icone PNG in `icons/` (solo stdlib Python).
- `tests/logic.test.js` — test `node --test` (nessuna dipendenza): logica, versioni sincronizzate, SRI, escape HTML.
- `.github/workflows/deploy-pages.yml` — test + deploy su GitHub Pages al push su `Tenuta-spese-telefono` (branch principale/di default, usato dal telefono) e `Tenuta-spesa-finale-V1` (o `workflow_dispatch`). `test.yml` esegue i test su PR e altri branch.

## Dipendenze esterne (CDN, con SRI)

Chart.js, chartjs-chart-treemap, Tesseract.js e pdf.js arrivano da jsDelivr con `integrity=` sha384; i font da Google Fonts. L'app funziona offline solo dopo il primo avvio online (il service worker mette in cache gli asset). Se si cambia versione di una libreria va rigenerato l'hash:
`openssl dgst -sha384 -binary <file> | openssl base64 -A` sul file esatto del pacchetto npm (jsDelivr serve i file npm invariati; per `.min.js` generati al volo non c'è un hash stabile, usare il file non minificato).

## Avvio/test

- Nessun build: apri `index.html` nel browser oppure `python3 -m http.server`.
- Test: `node --test` (o `npm test`).
- Rigenerare le icone: `python3 gen_icons.py`.

## Convenzioni

- Prima di leggere `index.html` per intero usa grep/ricerca mirata: è un file grande.
- Ogni valore che arriva da dati utente/JSON importato va passato da `escapeHtml()` prima di finire in `innerHTML` (anche id e attributi): un test lo controlla.
- Importi sempre arrotondati con `round2`; le date locali con `oggi()` (mai `toISOString()`).
- Nuove regole di calcolo/validazione vanno in `logic.js` con un test, non inline.
- I dati utente stanno nel `localStorage`; export/import JSON (`dati_DD-MM-YYYY_HH-MM.json`) è il backup. Questi file contengono dati personali e non vanno mai committati (vedi `.gitignore`). L'import passa da `importaStato()` e conserva una copia in `smartFinance_v1_prima_import`; dati illegibili vengono copiati in `smartFinance_v1_corrotto_<timestamp>`.
- Mese corrente = localStorage (sincrono). Mesi chiusi = IndexedDB (`Archivio`), mai due copie in conflitto: prima si scrive in IndexedDB, poi si alleggerisce localStorage. Il file di export ricompone tutto (stesso schema dei vecchi backup).
- `saldoRiportato` è un riporto legacy (arriva solo dalla migrazione del vecchio schema) ed è azzerato alla prima chiusura mese.

## Documentazione utente

- `SETUP.md` — setup desktop e sincronizzazione export su Google Drive.
- `INSTALL_IPHONE.md` — installazione come PWA su iPhone.
