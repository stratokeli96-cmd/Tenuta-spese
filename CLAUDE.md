# Tenuta Spese

PWA per la gestione delle spese personali. App single-file, nessun framework, nessun build step.

## Stack

- `index.html` — app: markup, CSS e JS inline (~5500 righe). Nessun bundler né build step.
- `logic.js` — logica pura (default stato, migrazione, `validaStato`/`importaStato`, calcoli, utility). Nessun DOM/localStorage: è testata da `tests/`. Caricata da `index.html` e usabile in Node (`module.exports`).
- `archivio.js` — archivio IndexedDB dei mesi chiusi (movimenti/scontrini); in localStorage restano solo i totali. Spec: `docs/superpowers/specs/2026-11-06-storico-mesi-design.md`.
- `xlsx.js` — lettore .xlsx minimale senza librerie (ZIP + XML, `DecompressionStream`); usato dall'import estratti conto. I `.xls` non sono supportati.
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
- Entrate extra (`stato.entrateExtra`): vanno nel totale del mese; la quota ripartita su una macro (`alloc`) aumenta il budget di quella macro tramite `saldoRiportato`, che la chiusura mese azzera (l'extra non si trascina). La parte non ripartita finisce nell'avanzo alla chiusura.
- Import estratto conto (Storico → "Importa estratto conto", CSV/XLSX): logica pura in `logic.js` (`parseCSV`, `rilevaColonne`, `estraiMovimentiBanca`, `trovaDoppione`, `indovinaVoce`). Uscite → movimenti `origine:'banca'` con `rif` anti-doppione; entrate → entrate extra. Le categorie scelte si ricordano in `stato.regoleBanca` (chiavi ripulite: mai `__proto__`). Fixture di prova in `tests/fixtures/` (dati finti).
- Scontrini con Gemini (opzionale, spento di default): chiave e modello stanno SOLO in `localStorage['tenuta-spese.ia']` (mai in `stato` → mai nei backup; chiave nell'header `x-goog-api-key`, mai nell'URL). Richiesta/validazione pure in `logic.js` (`costruisciRichiestaGemini`, `normalizzaRispostaGemini`). Se Gemini fallisce si ripiega sull'OCR locale. Ogni scontrino salvato crea un *caso di prova* in IndexedDB (`casi_scontrini`: testo OCR, righe OCR, righe Gemini, correzione finale, foto ridotta opzionale); `statisticheOcr` misura l'accuratezza dell'OCR locale. Il file esportato `casi_scontrini_*.json` contiene dati personali: non va committato (è in `.gitignore`); serve per migliorare `parseScontrino` con test di regressione.
- Le righe prodotto del mese vengono archiviate con il mese (`righeProdotto` nel dettaglio IndexedDB) e alimentano l'analisi "Dove spendo" (`aggregaProdotti`); i mesi chiusi prima della versione 2026.11.06e non le hanno.
- Aspetto e navigazione: tema scuro sobrio (grafite caldo, un solo accento verde salvia; il colore serve solo a dare significato: needs/wants/savings, avvisi). Token in `:root`; caratteri di sistema (nessun webfont); numeri con `tabular-nums`. Le tinte usate nei grafici stanno nell'oggetto `TEMA` / `MACRO_COLOR` in JS e vanno tenute allineate ai token CSS (e a `gen_icons.py`/`manifest.json`/`theme-color`). L'unica navigazione è la tab bar in basso (`.tabbar`, sempre visibile); "Altro" apre un pannello dal basso (`#altro-sheet`) con macro-aree, Cambio mese e Impostazioni. Le classi `.nav-item` + `data-view` sono solo l'aggancio del routing (non hanno stile proprio). Niente barra laterale, hamburger o app-bar. Il "+" (`#fab-add`) si nasconde scorrendo verso il basso.
- UI mobile (≤640px): le tabelle diventano schede; le finestre di dialogo salgono dal basso come fogli. Anche `table.voci-cards` (voci di una macro) usa classi `c-nome/c-bud/c-sp/c-res/c-perc/c-add`. `table.stack` richiede `data-label` su ogni `<td>`; `table.tx-cards` (storico) usa le classi `c-voce/c-imp/c-desc/c-data/c-macro/c-orig/c-act`. Campi a 16px e tap target ≥44px (evita lo zoom automatico di iOS, ora che lo zoom è consentito). Animazioni disattivate con `prefers-reduced-motion`.
- `saldoRiportato` contiene il riporto legacy (solo dalla migrazione del vecchio schema) più le quote extra ripartite; è azzerato a ogni chiusura mese.

## Documentazione utente

- `SETUP.md` — setup desktop e sincronizzazione export su Google Drive.
- `INSTALL_IPHONE.md` — installazione come PWA su iPhone.
