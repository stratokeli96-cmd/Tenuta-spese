# Scontrini con Groq — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la catena Gemini → OpenRouter → OCR con un solo servizio gratuito, Groq (una richiesta per scontrino, modello scelto da solo), con l'OCR locale solo come ripiego.

**Architecture:** Logica pura nuova in `logic.js` (richiesta, scelta modello, classificazione errori, configurazione, pausa) testata con `node --test`; in `index.html` un piccolo client Groq (fetch con timeout), un riquadro Impostazioni unico e un flusso di scansione sequenziale "Groq, poi OCR se serve". Tutto il codice Gemini/OpenRouter viene cancellato.

**Tech Stack:** JS vanilla, nessun build; `node --test`; API Groq compatibile OpenAI (`https://api.groq.com/openai/v1`).

**Spec:** `docs/superpowers/specs/2026-11-24-scontrini-groq-design.md`

## Global Constraints

- Chiave solo in `localStorage['tenuta-spese.groq']`, pausa in `localStorage['tenuta-spese.groq-pausa']`; mai in `stato`, backup, URL, messaggi d'errore, log.
- Chiave solo nell'header `Authorization: Bearer <chiave>`.
- Una sola richiesta di lettura per scontrino; al massimo un nuovo tentativo, e solo dopo "modello ritirato" (404 / `model_decommissioned` / `model_not_found`). Nessuna richiesta automatica all'avvio o in background.
- Timeout: 30 s per la lettura dello scontrino, 20 s per `/models` e per la richiesta di prova.
- 429: pausa per `retry-after`, altrimenti per `x-ratelimit-reset-requests`/`x-ratelimit-reset-tokens`, altrimenti 60 s.
- Niente numeri di quota scritti nel codice.
- Ogni valore da rete/utente in `innerHTML` passa da `escapeHtml()` (preferire `textContent`).
- `APP_VERSION` (index.html) e `CACHE_VERSION` (sw.js) = `'2026.11.24a'`, insieme.
- Link per le chiavi: `https://console.groq.com/keys`.
- Il service worker non tocca mai le richieste a `api.groq.com`.
- Nessun riferimento a Gemini/OpenRouter resta in `index.html`, `logic.js`, `sw.js` (i vecchi casi di prova con `geminiRighe`/`iaFonte:'gemini'` restano leggibili: non si migrano).

## Review Focus

1. Chiave incollata dal telefono con spazi o a capo → va ripulita, altrimenti 401 "chiave non valida" ingiusto (test in Task 1, `aggiornaConfigGroq`).
2. `localStorage` rovinato (JSON non valido, tipi sbagliati) per config o pausa → valori di default, mai eccezioni che bloccano Impostazioni o scansione (test in Task 1).
3. 429 senza `retry-after` ma con `x-ratelimit-reset-requests: "2m59.56s"` o senza alcun header → pausa corretta / 60 s (test in Task 1).
4. `/models` senza nessun modello che legge immagini, o con modelli `active:false` → `null` e stato "nessun modello", mai una richiesta a un modello di solo testo (test in Task 1).
5. PDF dello scanner iOS con più pagine → tutte le pagine nella stessa richiesta; se Groq rifiuta (400) si usa l'OCR con l'avviso, senza nuovo tentativo (verifica manuale in Task 4, perché dipende dalla rete).

---

### Task 1: Logica pura Groq in `logic.js`

**Files:**
- Modify: `logic.js` (nuova sezione "Groq" dopo `controlloTotale`; export in `module.exports`)
- Test: `tests/logic.test.js` (nuovi test in fondo)

**Interfaces:**
- Consumes: `promptScontrino(categorie)`, `_str`, `round2` (già in `logic.js`).
- Produces:
  - `costruisciRichiestaGroq(immagini: {mime, base64}[], categorie: string[], modello: string) -> object` — corpo per `POST /openai/v1/chat/completions`: `{ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role:'user', content: [{type:'text', text: promptScontrino(categorie)}, ...{type:'image_url', image_url:{url:'data:<mime>;base64,<b64>'}}] }] }`.
  - `testoRispostaGroq(j) -> string` — `j.choices[0].message.content` come stringa (unisce le parti `{text}` se è un array); `''` se manca.
  - `scegliModelloGroq(elenco: object[], escludi: string[] = []) -> string|null` — vedi Step 3.
  - `durataGroqMs(s: string) -> number|null` — `"2m59.56s"`→179560, `"7.66s"`→7660, `"1h2m3s"`→3723000, `"250ms"`→250, `"30"`→30000 (numero puro = secondi); non valido → `null`.
  - `classificaErroreGroq(status: number, corpo: any, headers: object, adessoMs: number) -> { tipo: 'chiave'|'modello'|'limite'|'temporaneo'|'richiesta', pausaFino: number|null, messaggio: string }`. `headers` è un oggetto con chiavi minuscole.
  - `leggiConfigGroq(raw: string|null) -> { attivo: boolean, chiave: string, modello: string, chiaveNonValida: boolean, salvaFoto: boolean }`.
  - `aggiornaConfigGroq(prima: Config, campi: { attivo, chiave, salvaFoto }) -> Config`.
  - `leggiPausaGroq(raw: string|null, adessoMs: number) -> { fino: number, motivo: string } | null`.
  - `configDaVecchiaIA(rawVecchio: string|null) -> Config` — porta solo `salvaFoto` dalla vecchia `tenuta-spese.ia`; tutto il resto ai default.

- [ ] **Step 1: Scrivi i test che falliscono**

```js
const conf = o => JSON.stringify(o);
test('costruisciRichiestaGroq: modello, json, prompt e immagini come data URL', () => {
  const c = L.costruisciRichiestaGroq([{ mime: 'image/jpeg', base64: 'QUJD' }, { mime: 'image/png', base64: 'REVG' }], ['Frutta', 'Altro'], 'm1');
  assert.equal(c.model, 'm1'); assert.equal(c.temperature, 0);
  assert.deepEqual(c.response_format, { type: 'json_object' });
  const p = c.messages[0].content;
  assert.equal(p[0].type, 'text'); assert.match(p[0].text, /Frutta, Altro/);
  assert.deepEqual(p.slice(1).map(x => x.image_url.url), ['data:image/jpeg;base64,QUJD', 'data:image/png;base64,REVG']);
});
test('testoRispostaGroq: stringa, array di parti, vuoto', () => {
  assert.equal(L.testoRispostaGroq({ choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
  assert.equal(L.testoRispostaGroq({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(L.testoRispostaGroq({}), ''); assert.equal(L.testoRispostaGroq(null), '');
});
test('scegliModelloGroq: solo modelli che leggono immagini e attivi, preferenze, esclusioni, null', () => {
  const el = [
    { id: 'llama-3.3-70b-versatile', active: true },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', active: true },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', active: true },
    { id: 'qualcosa-vision-preview', active: false },
    { id: 'whisper-large-v3', active: true }
  ];
  assert.equal(L.scegliModelloGroq(el), 'meta-llama/llama-4-scout-17b-16e-instruct');
  assert.equal(L.scegliModelloGroq(el, ['meta-llama/llama-4-scout-17b-16e-instruct']), 'meta-llama/llama-4-maverick-17b-128e-instruct');
  assert.equal(L.scegliModelloGroq([{ id: 'nuovo-x', input_modalities: ['text', 'image'] }]), 'nuovo-x');   // campo esplicito vince sul nome
  assert.equal(L.scegliModelloGroq([{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }]), null);
  assert.equal(L.scegliModelloGroq(null), null);
});
test('durataGroqMs: formati di Groq e valori non validi', () => {
  assert.equal(L.durataGroqMs('2m59.56s'), 179560); assert.equal(L.durataGroqMs('7.66s'), 7660);
  assert.equal(L.durataGroqMs('1h2m3s'), 3723000); assert.equal(L.durataGroqMs('250ms'), 250);
  assert.equal(L.durataGroqMs('30'), 30000); assert.equal(L.durataGroqMs(''), null); assert.equal(L.durataGroqMs('boh'), null);
});
test('classificaErroreGroq: chiave, modello, limite con e senza header, temporaneo, mai la chiave', () => {
  const t0 = 1_000_000;
  const k = L.classificaErroreGroq(401, { error: { message: 'Invalid API Key gsk_SEGRETA' } }, {}, t0);
  assert.equal(k.tipo, 'chiave'); assert.equal(k.pausaFino, null); assert.doesNotMatch(k.messaggio, /gsk_/);
  assert.equal(L.classificaErroreGroq(403, {}, {}, t0).tipo, 'chiave');
  assert.equal(L.classificaErroreGroq(404, { error: { code: 'model_not_found' } }, {}, t0).tipo, 'modello');
  assert.equal(L.classificaErroreGroq(400, { error: { code: 'model_decommissioned' } }, {}, t0).tipo, 'modello');
  assert.equal(L.classificaErroreGroq(429, {}, { 'retry-after': '12' }, t0).pausaFino, t0 + 12000);
  assert.equal(L.classificaErroreGroq(429, {}, { 'x-ratelimit-reset-requests': '2m59.56s' }, t0).pausaFino, t0 + 179560);
  const l = L.classificaErroreGroq(429, {}, {}, t0);
  assert.equal(l.tipo, 'limite'); assert.equal(l.pausaFino, t0 + 60000);
  assert.equal(L.classificaErroreGroq(503, {}, {}, t0).tipo, 'temporaneo');
  assert.equal(L.classificaErroreGroq(400, { error: { message: 'too many images' } }, {}, t0).tipo, 'richiesta');
});
test('leggiConfigGroq / aggiornaConfigGroq / configDaVecchiaIA: default, pulizia chiave, reset su chiave nuova', () => {
  const vuota = { attivo: false, chiave: '', modello: '', chiaveNonValida: false, salvaFoto: false };
  assert.deepEqual(L.leggiConfigGroq(null), vuota);
  assert.deepEqual(L.leggiConfigGroq('{rotto'), vuota);
  assert.deepEqual(L.leggiConfigGroq('[1]'), vuota);
  const prima = { attivo: true, chiave: 'gsk_A', modello: 'm1', chiaveNonValida: true, salvaFoto: false };
  const nuova = L.aggiornaConfigGroq(prima, { attivo: true, chiave: '  gsk_B\n', salvaFoto: true });
  assert.deepEqual(nuova, { attivo: true, chiave: 'gsk_B', modello: '', chiaveNonValida: false, salvaFoto: true });
  assert.deepEqual(L.aggiornaConfigGroq(prima, { attivo: false, chiave: 'gsk_A', salvaFoto: false }), { ...prima, attivo: false });
  assert.deepEqual(L.configDaVecchiaIA(conf({ attivo: true, chiave: 'AIza', salvaFoto: true, orChiave: 'sk-or' })), { ...vuota, salvaFoto: true });
  assert.deepEqual(L.configDaVecchiaIA('{rotto'), vuota);
});
test('leggiPausaGroq: valida, scaduta, rovinata', () => {
  assert.deepEqual(L.leggiPausaGroq(conf({ fino: 2000, motivo: 'limite' }), 1000), { fino: 2000, motivo: 'limite' });
  assert.equal(L.leggiPausaGroq(conf({ fino: 500, motivo: 'x' }), 1000), null);
  assert.equal(L.leggiPausaGroq('{rotto', 1000), null);
  assert.equal(L.leggiPausaGroq(null, 1000), null);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test`
Expected: FAIL dei 7 test nuovi con `L.costruisciRichiestaGroq is not a function` (e simili); gli altri passano.

- [ ] **Step 3: Implementa le funzioni in `logic.js` ed esportale**

Regole che i test non fissano del tutto:
- `scegliModelloGroq`: scarta `null`/non oggetti e `active === false` e gli `escludi`. Un modello "legge immagini" se ha un campo esplicito (`input_modalities`, `modalities`, `architecture.input_modalities` contenente `'image'`) **oppure** se l'id corrisponde a `/llama-4-scout|llama-4-maverick|vision|(^|[-/])vl([-/.]|$)|qwen.*vl/i`. Ordine: prima quelli con campo esplicito, poi l'ordine di preferenza `[/llama-4-scout/, /llama-4-maverick/]`, poi gli altri in ordine alfabetico.
- `classificaErroreGroq`: `code` / `message` letti da `corpo.error`; `401|403` → `'chiave'` con messaggio `'Chiave Groq non valida o revocata: creane una nuova su console.groq.com/keys'`; `404` o `code` in `model_not_found|model_decommissioned` → `'modello'`; `429` → `'limite'` con `pausaFino` (ordine: `retry-after`, `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens`, 60 000 ms); `>=500` → `'temporaneo'`; altro → `'richiesta'` con messaggio `'Groq ha rifiutato la richiesta (' + status + ')'` più al massimo 120 caratteri del `message`, ripuliti con `.replace(/gsk_[A-Za-z0-9]+/g, '…')`.
- `aggiornaConfigGroq`: chiave `trim()` + tolti spazi interni (`/\s+/g`); se la chiave cambia → `modello: ''` e `chiaveNonValida: false`; altrimenti si conservano.
- Aggiorna il commento di `promptScontrino` ("Istruzioni per leggere uno scontrino").

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `node --test`
Expected: tutti PASS.

- [ ] **Step 5: Commit**

```bash
git add logic.js tests/logic.test.js
git commit -m "Groq: richiesta, scelta modello, errori, configurazione e pausa (logica pura)"
```

---

### Task 2: Client Groq e Impostazioni in `index.html` (via i riquadri Gemini/OpenRouter)

**Files:**
- Modify: `index.html` — markup `#widget-ia` (righe ~1835–1890); blocco IA ~3543–3855 (da `IA_KEY` fino a prima di `/* Lettura in corso`); impostazioni ~5947–6097 (`renderIA`, `btn-ia-salva`, `btn-ia-test`, `btn-ia-modelli`, `btn-or-*`).
- Modify: `sw.js:90-93` (eccezione host) e il commento.
- Test: `tests/logic.test.js` — aggiorna il test `sw.js: le richieste a Gemini…`.

**Interfaces:**
- Consumes: tutto il Task 1.
- Produces (in `index.html`, usati dal Task 3):
  - `GROQ_KEY = 'tenuta-spese.groq'`, `GROQ_PAUSA_KEY = 'tenuta-spese.groq-pausa'`, `GROQ_URL = 'https://api.groq.com/openai/v1'`.
  - `configGroq() -> Config` (con migrazione: se `GROQ_KEY` manca, `configDaVecchiaIA(localStorage['tenuta-spese.ia'])`, salva, e rimuove `tenuta-spese.ia`, `tenuta-spese.ia-pausa`, `tenuta-spese.ia-pausa-openrouter`, `tenuta-spese.ia-esclusi`); `salvaConfigGroq(c) -> boolean`.
  - `pausaGroq() -> {fino, motivo}|null`, `mettiInPausaGroq(fino, motivo)`, `togliPausaGroq()`.
  - `groqPronto() -> boolean` = `attivo && chiave.length > 10 && !chiaveNonValida`.
  - `richiestaGroq(percorso: string, chiave: string, corpo: object|null, timeoutMs: number) -> Promise<object>` — GET se `corpo` è null, altrimenti POST JSON; header `Authorization: 'Bearer ' + chiave`. Rifiuta con `Error` che porta `err.groq = classificaErroreGroq(...)` per risposte HTTP non ok (con `headers` ricavati da `res.headers` in minuscolo), `err.timeout = true` su abort (`'Groq non ha risposto entro N secondi'`), `err.rete = true` su `TypeError` (`'rete non raggiungibile'`), `err.groq = {tipo:'richiesta'}` se il corpo non è JSON. Effetti collaterali: `tipo 'limite'` → `mettiInPausaGroq`; `tipo 'chiave'` → salva `chiaveNonValida: true`.
  - `modelloGroq(chiave: string, escludi: string[] = []) -> Promise<string|null>` — `GET /models`, `scegliModelloGroq(j.data, escludi)`, salva il risultato in config.

- [ ] **Step 1: Aggiorna il test del service worker (deve fallire)**

Nel test `sw.js: …` (rinominalo `sw.js: le richieste a Groq non passano mai dalla cache del service worker`) sostituisci l'URL Gemini con:

```js
assert.equal(servitaDalSw('https://api.groq.com/openai/v1/models'), false);
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `node --test`
Expected: FAIL sul test `sw.js: le richieste a Groq…`.

- [ ] **Step 3: `sw.js` — l'eccezione diventa `if (url.hostname === 'api.groq.com') return;`** (commento: "API Groq: sempre dalla rete").

- [ ] **Step 4: Sostituisci il markup di `#widget-ia`**

Titolo "Lettura scontrini con Groq". Testo: la foto viene inviata a Groq per leggerla; la chiave resta solo su questo dispositivo e non finisce nei backup; link `<a href="https://console.groq.com/keys" target="_blank" rel="noopener">crea una chiave gratuita</a>`. Un solo `.ia-blocco` con: badge `#groq-badge`, checkbox `#groq-attivo` "Usa Groq per leggere gli scontrini", `<input type="password" id="groq-chiave" autocomplete="off">`, bottoni `#btn-groq-prova` "Prova" e `#btn-groq-salva` "Salva", riga `#groq-modello` ("Modello in uso: … (scelto automaticamente)"), `#groq-stato`. Resta `#ia-foto` e tutta la parte "Casi di prova" (cambia solo la frase: "la lettura di Groq" al posto di "(Gemini o OpenRouter)").

- [ ] **Step 5: Sostituisci il blocco JS IA (da `IA_KEY` fino a prima di `/* Lettura in corso`)**

Cancella `IA_KEY`, `IA_MODELLO_DEFAULT`, `configIA`, `salvaConfigIA`, `geminiPronto`, pausa/esclusi Gemini, `chiamaGemini`, `richiestaGemini`, `elencaModelliGemini`, `conSostitutoGemini`, `senzaModelliGemini`, `analizzaConGemini`, tutto il blocco OpenRouter. Tieni `oraBreve` e `ridimensionaJpeg`. Aggiungi le funzioni dell'Interfaces sopra.

- [ ] **Step 6: Sostituisci le Impostazioni (`renderIA` e i listener)**

- `renderIA()`: riempie i campi da `configGroq()`. Badge (testo, mai HTML): `non attivo` / `manca la chiave` / `chiave non valida` / `in pausa fino alle HH:MM` / `nessun modello` (attivo, chiave ok, `modello === ''` dopo una Prova fallita per mancanza di modelli: usa un campo di sessione, non salvato) / `pronto`. La parte casi di prova resta com'è.
- `#btn-groq-salva`: `salvaConfigGroq(aggiornaConfigGroq(configGroq(), campi))`; se la chiave è cambiata `togliPausaGroq()`. Nessuna richiesta di rete. Toast + `renderIA()`.
- `#btn-groq-prova` (con la chiave nel campo, anche non salvata; se diversa da quella salvata ignora la pausa): stato "Cerco il modello…" → `modelloGroq` (20 s). Se `null`: rosso "Nessun modello Groq che legge immagini è disponibile per questa chiave." Altrimenti una `POST /chat/completions` `{ model, max_tokens: 8, messages: [{ role: 'user', content: 'Rispondi solo: ok' }] }` (20 s). Successo: verde "Funziona: modello «X», risposta in N,N s." e, se la chiave del campo è quella salvata, `chiaveNonValida: false` salvato. Errore: rosso con `e.message` (per `tipo 'chiave'` il messaggio contiene già il link testuale). Il tempo misurato serve anche come diagnosi (Review Focus / verifica finale).

- [ ] **Step 7: Esegui i test**

Run: `node --test`
Expected: tutti PASS (incluso "script inline sintatticamente validi" e il controllo `escapeHtml`).

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js tests/logic.test.js
git commit -m "Groq: client, Impostazioni con un solo riquadro, via Gemini e OpenRouter dalle impostazioni"
```

---

### Task 3: Scansione sequenziale Groq → OCR e casi di prova

**Files:**
- Modify: `index.html` — da `/* Lettura in corso` (~3857) a fine di `gestisciFileOCR`; `salvaCasoScontrino` (~5163); markup `#ocr-confronto` (~1555).
- Test: `tests/logic.test.js` (test statici sul sorgente)

**Interfaces:**
- Consumes: Task 1 (`costruisciRichiestaGroq`, `testoRispostaGroq`, `normalizzaRispostaIA`), Task 2 (`configGroq`, `groqPronto`, `pausaGroq`, `richiestaGroq`, `modelloGroq`, `ridimensionaJpeg`).
- Produces: `analizzaConGroq(pagine: string[]) -> Promise<{ lettura, foto: string|null, modello: string }>`; `ultimaLettura` = `{ ocr, ocrText, ia, iaFonte, iaModello, foto }`.

- [ ] **Step 1: Scrivi i test statici che falliscono**

```js
test('scansione: niente più gara a tempo né catena di servizi', () => {
  assert.doesNotMatch(html, /ATTESA_IA_DOPO_OCR_MS|catenaIA|aggiornaConfrontoIA|ocr-confronto/);
});
test('Groq: chiave solo nell\'header Authorization, mai nell\'URL', () => {
  assert.match(html, /Authorization['"]?\s*:\s*['"]Bearer ['"]\s*\+/);
  assert.doesNotMatch(html, /api\.groq\.com[^'"`]*[?&](key|api_key)=/i);
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `node --test`
Expected: FAIL su "scansione: niente più gara…".

- [ ] **Step 3: Implementa `analizzaConGroq(pagine)`**

Immagini con `ridimensionaJpeg(p, 1600, 0.8)` per ogni pagina. Modello = `configGroq().modello || await modelloGroq(chiave)`; se `null` → `Error('nessun modello Groq che legge immagini')`. Una `POST /chat/completions` con `costruisciRichiestaGroq(imgs, CATEGORIE_ALIMENTARI, modello)` e timeout 30 000 ms. Se l'errore ha `groq.tipo === 'modello'`: `modelloGroq(chiave, [modello])` e **un solo** nuovo tentativo (se `null` → errore). Lettura = `normalizzaRispostaIA(testoRispostaGroq(j), CATEGORIE_ALIMENTARI, 'Groq')`. `foto` = `imgs[0].dataUrl` se `configGroq().salvaFoto`, altrimenti `null`.

- [ ] **Step 4: Riscrivi `gestisciFileOCR` in sequenza**

Cancella `ATTESA_IA_DOPO_OCR_MS`, `NOMI_IA`, `aggiornaConfrontoIA`, `catenaIA`, `finestraChiusa`, la gara `Promise.race`, il div `#ocr-confronto` e le sue chiamate. Nuovo flusso (dopo HEIC e rendering PDF, invariati):
1. `motivoNoGroq` = `''` se `groqPronto() && !pausaGroq()`, altrimenti: non attivo → `''` (nessun avviso), chiave non valida → `'Chiave Groq non valida o revocata: creane una nuova su console.groq.com/keys'`, pausa → `'Groq in pausa fino alle HH:MM (motivo)'`.
2. Se Groq è usabile: `ocrStatus` "Lettura con Groq…"; `await analizzaConGroq(pagine)`; se `lettura.errori.length === 0` → `parsed` dalla lettura (stessa forma di oggi), nota info `'Scontrino letto da Groq (modello).'`. Altrimenti `motivoNoGroq = errore o lettura.errori[0]`.
3. Se `parsed` manca: se `typeof Tesseract === 'undefined'` → errore `(motivoNoGroq ? motivoNoGroq + '. ' : '') + 'OCR locale non caricato: inserisci i prodotti a mano.'`; altrimenti `ocrLocale(pagine)` e avviso giallo `motivoNoGroq + ': uso l\'OCR locale.'` se `motivoNoGroq`.
4. Il resto (controllo totale, anteprima) resta invariato.

- [ ] **Step 5: `salvaCasoScontrino`**

Condizione `!L0.ocr && !L0.ia`. Campi del caso: tieni `ocr*`, `iaFonte: 'groq'` quando `L0.ia`, `iaModello`, `iaRighe`, `iaTotale`, `finaleRighe`, `totaleFinale`, `foto: configGroq().salvaFoto ? L0.foto : null`. Togli `geminiRighe`, `geminiTotale`, `usoGemini`. Commento: "OCR locale o Groq vs correzione finale".

- [ ] **Step 6: Esegui i test**

Run: `node --test`
Expected: tutti PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/logic.test.js
git commit -m "Scansione: Groq e poi, solo se serve, OCR locale; niente gara a tempo"
```

---

### Task 4: Pulizia Gemini/OpenRouter, versione e documentazione

**Files:**
- Modify: `logic.js` (righe ~549–860: funzioni Gemini/OpenRouter; `module.exports` riga ~953), `tests/logic.test.js` (test Gemini/OpenRouter, ~325–610), `archivio.js:59` (commento), `index.html:2120-2121` (versione e nota), `sw.js:13`, `CLAUDE.md` (sezione "Scontrini con IA", riga sul service worker).

**Interfaces:**
- Consumes: Task 1–3 completati (nessuno usa più le funzioni da cancellare).
- Produces: nessuna nuova interfaccia.

- [ ] **Step 1: Scrivi il test che fallisce**

```js
test('nessun resto di Gemini/OpenRouter nel codice dell\'app', () => {
  for (const f of ['index.html', 'logic.js', 'sw.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /gemini|openrouter|generativelanguage/i, f);
  }
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `node --test`
Expected: FAIL che cita `logic.js` (e `index.html` se restano riferimenti nella nota di versione).

- [ ] **Step 3: Cancella da `logic.js` e dai test**

Funzioni: `costruisciRichiestaGemini`, `normalizzaRispostaGemini`, `costruisciRichiestaOpenRouter`, `testoRispostaOpenRouter`, `scegliModelloOpenRouter`, `messaggioErroreOpenRouter`, `scegliModelloGemini`, `leggiLimiteGemini`, `improntaChiave`, `quotaModelloFinita`, `leggiEsclusiGemini`, `aggiungiEsclusoGemini`, `prossimaMezzanotteLosAngeles`, `finePausaGemini`, `leggiPausaGemini`, `messaggioErroreGemini`, `conRagionamentoRidotto`, `erroreRagionamentoGemini`; i loro export e i loro test. Il test di `promptScontrino` che cita Gemini va riscritto senza (verifica solo categorie e forma JSON). Titolo di sezione: "SCONTRINI: lettura con Groq, OCR locale, analisi prodotti". In `normalizzaRispostaIA` il commento cita "Groq".

- [ ] **Step 4: Versione e note**

`APP_VERSION = '2026.11.24a'`, `CACHE_VERSION = '2026.11.24a'`; `APP_BUILD_NOTE = 'Scontrini: lettura con Groq (gratuito, modello scelto da solo), OCR del telefono solo se Groq non risponde'`. Commento in `archivio.js:59`: "OCR locale vs IA vs correzione finale".

- [ ] **Step 5: CLAUDE.md**

Riscrivi il punto "Scontrini con IA": servizio unico Groq (opzionale, spento di default); chiave solo in `localStorage['tenuta-spese.groq']` (header `Authorization: Bearer`), pausa in `tenuta-spese.groq-pausa`; una richiesta per scontrino, un solo nuovo tentativo dopo modello ritirato; modello scelto da `GET /openai/v1/models` (`scegliModelloGroq`); 401/403 → `chiaveNonValida`, nessuna richiesta finché non cambia la chiave; 429 → pausa da `retry-after`/`x-ratelimit-reset-*`/60 s; la scansione aspetta Groq (30 s) e usa l'OCR solo se Groq non c'è o fallisce; logica pura in `logic.js` (elenca le funzioni del Task 1). Nella riga di `sw.js`: il service worker non mette in cache `api.groq.com`. Il paragrafo sui casi di prova: `iaFonte: 'groq'`; i casi vecchi con `geminiRighe` restano leggibili.

- [ ] **Step 6: Esegui i test**

Run: `node --test`
Expected: tutti PASS (incluso "versioni sincronizzate").

- [ ] **Step 7: Commit**

```bash
git add logic.js tests/logic.test.js archivio.js index.html sw.js CLAUDE.md
git commit -m "Via Gemini e OpenRouter: logica, test e documentazione; versione 2026.11.24a"
```

- [ ] **Step 8: Verifica manuale nel browser (dall'utente, dopo il merge sul branch del telefono)**

Questo ambiente non raggiunge `api.groq.com`, quindi la verifica dal vivo la fa l'utente:
1. Impostazioni → incolla la chiave Groq → **Prova**. Atteso: verde "Funziona: modello «…», risposta in N s" con N di pochi secondi. Se resta appeso o dà errore di rete (CORS) → fermarsi e tornare a progettare.
2. **Salva**, poi scansiona uno scontrino a una pagina e uno PDF a più pagine. Atteso: nota "Scontrino letto da Groq"; se Groq rifiuta il PDF (troppe immagini) → avviso giallo e OCR, senza blocchi.
3. Annotare il nome del modello scelto: se non è un modello che legge immagini, va corretta la regola di `scegliModelloGroq` con un test.
