# Tenuta Spese

PWA per la gestione delle spese personali. App single-file, nessun framework, nessun build step.

## Stack

- `index.html` — l'intera app: markup, CSS e JS inline in un unico file (~4600 righe, ~164KB). Nessuna dipendenza esterna, nessun bundler.
- `sw.js` — service worker (funzionalità offline/PWA).
- `manifest.json` — manifest PWA (installabilità).
- `gen_icons.py` — genera le icone PNG in `icons/` senza dipendenze esterne (solo stdlib Python).
- `.github/workflows/deploy-pages.yml` — deploy automatico su GitHub Pages, ma **solo** al push sui branch `Tenuta-spese-telefono` e `Tenuta-spesa-finale-V1` (non su `main`).

## Avvio/test

- Nessun build richiesto: apri `index.html` direttamente nel browser, oppure serviLo staticamente (es. `python3 -m http.server`).
- Rigenerare le icone: `python3 gen_icons.py`.
- Nessuna suite di test o linter configurati.

## Convenzioni

- Tutto il codice applicativo vive in `index.html`: prima di leggerlo per intero, usa grep/ricerca mirata sulla sezione interessata — è un file grande e leggerlo tutto pesa sul contesto.
- I dati utente persistono nel `localStorage` del browser; l'export/import JSON (pattern `dati_DD-MM-YYYY_HH-MM.json`) è il meccanismo di backup — questi file contengono dati personali e non vanno mai committati (vedi `.gitignore`).
- Il deploy su Pages non si attiva sul push a `main`: per pubblicare bisogna pushare su uno dei branch elencati sopra o usare `workflow_dispatch`.

## Documentazione utente

- `SETUP.md` — setup desktop e sincronizzazione export su Google Drive.
- `INSTALL_IPHONE.md` — installazione come PWA su iPhone.
