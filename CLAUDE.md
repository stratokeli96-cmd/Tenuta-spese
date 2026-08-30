# Tenuta Spese

PWA per la gestione delle spese personali. App single-file, nessun framework, nessun build step.

## Stack

- `index.html` — l'intera app: markup, CSS e JS inline in un unico file (~5250 righe, ~190KB). Nessuna dipendenza esterna, nessun bundler.
- `sw.js` — service worker (funzionalità offline/PWA).
- `manifest.json` — manifest PWA (installabilità).
- `gen_icons.py` — genera le icone PNG in `icons/` senza dipendenze esterne (solo stdlib Python).
- `.github/workflows/deploy-pages.yml` — deploy automatico su GitHub Pages al push sui branch `Tenuta-spese-telefono` e `Tenuta-spesa-finale-V1`.

## Avvio/test

- Nessun build richiesto: apri `index.html` direttamente nel browser, oppure serviLo staticamente (es. `python3 -m http.server`).
- Rigenerare le icone: `python3 gen_icons.py`.
- Nessuna suite di test o linter configurati.

## Branch

- `Tenuta-spese-telefono` è il **branch di default** e quello da cui viene pubblicata l'app installata sul telefono: mergiare qui fa partire il deploy su Pages.
- `main` esiste ancora come branch secondario e **non** pubblica nulla.
- `Tenuta-spesa-finale-V1` è un secondo branch di deploy, oggi molto indietro rispetto al default.

## Convenzioni

- Tutto il codice applicativo vive in `index.html`: prima di leggerlo per intero, usa grep/ricerca mirata sulla sezione interessata — è un file grande e leggerlo tutto pesa sul contesto.
- I dati utente persistono nel `localStorage` del browser; l'export/import JSON (pattern `dati_DD-MM-YYYY_HH-MM.json`) è il meccanismo di backup — questi file contengono dati personali e non vanno mai committati (vedi `.gitignore`).
- Il deploy su Pages parte solo dai branch elencati sopra (o con `workflow_dispatch`): un push al solo `main` non pubblica niente.
- A ogni release vanno alzati **insieme** `APP_VERSION` in `index.html` e `CACHE_VERSION` in `sw.js`. Il service worker cancella le cache con nome diverso da quello corrente, quindi senza il bump di `CACHE_VERSION` i dispositivi già installati restano su una shell vecchia. I numeri vanno sempre in avanti, anche quando la modifica è un revert: uno che torna indietro non fa scattare l'aggiornamento in modo riconoscibile.

## Documentazione utente

- `SETUP.md` — setup desktop e sincronizzazione export su Google Drive.
- `INSTALL_IPHONE.md` — installazione come PWA su iPhone.
