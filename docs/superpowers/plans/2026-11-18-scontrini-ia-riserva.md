# Scontrini: Gemini riparato + OpenRouter di riserva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini cambia modello invece di fermarsi per un giorno quando la quota di un modello è finita; OpenRouter (modelli `:free` con immagini) fa da riserva; il salvataggio chiede conferma anche quando il totale stampato non è stato letto.

**Architecture:** Regole pure (scelta modelli, esclusioni, richieste/risposte, messaggi d'errore, controllo totale) in `logic.js` con test `node --test`; client `fetch`, catena dei servizi e UI in `index.html`. Nessuna dipendenza nuova.

**Tech Stack:** JS vanilla, PWA single-file, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-scontrini-ia-riserva-design.md`

## Global Constraints

- Chiavi e modelli SOLO in `localStorage['tenuta-spese.ia']` (mai in `stato`, mai nei backup); chiavi solo negli header (`x-goog-api-key`, `Authorization: Bearer`), mai in URL o messaggi.
- In localStorage non si salva mai la chiave fuori da `tenuta-spese.ia`: per legare dati alla chiave si usa un'impronta (`improntaChiave`).
- Pause per servizio separate: `tenuta-spese.ia-pausa` (Gemini, esistente) e `tenuta-spese.ia-pausa-openrouter`. Esclusioni modelli Gemini: `tenuta-spese.ia-esclusi`.
- Per scansione al massimo: Gemini 1 richiesta + (solo su 404 o 429 `zero`/`giorno`) 1 `models.list` + 1 richiesta; OpenRouter 1 richiesta + (solo su 404/"no endpoints") 1 elenco + 1 richiesta. Mai servizi remoti in parallelo.
- Timeout per singola richiesta remota nella catena: 25 s. `ATTESA_IA_DOPO_OCR_MS = 6000`.
- Ogni valore esterno in `innerHTML` passa da `escapeHtml()`. Importi con `round2`.
- `APP_VERSION` (index.html) e `CACHE_VERSION` (sw.js) bumpate insieme a `2026.11.18a`.
- Testi UI in italiano.

## Review Focus

1. Chiave Gemini cambiata dopo un'esclusione → la lista esclusi della vecchia chiave non deve valere per la nuova (test in Task 1).
2. Tutti i modelli Gemini esclusi o elenco vuoto → nessun ciclo, pausa fino a mezzanotte LA con messaggio "nessun modello gratuito" (test in Task 1 su `scegliModelloGemini` → null).
3. Risposta OpenRouter con JSON dentro testo/fence o `content` come array di parti → va comunque letta (test in Task 2).
4. Elenco OpenRouter senza modelli gratuiti con immagini → `null`, messaggio chiaro, nessuna richiesta (test in Task 2).
5. Totale riportato 0/null/NaN → stato `mancante`, non `diverso` (test in Task 3).

---

### Task 1: Gemini — esclusione dei modelli a quota finita (logica pura)

**Files:**
- Modify: `logic.js` (zona Gemini ~620-740 ed export ~840)
- Test: `tests/logic.test.js`

**Interfaces:**
- Produces:
  - `improntaChiave(chiave: string) -> string` — hash FNV-1a 32 bit in esadecimale (8 caratteri); non reversibile in pratica, mai la chiave.
  - `quotaModelloFinita(info) -> boolean` — `true` se `info.tipo` è `'zero'` o `'giorno'`.
  - `leggiEsclusiGemini(raw: string|null, impronta: string, adessoMs: number) -> string[]` — nomi dei modelli esclusi ancora validi per quella impronta; JSON rovinato/altra impronta/scaduti → `[]`.
  - `aggiungiEsclusoGemini(raw: string|null, impronta: string, modello: string, finoMs: number, adessoMs: number) -> string` — nuovo JSON `{impronta, modelli:{[nome]: finoMs}}`; se l'impronta salvata è diversa riparte da vuoto; scarta le voci scadute.
  - `scegliModelloGemini(elenco, escludi)` — firma invariata, preferenze nuove: flash stabile con versione (`/^gemini-\d+(\.\d+)?-flash$/`, più recente) > alias `gemini-flash-latest` > flash-lite stabile (`/^gemini-\d+(\.\d+)?-flash-lite$/`) > altro flash non preview/exp > resto.

- [ ] **Step 1: Write the failing tests**

```js
test('improntaChiave: stabile, 8 hex, diversa per chiavi diverse, non contiene la chiave', () => {
  const a = L.improntaChiave('AIzaSyCHIAVE-1'), b = L.improntaChiave('AIzaSyCHIAVE-2');
  assert.match(a, /^[0-9a-f]{8}$/); assert.equal(a, L.improntaChiave('AIzaSyCHIAVE-1')); assert.notEqual(a, b);
});
test('quotaModelloFinita: zero e giorno sì, minuto e sconosciuto no', () => {
  assert.equal(L.quotaModelloFinita({ tipo: 'zero' }), true);
  assert.equal(L.quotaModelloFinita({ tipo: 'giorno' }), true);
  assert.equal(L.quotaModelloFinita({ tipo: 'minuto' }), false);
  assert.equal(L.quotaModelloFinita(null), false);
});
test('esclusi Gemini: aggiunta, scadenza, altra chiave, JSON rovinato', () => {
  const t = 1_000_000;
  let raw = L.aggiungiEsclusoGemini(null, 'aaaa1111', 'gemini-flash-latest', t + 5000, t);
  raw = L.aggiungiEsclusoGemini(raw, 'aaaa1111', 'gemini-2.5-flash', t + 100, t);
  assert.deepEqual(L.leggiEsclusiGemini(raw, 'aaaa1111', t).sort(), ['gemini-2.5-flash', 'gemini-flash-latest']);
  assert.deepEqual(L.leggiEsclusiGemini(raw, 'aaaa1111', t + 200), ['gemini-flash-latest']);
  assert.deepEqual(L.leggiEsclusiGemini(raw, 'bbbb2222', t), []);
  assert.deepEqual(L.leggiEsclusiGemini('{rotto', 'aaaa1111', t), []);
  const altra = L.aggiungiEsclusoGemini(raw, 'bbbb2222', 'gemini-2.5-flash', t + 5000, t);
  assert.deepEqual(L.leggiEsclusiGemini(altra, 'bbbb2222', t), ['gemini-2.5-flash']);
  assert.deepEqual(L.leggiEsclusiGemini(altra, 'aaaa1111', t), []);
});
test('scegliModelloGemini: flash stabile prima dell\'alias, poi lite, null se tutto escluso', () => {
  const m = n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] });
  const el = ['gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'].map(m);
  assert.equal(L.scegliModelloGemini(el), 'gemini-2.5-flash');
  assert.equal(L.scegliModelloGemini(el, ['gemini-2.5-flash', 'gemini-2.0-flash']), 'gemini-flash-latest');
  assert.equal(L.scegliModelloGemini(el, ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest']), 'gemini-2.5-flash-lite');
  assert.equal(L.scegliModelloGemini([m('gemini-2.5-flash')], ['gemini-2.5-flash']), null);
});
```

Aggiorna il test esistente `scegliModelloGemini: alias latest, …` (~riga 422) alle nuove preferenze.

- [ ] **Step 2:** `node --test` → FAIL (funzioni non definite / alias scelto per primo).
- [ ] **Step 3:** Implementa in `logic.js` le funzioni sopra ed esportale.
- [ ] **Step 4:** `node --test` → tutti PASS.
- [ ] **Step 5: Commit** `git commit -am "Gemini: esclusione dei modelli a quota finita, flash stabile preferito"`

### Task 2: OpenRouter e prompt comune (logica pura)

**Files:**
- Modify: `logic.js` (sezione SCONTRINI ~549-620, export)
- Test: `tests/logic.test.js`

**Interfaces:**
- Produces:
  - `promptScontrino(categorie: string[]) -> string` — il testo oggi dentro `costruisciRichiestaGemini`, più (per chi non ha schema) la forma JSON attesa: `{"negozio","localita","data","totale","righe":[{"prodotto","categoria","prezzo"}]}`. `costruisciRichiestaGemini` lo usa (output invariato per i test esistenti salvo il testo aggiunto).
  - `normalizzaRispostaIA(raw, categorie, servizio: string) -> lettura` — l'attuale corpo di `normalizzaRispostaGemini` con `servizio` al posto di "Gemini" nei messaggi; inoltre se `raw` è testo con JSON preceduto/seguito da altro testo estrae il primo `{`…ultimo `}`. `normalizzaRispostaGemini(raw, cat)` = `normalizzaRispostaIA(raw, cat, 'Gemini')`.
  - `costruisciRichiestaOpenRouter(immagini: {mime, base64}[], categorie, modello: string, conJson: boolean) -> object` — `{model, temperature:0, messages:[{role:'user', content:[{type:'text',text:promptScontrino(cat)}, ...{type:'image_url', image_url:{url:'data:'+mime+';base64,'+base64}}]}], ...(conJson ? {response_format:{type:'json_object'}} : {})}`.
  - `testoRispostaOpenRouter(j) -> string` — `j.choices[0].message.content` se stringa; se array, concatena i `.text`; altrimenti `''`.
  - `scegliModelloOpenRouter(elenco: object[], escludi: string[] = []) -> {id: string, json: boolean} | null` — da `data` di `GET /api/v1/models`: tiene `id` che finisce con `:free`, `architecture.input_modalities` contiene `'image'`, `pricing.prompt` e `pricing.completion` numericamente 0, non in `escludi`; ordina per `context_length` decrescente, a parità id più corto; `json` = `supported_parameters` include `'response_format'`.
  - `messaggioErroreOpenRouter(status: number, dettaglio: string) -> string` — 401: "chiave OpenRouter non valida"; 402: "credito OpenRouter esaurito (usa un modello :free)"; 404 o dettaglio con "No endpoints": "modello non disponibile o senza lettura immagini"; 429: "limite gratuito di OpenRouter raggiunto"; ≥500: "OpenRouter temporaneamente non disponibile"; 400: "richiesta rifiutata da OpenRouter (dettaglio)"; altro "errore OpenRouter N". Dettaglio troncato a 160.

- [ ] **Step 1: Write the failing tests**

```js
test('costruisciRichiestaOpenRouter: immagini come data URL, json solo se supportato', () => {
  const r = L.costruisciRichiestaOpenRouter([{ mime: 'image/jpeg', base64: 'AAA' }], CATS, 'x/y:free', true);
  assert.equal(r.model, 'x/y:free');
  assert.equal(r.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAA');
  assert.match(r.messages[0].content[0].text, /righe/);
  assert.deepEqual(r.response_format, { type: 'json_object' });
  assert.equal('response_format' in L.costruisciRichiestaOpenRouter([], CATS, 'x', false), false);
});
test('testoRispostaOpenRouter: stringa, array di parti, vuoto', () => {
  assert.equal(L.testoRispostaOpenRouter({ choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
  assert.equal(L.testoRispostaOpenRouter({ choices: [{ message: { content: [{ type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }] } }] }), '{"a":1}');
  assert.equal(L.testoRispostaOpenRouter({}), '');
});
test('normalizzaRispostaIA: JSON in mezzo a testo, nome servizio nei messaggi', () => {
  const r = L.normalizzaRispostaIA('Ecco:\n```json\n{"righe":[{"prodotto":"Latte","prezzo":1.2}],"totale":1.2}\n```\nFine', CATS, 'OpenRouter');
  assert.equal(r.righe.length, 1); assert.equal(r.errori.length, 0);
  assert.match(L.normalizzaRispostaIA('boh', CATS, 'OpenRouter').errori[0], /OpenRouter/);
});
test('scegliModelloOpenRouter: solo :free con immagini e prezzo 0, contesto maggiore, esclusioni, null', () => {
  const m = (id, img, prezzo, ctx, params = []) => ({ id, context_length: ctx, architecture: { input_modalities: img ? ['text', 'image'] : ['text'] }, pricing: { prompt: prezzo, completion: prezzo }, supported_parameters: params });
  const el = [m('a/testo:free', false, '0', 900000), m('b/vis', true, '0.000001', 900000), m('c/vis:free', true, '0', 128000, ['response_format']), m('d/vis:free', true, '0', 262000)];
  assert.deepEqual(L.scegliModelloOpenRouter(el), { id: 'd/vis:free', json: false });
  assert.deepEqual(L.scegliModelloOpenRouter(el, ['d/vis:free']), { id: 'c/vis:free', json: true });
  assert.equal(L.scegliModelloOpenRouter([m('a/testo:free', false, '0', 1)]), null);
  assert.equal(L.scegliModelloOpenRouter(null), null);
});
test('messaggioErroreOpenRouter: casi principali, mai la chiave', () => {
  assert.match(L.messaggioErroreOpenRouter(401, ''), /chiave/);
  assert.match(L.messaggioErroreOpenRouter(429, ''), /limite/);
  assert.match(L.messaggioErroreOpenRouter(400, 'No endpoints found that support image input'), /immagini/);
});
```

- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implementa ed esporta. I test esistenti di `costruisciRichiestaGemini`/`normalizzaRispostaGemini` devono restare verdi.
- [ ] **Step 4:** `node --test` → PASS.
- [ ] **Step 5: Commit** `git commit -am "OpenRouter: richiesta, risposta, scelta modello gratuito, errori"`

### Task 3: Controllo del totale (logica pura)

**Files:** Modify `logic.js`; Test `tests/logic.test.js`

**Interfaces:**
- Produces: `controlloTotale(somma: number, totaleRiportato: number|null) -> {stato: 'ok'|'diverso'|'mancante', delta: number|null}` — `mancante` se `totaleRiportato` non è numero finito > 0; `diverso` se `|round2(somma - tot)| > 0.01`; `delta = round2(somma - tot)` (null se mancante).

- [ ] **Step 1: Write the failing test**

```js
test('controlloTotale: ok, diverso con delta, mancante', () => {
  assert.deepEqual(L.controlloTotale(10.1 + 0.2, 10.3), { stato: 'ok', delta: 0 });
  assert.deepEqual(L.controlloTotale(12.5, 10), { stato: 'diverso', delta: 2.5 });
  for (const t of [null, 0, NaN, undefined]) assert.equal(L.controlloTotale(5, t).stato, 'mancante');
});
```

- [ ] **Step 2–4:** fail → implementa/esporta → pass.
- [ ] **Step 5: Commit** `git commit -am "controlloTotale: stato del totale per avvisi e conferma"`

### Task 4: Client Gemini con esclusioni (index.html)

**Files:** Modify `index.html` (~3513-3690 client; ~5754-5810 Impostazioni)

**Interfaces:**
- Consumes: Task 1 (`improntaChiave`, `quotaModelloFinita`, `leggiEsclusiGemini`, `aggiungiEsclusoGemini`, `scegliModelloGemini`, `prossimaMezzanotteLosAngeles`).
- Produces: `analizzaConGemini(pagine, timeoutMs = 25000) -> Promise<{lettura, foto, modello}>`; errori con `.pausa`/`.status` come oggi.

- [ ] **Step 1:** `IA_MODELLO_DEFAULT = 'gemini-2.5-flash'`; costante `IA_ESCLUSI_KEY = 'tenuta-spese.ia-esclusi'`; helper `esclusiGemini(chiave)` e `escludiModelloGemini(chiave, modello)` (scadenza `prossimaMezzanotteLosAngeles(Date.now())`) che leggono/scrivono localStorage in try/catch.
- [ ] **Step 2:** In `richiestaGemini`, per un 429 con `quotaModelloFinita(info)`: NON chiamare `mettiInPausaGemini`; imposta `err.quotaModello = true`. Per `minuto`/`sconosciuto` resta la pausa attuale.
- [ ] **Step 3:** `analizzaConGemini`: se `e.status === 404 || e.quotaModello` → se quota, `escludiModelloGemini`; sostituto = `scegliModelloGemini(await elencaModelliGemini(chiave), [modello, ...esclusiGemini(chiave)])`; se `null` → `mettiInPausaGemini({tipo:'giorno'}, 'nessun modello gratuito disponibile per questa chiave oggi')` e lancia errore con quel messaggio; altrimenti una richiesta sul sostituto; se anche questa dà quota → escludilo, pausa come sopra, lancia. Successo → salva modello + toast "Modello Gemini X senza quota gratuita oggi: passato a Y." Restituisce anche `modello`.
- [ ] **Step 4:** "Prova la connessione": stesso ramo per `e.quotaModello` (usa la sostituzione con esclusione); lo stato mostra il modello in uso e, se non vuota, "Esclusi fino a mezzanotte (ora USA): …" (testo via `textContent`).
- [ ] **Step 5:** `node --test` PASS; prova manuale con `python3 -m http.server` simulando in console un 429 `limit: 0` (mock di `fetch`) e verifica: nessuna pausa, modello cambiato, `tenuta-spese.ia-esclusi` scritto.
- [ ] **Step 6: Commit** `git commit -am "Gemini: un modello senza quota viene sostituito, non blocca il giorno"`

### Task 5: Client OpenRouter + Impostazioni (index.html)

**Files:** Modify `index.html` (markup `#widget-ia` ~1828-1860; JS Impostazioni ~5710-5810; nuovo blocco client dopo il client Gemini)

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `configIA()` restituisce in più `orAttivo: boolean, orChiave: string, orModello: string, orJson: boolean` (stesso oggetto in `tenuta-spese.ia`).
  - `openRouterPronto() -> boolean` (attivo e chiave > 10 caratteri).
  - `pausaOpenRouter() -> {fino, motivo}|null`, `mettiInPausaOpenRouter(motivo)` (pausa: `Retry-After` se presente, altrimenti 60 s; se il messaggio/dettaglio cita "per day"/"per-day" fino a mezzanotte UTC).
  - `analizzaConOpenRouter(pagine, timeoutMs = 25000) -> Promise<{lettura, foto, modello}>`.

- [ ] **Step 0: Verifica preliminare (bloccante).** Leggi la documentazione OpenRouter (API reference, limiti, FAQ) e conferma: chiamate dal browser consentite (CORS), header `HTTP-Referer`/`X-Title` facoltativi, forma del 429. Se le chiamate dal browser non sono consentite: fermati e riferisci all'utente.
- [ ] **Step 1:** Client: `POST https://openrouter.ai/api/v1/chat/completions` con `Authorization: Bearer <orChiave>`, `Content-Type`, `X-Title: Tenuta Spese`; corpo `costruisciRichiestaOpenRouter(imgs (max 5, ridimensionaJpeg), CATEGORIE_ALIMENTARI, modello, orJson)`; errori via `messaggioErroreOpenRouter`; 429 → `mettiInPausaOpenRouter`; testo via `testoRispostaOpenRouter`, lettura via `normalizzaRispostaIA(testo, CATEGORIE_ALIMENTARI, 'OpenRouter')`. Timeout/rete come `richiestaGemini`.
- [ ] **Step 2:** Modello: se `orModello` vuoto o 404/"No endpoints" → `GET https://openrouter.ai/api/v1/models` (fetch `cache: 'no-store'`), `scegliModelloOpenRouter(j.data, [modelloRotto])`, una sola nuova richiesta, salva `orModello`/`orJson` e toast. `null` → errore "nessun modello gratuito che legge immagini su OpenRouter in questo momento".
- [ ] **Step 3:** Markup: titolo "IA per gli scontrini"; sotto-blocco Gemini (campi esistenti, id invariati) e sotto-blocco "OpenRouter (riserva)" con `#or-attivo`, `#or-chiave` (password), `#or-modello` + `#or-modelli` datalist, pulsanti `#btn-or-test`, `#btn-or-modelli`, `#or-stato`; riga "Ordine: Gemini → OpenRouter → OCR del telefono"; avviso privacy: "Con OpenRouter la foto viene inviata a OpenRouter e al fornitore del modello gratuito, che può usarla per migliorare i suoi servizi." Ogni intestazione di blocco mostra lo stato (attivo / in pausa fino alle HH:MM / non configurato). Il pulsante Salva esistente salva entrambi. Campi 16px, tap ≥44px (classi esistenti).
- [ ] **Step 4:** "Prova" OpenRouter: richiesta testuale minima (`messages:[{role:'user',content:'Rispondi solo: ok'}]`, `max_tokens: 16`) sul modello scelto (scegliendolo se vuoto). "Cerca modello" riempie `#or-modelli` con gli id gratuiti con immagini (`escapeHtml`).
- [ ] **Step 5:** `node --test` PASS (incluso il test escapeHtml su innerHTML). Prova manuale con mock di `fetch` per 200, 401, 429.
- [ ] **Step 6: Commit** `git commit -am "OpenRouter come secondo servizio per gli scontrini, Impostazioni a due blocchi"`

### Task 6: Catena della scansione, controllo totale, casi di prova, versione

**Files:** Modify `index.html` (`gestisciFileOCR` ~3703-3800, preview/alert, salvataggio ~4880-4900, `salvaCasoScontrino` ~4932), `sw.js`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 3 `controlloTotale`; Task 4 `analizzaConGemini`; Task 5 `analizzaConOpenRouter`, `openRouterPronto`, `pausaOpenRouter`.
- Produces: `ultimaLettura` con `ia: lettura|null`, `iaFonte: 'gemini'|'openrouter'|null`, `iaModello: string` (il campo `gemini` resta come alias di `ia` quando la fonte è Gemini, per `aggiornaConfrontoIA` e compatibilità).

- [ ] **Step 1:** `catenaIA(pagine, finestraChiusa: () => boolean) -> Promise<{lettura, foto, fonte, modello, motivi: string[]}>`: prova Gemini se pronto e non in pausa; se fallisce/lettura con errori/in pausa, e `!finestraChiusa()`, prova OpenRouter se pronto e non in pausa; altrimenti rifiuta con i motivi. Mai in parallelo.
- [ ] **Step 2:** `gestisciFileOCR`: sostituisci `pGem` con `catenaIA`; finestra `ATTESA_IA_DOPO_OCR_MS` (rinomina della costante, stesso valore 6000) dopo la fine dell'OCR; quando scade, `finestraChiusa()` diventa true. Se nessun servizio IA è usabile e manca Tesseract → errore come oggi (messaggio che nomina entrambi i servizi). Messaggio in preview: "Scontrino letto da Gemini/OpenRouter (modello)…" e, se c'è stato ripiego, i motivi ("Gemini in pausa fino alle …: letto con OpenRouter"). Toast "Gemini/OpenRouter/OCR completato".
- [ ] **Step 3:** Preview: dopo `popolaPreviewDaParser`, `controlloTotale(parsed.totale, parsed.totaleRiportato)`: `diverso` → `alert danger` in cima con somma, totale e differenza; `mancante` → `alert warning` "Totale dello scontrino non letto: controlla le righe".
- [ ] **Step 4:** Salvataggio: mantieni la conferma esistente per `diverso`; aggiungi per `mancante` la conferma "Il totale dello scontrino non è stato letto: la somma dei prodotti è X €. È giusta?" (annulla → toast come oggi).
- [ ] **Step 5:** `salvaCasoScontrino`: aggiungi `iaFonte`, `iaModello`, `iaRighe`, `iaTotale`; `geminiRighe/geminiTotale/usoGemini` valorizzati solo se la fonte è Gemini. Condizione d'ingresso `L0.ocr || L0.ia`.
- [ ] **Step 6:** `APP_VERSION` e `CACHE_VERSION` → `2026.11.18a`. CLAUDE.md: aggiorna il paragrafo "Scontrini con Gemini" (catena Gemini → OpenRouter → OCR, esclusioni modelli fino a mezzanotte LA, pausa separata per servizio, chiave OpenRouter solo in `tenuta-spese.ia`, `ATTESA_IA_DOPO_OCR_MS`).
- [ ] **Step 7:** `node --test` PASS. Prova manuale nel browser con mock di `fetch`: (a) Gemini 429 `limit: 0` → sostituto; (b) Gemini in pausa → OpenRouter legge; (c) entrambi falliti → OCR con motivi; (d) totale mancante → conferma al salvataggio.
- [ ] **Step 8: Commit** `git commit -am "Scansione: catena Gemini → OpenRouter → OCR, conferma anche senza totale"` e push sul branch.
