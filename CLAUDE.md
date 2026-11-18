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
- Scontrini con IA (opzionale, spenta di default). Catena **Gemini → OpenRouter → OCR locale**: un servizio alla volta, mai in parallelo; si passa al successivo se il precedente non è configurato, è in pausa, fallisce o non trova prodotti. Chiavi e modelli stanno SOLO in `localStorage['tenuta-spese.ia']` (campi `chiave/modello` per Gemini, `orChiave/orModello/orJson` per OpenRouter; mai in `stato` → mai nei backup; chiavi solo negli header `x-goog-api-key` / `Authorization: Bearer`, mai nell'URL). Logica pura in `logic.js` (`promptScontrino`, `costruisciRichiestaGemini`, `costruisciRichiestaOpenRouter`, `normalizzaRispostaIA`, `scegliModelloGemini`, `scegliModelloOpenRouter`, `controlloTotale`). La scansione non resta mai appesa: dopo la fine dell'OCR locale la catena ha `ATTESA_IA_DOPO_OCR_MS` (6 s), poi si prosegue con l'OCR e il servizio successivo non parte più (se l'OCR non c'è si aspetta la catena). Timeout per richiesta 25 s.
  - Gemini: un 429 di quota del modello ("limite 0" o giornaliero, le quote sono per modello) NON mette in pausa il servizio: il modello va negli esclusi (`localStorage['tenuta-spese.ia-esclusi']`, legati a `improntaChiave`, mai la chiave) fino alla mezzanotte di Los Angeles e si prova UNA volta un sostituto (`conSostitutoGemini`, anche per il 404). Se non resta nulla → pausa fino a mezzanotte LA (`tenuta-spese.ia-pausa`). Il 429 al minuto mette in pausa per il tempo indicato. Si preferiscono i flash stabili all'alias `gemini-flash-latest`.
  - OpenRouter: solo modelli `:free` con immagini, scelti da `GET /api/v1/models`; pausa propria (`tenuta-spese.ia-pausa-openrouter`) che non tocca Gemini. Il service worker non mette in cache né Gemini né openrouter.ai.
  - Totale: se la somma delle righe non torna col totale stampato, avviso rosso e conferma al salvataggio; se il totale non è stato letto, avviso giallo e conferma con la somma.
  - Ogni scontrino salvato crea un *caso di prova* in IndexedDB (`casi_scontrini`: testo OCR, righe OCR, righe IA con `iaFonte`/`iaModello`, correzione finale, foto ridotta opzionale; `geminiRighe` resta per compatibilità); `statisticheOcr` misura l'accuratezza dell'OCR locale. Il file esportato `casi_scontrini_*.json` contiene dati personali: non va committato (è in `.gitignore`); serve per migliorare `parseScontrino` con test di regressione.
- Le righe prodotto del mese vengono archiviate con il mese (`righeProdotto` nel dettaglio IndexedDB) e alimentano l'analisi "Dove spendo" (`aggregaProdotti`); i mesi chiusi prima della versione 2026.11.06e non le hanno.
- Aspetto e navigazione: tema scuro sobrio (grafite caldo, un solo accento verde salvia; il colore serve solo a dare significato: needs/wants/savings, avvisi). Token in `:root`; caratteri di sistema (nessun webfont); numeri con `tabular-nums`. Le tinte usate nei grafici stanno nell'oggetto `TEMA` / `MACRO_COLOR` in JS e vanno tenute allineate ai token CSS (e a `gen_icons.py`/`manifest.json`/`theme-color`). L'unica navigazione è la tab bar in basso (`.tabbar`, sempre visibile); "Altro" apre un pannello dal basso (`#altro-sheet`) con macro-aree, Cambio mese e Impostazioni. Le classi `.nav-item` + `data-view` sono solo l'aggancio del routing (non hanno stile proprio). Niente barra laterale, hamburger o app-bar. Il "+" (`#fab-add`) si nasconde scorrendo verso il basso.
- UI mobile (≤640px): le tabelle diventano schede; le finestre di dialogo salgono dal basso come fogli. Anche `table.voci-cards` (voci di una macro) usa classi `c-nome/c-bud/c-sp/c-res/c-perc/c-add`. `table.stack` richiede `data-label` su ogni `<td>`; `table.tx-cards` (storico) usa le classi `c-voce/c-imp/c-desc/c-data/c-macro/c-orig/c-act`. Campi a 16px e tap target ≥44px (evita lo zoom automatico di iOS, ora che lo zoom è consentito). Animazioni disattivate con `prefers-reduced-motion`.
- `saldoRiportato` contiene il riporto legacy (solo dalla migrazione del vecchio schema) più le quote extra ripartite; è azzerato a ogni chiusura mese.

## Documentazione utente

- `SETUP.md` — setup desktop e sincronizzazione export su Google Drive.
- `INSTALL_IPHONE.md` — installazione come PWA su iPhone.
