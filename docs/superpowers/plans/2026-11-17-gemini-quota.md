# Gemini rispettoso dei limiti gratuiti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini manda al massimo una richiesta per scansione/prova, si mette in pausa da solo dopo un errore di quota (429) mostrando quale limite è stato superato, e aggiorna il modello solo quando Google lo ritira (404).

**Architecture:** La logica pura (lettura del 429, calcolo/lettura della pausa, scelta del modello sostitutivo, messaggi) va in `logic.js` con test `node --test`. `index.html` la collega: la pausa sta in `localStorage['tenuta-spese.ia-pausa']` e viene controllata e impostata in un unico punto (`richiestaGemini`), così vale per scansione e prova. Si eliminano le raffiche di modelli di riserva.

**Tech Stack:** JS vanilla senza build (`index.html` inline + `logic.js`), test `node --test`, Playwright preinstallato per la verifica nel browser.

**Spec:** `docs/superpowers/specs/2026-11-17-gemini-quota-design.md`

## Global Constraints

- Al massimo 2 richieste di generazione per azione dell'utente (2 solo nel caso 404: tentativo + nuovo tentativo col modello sostitutivo). Mai richieste in parallelo a più modelli.
- Pausa e chiave mai in `stato` né nei backup: pausa in `localStorage['tenuta-spese.ia-pausa']` = `{ fino, motivo }`.
- Durata pausa: limite al minuto → `retryDelay` di Google (60 s se manca); limite al giorno o "limite 0" → prossima mezzanotte `America/Los_Angeles`; non riconosciuto → `retryDelay` o 60 s.
- Pausa annullata quando scade o quando si salvano chiave o modello diversi da quelli salvati.
- Modello predefinito: `gemini-flash-latest`.
- Nessuna riduzione della foto (scelta del design).
- Testi utente in italiano; messaggi mostrati sempre con `textContent` (mai `innerHTML`).
- A ogni release `APP_VERSION` (index.html) e `CACHE_VERSION` (sw.js) identiche: `2026.11.17e`.

## Review Focus

1. Un 404 su un modello che Google **elenca ancora** (es. `gemini-2.5-flash`, "no longer available to new users"): il sostituto non deve essere lo stesso modello → test in Task 1.
2. Un 429 senza `details` (solo testo, o corpo non JSON): pausa breve di riserva, nessun errore → test in Task 2.
3. Pausa giornaliera a cavallo del cambio d'ora USA (marzo/novembre): mezzanotte di Los Angeles giusta → test in Task 2.
4. Pausa salvata rovinata o scaduta in localStorage: trattata come "nessuna pausa", niente crash → test in Task 2 (`leggiPausaGemini`).
5. Dopo un 429, l'utente incolla una chiave nuova e salva: la pausa sparisce e la prova parte subito → verifica nel browser in Task 4.

---

### Task 1: Modello sostitutivo che esclude quello rotto; via le riserve in parallelo dalla logica

**Files:**
- Modify: `logic.js` (`scegliModelloGemini` ~624, `alternativeGemini` ~650 da eliminare, exports ~801)
- Test: `tests/logic.test.js` (test `scegliModelloGemini` ~412; i due test `alternativeGemini` ~447-464 da eliminare)

**Interfaces:**
- Produces: `scegliModelloGemini(elenco: Array, escludi: string[] = []) -> string|null` — stessi criteri di oggi, ma ignora i nomi (senza `models/`) in `escludi`.
- Removes: `alternativeGemini` (non più usata da nessuno dopo Task 3).

- [ ] **Step 1: Aggiungi i test che falliscono** dentro il test `scegliModelloGemini` esistente:

```js
  assert.equal(L.scegliModelloGemini([m('gemini-flash-latest'), m('gemini-3.8-flash')], ['gemini-flash-latest']), 'gemini-3.8-flash');
  assert.equal(L.scegliModelloGemini([m('gemini-2.5-flash')], ['gemini-2.5-flash']), null);   // elencato ma ritirato: non si ripropone
```

- [ ] **Step 2: Verifica che falliscano** — Run: `node --test` · Expected: FAIL sul test `scegliModelloGemini` (oggi restituisce il modello escluso).

- [ ] **Step 3: Implementa** il parametro `escludi` in `scegliModelloGemini` (filtro sul nome già ripulito da `models/`). Elimina `alternativeGemini`, il suo export e i due test `alternativeGemini` in `tests/logic.test.js`.

- [ ] **Step 4: Verifica** — Run: `node --test` · Expected: tutti PASS (index.html usa ancora `alternativeGemini` fino al Task 3: va bene, non è testato da Node).

- [ ] **Step 5: Commit** — `git add logic.js tests/logic.test.js && git commit -m "Gemini: modello sostitutivo che esclude quello ritirato; via alternativeGemini"`

---

### Task 2: Lettura del 429 e pausa (logica pura)

**Files:**
- Modify: `logic.js` (accanto a `messaggioErroreGemini` ~663; exports)
- Test: `tests/logic.test.js` (nuovi test dopo `messaggioErroreGemini`)

**Interfaces:**
- Produces:
  - `leggiLimiteGemini(corpo: any) -> { tipo: 'minuto'|'giorno'|'zero'|'sconosciuto', limite: number|null, modello: string, attesaMs: number|null }` — `corpo` è il JSON di errore di Google (`{ error: { message, details } }`), una stringa, o qualsiasi altra cosa.
  - `prossimaMezzanotteLosAngeles(adessoMs: number) -> number`
  - `finePausaGemini(info, adessoMs: number) -> number` (timestamp ms)
  - `leggiPausaGemini(raw: string|null, adessoMs: number) -> { fino: number, motivo: string } | null`
  - `messaggioErroreGemini(status, dettaglio, info?)` — per il 429 usa `info` (output di `leggiLimiteGemini`).

Regole di `leggiLimiteGemini`:
- violazioni = `error.details[*].violations` dei dettagli con `@type` che finisce in `QuotaFailure`; `retryDelay` dal dettaglio con `@type` che finisce in `RetryInfo` (formato `"37s"` / `"37.5s"`).
- `tipo`: `'zero'` se una violazione ha `quotaValue === '0'` o il messaggio contiene `limit: 0`; altrimenti `'giorno'` se un `quotaId` (o il messaggio) contiene `PerDay`/`per day`; altrimenti `'minuto'` se contiene `PerMinute`/`per minute`; altrimenti `'sconosciuto'`. Con più violazioni vince la più lunga (zero > giorno > minuto).
- `limite`: `Number(quotaValue)` o `limit: (\d+)` dal messaggio; `modello`: `quotaDimensions.model` o `model: ([\w.-]+)` dal messaggio; `attesaMs`: da `RetryInfo` o da `retry in ([\d.]+)s` nel messaggio, arrotondato al millisecondo (`Math.round`: `30.2 * 1000` non è intero).
- Input non riconoscibile → `{ tipo: 'sconosciuto', limite: null, modello: '', attesaMs: null }`.

`finePausaGemini`: `'giorno'`/`'zero'` → `prossimaMezzanotteLosAngeles(adessoMs)`; altrimenti `adessoMs + (attesaMs ?? 60000)`.

`leggiPausaGemini`: `null` se `raw` manca, non è JSON, `fino` non è un numero finito o `fino <= adessoMs`; `motivo` convertito a stringa e tagliato a 200 caratteri.

Testi del 429 in `messaggioErroreGemini` (con `"X"` = `info.modello`, `N` = `info.limite`; le parti fra parentesi solo se il dato c'è):
- zero: `il modello "X" non è incluso nel piano gratuito della tua chiave (limite 0)`
- giorno: `quota giornaliera gratuita esaurita (N richieste al giorno per "X")`
- minuto: `troppe richieste in un minuto (limite N al minuto)`
- sconosciuto/assente: `quota gratuita esaurita o troppe richieste` + ` (dettaglio)` se c'è

- [ ] **Step 1: Scrivi i test che falliscono:**

```js
const err429 = (violazioni, retry, message = '') => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message, details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: violazioni },
  ...(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : [])
] } });

test('leggiLimiteGemini: riconosce limite al giorno, al minuto e limite 0 dal 429 di Google', () => {
  assert.deepEqual(L.leggiLimiteGemini(err429([{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20', quotaDimensions: { model: 'gemini-3.8-flash' } }], '37s')),
    { tipo: 'giorno', limite: 20, modello: 'gemini-3.8-flash', attesaMs: 37000 });
  assert.deepEqual(L.leggiLimiteGemini(err429([{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5', quotaDimensions: { model: 'gemini-3.8-flash' } }], '12.5s')),
    { tipo: 'minuto', limite: 5, modello: 'gemini-3.8-flash', attesaMs: 12500 });
  assert.equal(L.leggiLimiteGemini(err429([{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '0' }])).tipo, 'zero');
  assert.equal(L.leggiLimiteGemini(err429([
    { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '5' },
    { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }])).tipo, 'giorno');
});

test('leggiLimiteGemini: senza details usa il testo, altrimenti "sconosciuto"', () => {
  assert.deepEqual(L.leggiLimiteGemini({ error: { message: 'Quota exceeded for metric: x, limit: 20, model: gemini-3.8-flash per day. Please retry in 30.2s.' } }),
    { tipo: 'giorno', limite: 20, modello: 'gemini-3.8-flash', attesaMs: 30200 });
  for (const x of [null, undefined, '', 'not json', 42, {}, { error: {} }]) {
    assert.deepEqual(L.leggiLimiteGemini(x), { tipo: 'sconosciuto', limite: null, modello: '', attesaMs: null }, String(x));
  }
});

test('prossimaMezzanotteLosAngeles: anche a cavallo del cambio d\'ora USA', () => {
  const t = s => Date.parse(s);
  assert.equal(L.prossimaMezzanotteLosAngeles(t('2026-11-17T11:50:00Z')), t('2026-11-18T08:00:00Z'));   // PST
  assert.equal(L.prossimaMezzanotteLosAngeles(t('2026-03-08T09:00:00Z')), t('2026-03-09T07:00:00Z'));   // 01:00 PST → mezzanotte PDT
  assert.equal(L.prossimaMezzanotteLosAngeles(t('2026-11-01T08:30:00Z')), t('2026-11-02T08:00:00Z'));   // 01:30 PDT → mezzanotte PST
  assert.equal(L.prossimaMezzanotteLosAngeles(t('2026-11-18T08:00:00Z')), t('2026-11-19T08:00:00Z'));   // esattamente a mezzanotte → la successiva
});

test('finePausaGemini: giorno e zero fino a mezzanotte LA, minuto col retryDelay, ripiego 60 s', () => {
  const ora = Date.parse('2026-11-17T11:50:00Z');
  assert.equal(L.finePausaGemini({ tipo: 'giorno', attesaMs: 37000 }, ora), Date.parse('2026-11-18T08:00:00Z'));
  assert.equal(L.finePausaGemini({ tipo: 'zero', attesaMs: null }, ora), Date.parse('2026-11-18T08:00:00Z'));
  assert.equal(L.finePausaGemini({ tipo: 'minuto', attesaMs: 12500 }, ora), ora + 12500);
  assert.equal(L.finePausaGemini({ tipo: 'minuto', attesaMs: null }, ora), ora + 60000);
  assert.equal(L.finePausaGemini({ tipo: 'sconosciuto', attesaMs: null }, ora), ora + 60000);
});

test('leggiPausaGemini: valida, scaduta o rovinata', () => {
  const ora = 1_000_000;
  assert.deepEqual(L.leggiPausaGemini(JSON.stringify({ fino: ora + 5000, motivo: 'quota' }), ora), { fino: ora + 5000, motivo: 'quota' });
  for (const raw of [null, '', '{', '[]', JSON.stringify({ fino: ora }), JSON.stringify({ fino: 'domani' }), JSON.stringify({ motivo: 'x' })]) {
    assert.equal(L.leggiPausaGemini(raw, ora), null, String(raw));
  }
  assert.equal(L.leggiPausaGemini(JSON.stringify({ fino: ora + 1, motivo: 'x'.repeat(500) }), ora).motivo.length, 200);
});

test('messaggioErroreGemini: il 429 dice quale limite è stato superato', () => {
  assert.match(L.messaggioErroreGemini(429, '', { tipo: 'zero', limite: 0, modello: 'gemini-3.8-flash', attesaMs: null }), /"gemini-3\.8-flash" non è incluso nel piano gratuito/);
  assert.match(L.messaggioErroreGemini(429, '', { tipo: 'giorno', limite: 20, modello: 'gemini-3.8-flash', attesaMs: null }), /quota giornaliera gratuita esaurita \(20 richieste al giorno per "gemini-3\.8-flash"\)/);
  assert.match(L.messaggioErroreGemini(429, '', { tipo: 'minuto', limite: 5, modello: '', attesaMs: 1000 }), /troppe richieste in un minuto \(limite 5 al minuto\)/);
  assert.match(L.messaggioErroreGemini(429, ''), /quota/);
});
```

- [ ] **Step 2: Verifica che falliscano** — Run: `node --test` · Expected: FAIL (funzioni non definite).

- [ ] **Step 3: Implementa** le quattro funzioni e l'estensione di `messaggioErroreGemini` in `logic.js`, ed esportale. Per `prossimaMezzanotteLosAngeles` (l'unico algoritmo non ovvio):

```js
// Ora "da orologio" di Los Angeles per un istante, via Intl (gestisce l'ora legale USA).
const _oraLA = ms => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(ms).map(x => [x.type, x.value]));
  return { h: +p.hour, m: +p.minute, s: +p.second };
};
// da mezzanotte locale si aggiungono 24 h; se in mezzo c'è il cambio d'ora si corregge di ±1 h
// (l'ora risultante è 23 → +1 h, è 1 → -1 h).
```

- [ ] **Step 4: Verifica** — Run: `node --test` · Expected: tutti PASS.

- [ ] **Step 5: Commit** — `git add logic.js tests/logic.test.js && git commit -m "Gemini: lettura del 429 (quale limite) e calcolo della pausa"`

---

### Task 3: Collegare tutto in index.html (una richiesta, pausa, niente raffiche)

**Files:**
- Modify: `index.html` — config IA ~3514-3522, `richiestaGemini` ~3552, `correggiModelloGemini`/`analizzaConGemini` ~3619-3666, `gestisciFileOCR` ~3708-3750, Impostazioni IA ~5723-5810, `APP_VERSION`/`APP_BUILD_NOTE` ~2090
- Modify: `sw.js` (`CACHE_VERSION`), `CLAUDE.md` (riga "Scontrini con Gemini", ~38)

**Interfaces:**
- Consumes: Task 1 `scegliModelloGemini(elenco, escludi)`; Task 2 `leggiLimiteGemini`, `finePausaGemini`, `leggiPausaGemini`, `messaggioErroreGemini(status, det, info)`.
- Produces (in index.html):
  - `IA_PAUSA_KEY = 'tenuta-spese.ia-pausa'`
  - `pausaGemini() -> {fino, motivo}|null` (usa `leggiPausaGemini(localStorage, Date.now())`; se scaduta/rovinata rimuove la chiave)
  - `mettiInPausaGemini(info, motivo) -> number` (salva `{ fino: finePausaGemini(info, Date.now()), motivo }`, restituisce `fino`)
  - `togliPausaGemini()`
  - `oraBreve(ms) -> 'HH:MM'` (`toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })`)
  - `correggiModelloGemini(ia) -> Promise<string>` (elenco + `scegliModelloGemini(elenco, [ia.modello])`; lancia se `null`; **non salva**)

- [ ] **Step 1: Pausa in `richiestaGemini`** — all'inizio, se `pausaGemini()` c'è, lancia subito (nessun `fetch`) un errore con `pausa = true` e messaggio `Gemini in pausa fino alle HH:MM: <motivo>`. Su risposta non ok leggi tutto il JSON di errore; per il 429: `info = leggiLimiteGemini(corpo)`, messaggio da `messaggioErroreGemini(429, det, info)`, `fino = mettiInPausaGemini(info, messaggio)`, e il messaggio dell'errore termina con ` — nessuna nuova richiesta fino alle HH:MM`; `err.limite = info`.

- [ ] **Step 2: Scansione** — `correggiModelloGemini(ia)` come da Interfaces. `analizzaConGemini`: solo il 404 fa cercare un sostituto (un nuovo tentativo con lo stesso `corpo` e timeout 40000; se riesce `salvaConfigIA({ ...configIA(), modello: nuovo })` e toast `Modello Gemini "<vecchio>" ritirato da Google: passato automaticamente a "<nuovo>".`); ogni altro errore si rilancia. In `gestisciFileOCR`: `const pausa = pausaGemini(); const usaGemini = geminiPronto() && !pausa;`; se `geminiPronto() && pausa` l'avviso è `Gemini in pausa fino alle HH:MM (<motivo>): uso l'OCR locale.`; se manca anche l'OCR, l'errore lo dice (`Gemini in pausa fino alle HH:MM e OCR locale non caricato: inserisci i prodotti a mano.`).

- [ ] **Step 3: Impostazioni** — Elimina `cercaModelloCheRisponde` e la variabile `lento`. "Prova la connessione": se `pausaGemini()` c'è, mostra `Gemini è in pausa fino alle HH:MM: <motivo>. Nessuna richiesta inviata.` e non chiama nulla; altrimenti una richiesta; 404 → `correggiModelloGemini` + una prova + salva; timeout/5xx → `Gemini ora è lento o sovraccarico (<messaggio>): riprova tra qualche minuto`; altri (429 compreso) → messaggio dell'errore. "Salva": se chiave o modello differiscono da `configIA()` prima del salvataggio, `togliPausaGemini()`. `IA_MODELLO_DEFAULT = 'gemini-flash-latest'`.

- [ ] **Step 4: Versione e documentazione** — `APP_VERSION` e `CACHE_VERSION` = `2026.11.17e`; `APP_BUILD_NOTE` = `Gemini: una sola richiesta per scontrino, pausa automatica quando la quota gratuita finisce (con il limite superato), niente più raffiche di modelli di riserva`. In `CLAUDE.md` sostituisci la frase "Se il modello non risponde, si provano in parallelo fino a 4 riserve…" con: "Al massimo una richiesta per scansione/prova (due solo se Google ha ritirato il modello: 404 → `scegliModelloGemini` escludendo quello rotto). Dopo un 429 la pausa (`localStorage['tenuta-spese.ia-pausa']`, `leggiLimiteGemini`/`finePausaGemini`) blocca ogni richiesta fino all'azzeramento: limite al giorno → mezzanotte di Los Angeles. Niente riserve in parallelo: con la quota al limite la consumano."

- [ ] **Step 5: Verifica statica** — Run: `node --test && grep -n "alternativeGemini\|cercaModelloCheRisponde\|Promise.any" index.html logic.js` · Expected: test tutti PASS; grep senza risultati. Poi il controllo di sintassi degli script inline:
  `node -e "const h=require('fs').readFileSync('index.html','utf8');[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m=>new Function(m[1]));console.log('OK')"` · Expected: `OK`.

- [ ] **Step 6: Commit** — `git add index.html sw.js CLAUDE.md && git commit -m "Gemini: una richiesta per scansione, pausa automatica sul 429, niente raffiche di riserve"`

---

### Task 4: Verifica nel browser con Google simulato, poi pubblicazione

**Files:**
- Create (solo scratchpad, non nel repo): script Playwright che serve la cartella con `python3 -m http.server` e intercetta `https://generativelanguage.googleapis.com/**` con `page.route`.

- [ ] **Step 1: Scenario 429** — imposta in localStorage `tenuta-spese.ia` = `{ attivo: true, chiave: 'x'.repeat(39), modello: 'gemini-flash-latest' }`; la route di `:generateContent` risponde 429 con il corpo `err429([{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20', quotaDimensions: { model: 'gemini-3.8-flash' } }], '37s')` e conta le chiamate. Apri Altro → Impostazioni, premi "Prova la connessione". Expected: `#ia-stato` contiene `quota giornaliera gratuita esaurita (20 richieste al giorno per "gemini-3.8-flash")` e `nessuna nuova richiesta fino alle`; 1 sola chiamata; `tenuta-spese.ia-pausa` presente.
- [ ] **Step 2: Pausa rispettata** — premi di nuovo "Prova la connessione". Expected: messaggio `Gemini è in pausa fino alle`; contatore chiamate invariato.
- [ ] **Step 3: Chiave nuova** (Review Focus 5) — cambia il campo chiave, premi Salva, la route ora risponde 200 con `{candidates:[{content:{parts:[{text:'ok'}]}}]}`, premi "Prova la connessione". Expected: `tenuta-spese.ia-pausa` assente dopo Salva; messaggio `Connessione riuscita`.
- [ ] **Step 4: 404 con modello ancora elencato** — route `:generateContent` per `gemini-2.5-flash` → 404; route elenco modelli → `gemini-2.5-flash` e `gemini-flash-latest`; modello impostato `gemini-2.5-flash`. Expected: il campo modello diventa `gemini-flash-latest`, salvato; esattamente 2 chiamate di generazione.
- [ ] **Step 5: Timeout/5xx** — route risponde 503. Expected: messaggio `Gemini ora è lento o sovraccarico`; 1 sola chiamata; nessuna pausa salvata.
- [ ] **Step 6: Pubblicazione** — push su `claude/bold-rubin-m7cha9`, PR verso `Tenuta-spese-telefono`, attendi il check `test` verde, squash merge, verifica che parta "Deploy PWA to GitHub Pages"; poi riallinea `claude/bold-rubin-m7cha9` a `origin/Tenuta-spese-telefono`.
