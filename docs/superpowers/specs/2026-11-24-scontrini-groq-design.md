# Scontrini: lettura con Groq, riscritta da zero — design

Data: 2026-11-24 · Stato: da approvare

## Perché

La lettura scontrini con IA (catena Gemini → OpenRouter → OCR locale) non funziona più, nonostante
molte correzioni mirate:

- In Impostazioni, "Prova la connessione" di Gemini fallisce in rosso: *"Gemini ora è lento o
  sovraccarico (Gemini non ha risposto entro 45 secondi)"*, perfino con una richiesta di solo testo.
- Durante la scansione parte sempre l'OCR locale, che legge male righe e prezzi.
- Nelle conversazioni passate si è visto che le chiamate erano troppe e consumavano la quota gratuita.
- Le correzioni a strati (esclusi, pause, sostituti, alias) hanno reso il codice fragile: serve un reset.

C'è anche un difetto di progetto, indipendente dal fornitore: oggi OCR locale e IA partono insieme e,
appena l'OCR finisce, all'IA si concedono solo 6 secondi (`ATTESA_IA_DOPO_OCR_MS`). I servizi gratuiti
impiegano spesso di più, quindi l'IA quasi sempre "perde" e si vede il risultato dell'OCR.

L'utente vuole la soluzione **con meno passaggi possibili**: un solo fornitore gratuito, **Groq**, più
l'OCR locale come ultima risorsa.

## Obiettivi

1. Gemini e OpenRouter vengono **rimossi del tutto**: codice, impostazioni, chiavi salvate, test.
2. Groq legge gli scontrini con **una sola richiesta per scontrino** (nessuna raffica, nessun tentativo
   in parallelo).
3. Quando Groq è configurato e disponibile, **la scansione aspetta Groq**: niente gara con l'OCR.
   L'OCR locale parte solo se Groq non è configurato, è in pausa o fallisce.
4. **Il modello si sceglie da solo.** L'utente inserisce solo la chiave; l'app legge l'elenco dei
   modelli di Groq e prende uno che legge immagini. Se il modello viene ritirato, l'app ne sceglie un
   altro senza chiedere niente.
5. Messaggi chiari quando serve l'utente: chiave sbagliata o revocata → messaggio con il link alla
   pagina delle chiavi di Groq (`https://console.groq.com/keys`).
6. Restano gli avvisi sul totale (rosso se la somma non torna, giallo se il totale non è stato letto)
   e la conferma al salvataggio.

## Non obiettivi

- Migliorare l'OCR locale (`parseScontrino`). Se Groq non dovesse funzionare, l'utente vuole come
  **progetto successivo** un OCR locale molto più "ragionato": è un brainstorming a parte, non questo.
- Altri fornitori (Mistral, Cohere, OpenRouter, Gemini…). Il codice non deve prepararsi a ospitarne
  altri: niente astrazioni "multi-fornitore".
- Un server/proxy proprio: l'app resta statica su GitHub Pages, la chiamata parte dal browser.
- Ottenere chiavi automaticamente: una chiave è personale e la crea l'utente; l'app può solo
  accorgersi che non va più e dirlo.

## Anti-obiettivi (fallimento anche se "funziona")

- Più di una richiesta di lettura per scontrino, o richieste automatiche non chieste (all'avvio, in
  background, prove ripetute).
- La scansione che resta appesa: Groq ha un tempo massimo, poi si passa all'OCR.
- La chiave nei backup, nello `stato`, negli URL, nei messaggi d'errore o nei log.
- Codice morto di Gemini/OpenRouter lasciato "per sicurezza".

## Vincoli (dal progetto, CLAUDE.md)

- Logica pura in `logic.js` con test `node --test`; `index.html` solo UI e chiamate di rete.
- Chiave e stato del servizio solo in `localStorage` del dispositivo, mai in `stato`.
- La chiave solo nell'header `Authorization: Bearer`, mai nell'URL.
- Ogni valore da rete/utente in `innerHTML` passa da `escapeHtml()`.
- `APP_VERSION` e `CACHE_VERSION` bumpate insieme; il service worker non mette in cache `api.groq.com`.
- La CSP (`connect-src 'self' https: …`) permette già `api.groq.com`.
- I limiti gratuiti di Groq (richieste al minuto/giorno, immagini per richiesta, dimensione) cambiano e
  le fonti non concordano: **niente numeri scritti nel codice**, si reagisce alle risposte (429 con
  `retry-after`). Non è stato possibile leggere la documentazione di Groq né provare l'API da questo
  ambiente (rete bloccata): vanno verificati al momento dell'implementazione, nel browser.

## Approcci considerati

1. **Un motore unico per più fornitori** (Groq + OpenRouter + Gemini, stesso formato di richiesta,
   una "scheda" per fornitore). Più robusto, ma richiede 2–3 chiavi e più codice.
2. **Solo Groq + OCR locale** ← **scelto dall'utente**: meno passaggi (una chiave, nessuna scelta di
   modello), meno codice. Il rischio è dipendere da un solo fornitore; se non regge, si passa al
   progetto "OCR locale ragionato".
3. **Server intermedio con chiavi dell'app**: scartato, le chiavi verrebbero copiate e consumate da
   altri, e l'app deve restare statica.

## Come funziona (deciso)

### Impostazioni

Il blocco "Lettura scontrini con IA" diventa un solo riquadro **Groq**:

```
Groq                                   [● pronto]
[x] Usa Groq per leggere gli scontrini
Chiave API  [••••••••••••••]   (crea una chiave gratuita: console.groq.com/keys)
[Prova]  [Salva]
Modello in uso: <nome>  (scelto automaticamente)
<riga di stato: verde/rosso/giallo>
[ ] Conserva una copia ridotta della foto nei casi di prova
```

Nessun campo "modello" da compilare. "Prova" fa: elenco modelli → scelta → una richiesta minima.
"Salva" non fa richieste di rete. Dopo l'aggiornamento Groq parte spento (le vecchie chiavi sono
cancellate): l'utente incolla la chiave, preme Prova e Salva.

### Configurazione salvata

`localStorage['tenuta-spese.groq']` = `{ attivo, chiave, modello, chiaveNonValida, salvaFoto }`.
`chiaveNonValida` diventa `true` dopo un 401/403 e torna `false` quando si salva una chiave diversa o
quando "Prova" riesce. Finché è `true` la scansione **non chiama Groq** (nessuna richiesta sicuramente
fallita) e mostra subito l'avviso con il link per una chiave nuova.
Pausa in `localStorage['tenuta-spese.groq-pausa']` = `{ fino, motivo }`.
Le vecchie chiavi `tenuta-spese.ia`, `tenuta-spese.ia-pausa`, `tenuta-spese.ia-pausa-openrouter`,
`tenuta-spese.ia-esclusi` vengono **cancellate** al primo avvio della nuova versione (contengono chiavi
di servizi non più usati). Il flag `salvaFoto` si porta nella nuova configurazione.

### Scelta del modello (automatica)

- `GET https://api.groq.com/openai/v1/models` con la chiave.
- Logica pura `scegliModelloGroq(elenco, escludi)` in `logic.js`: tiene solo i modelli che leggono
  immagini. Se la risposta di Groq ha un campo che lo dice, si usa quello; altrimenti si riconoscono
  dal nome con una lista di preferenze (es. famiglie `llama-4-scout`, `llama-4-maverick`, nomi con
  `vision`/`vl`). Il criterio esatto lo fissa chi implementa dopo aver visto una risposta reale.
- Il modello scelto si salva e si riusa. L'elenco si richiede di nuovo solo: alla "Prova", se manca un
  modello salvato, o quando Groq risponde che il modello non esiste / è ritirato (404 o errore
  `model_decommissioned`/`model_not_found`). In quest'ultimo caso: nuovo elenco, nuovo modello
  (escludendo quello vecchio), **un solo** nuovo tentativo.
- **Nessun modello che legge immagini** nell'elenco: il piano non si ferma, Groq resta "al meglio".
  "Prova" mostra in rosso "Nessun modello Groq che legge immagini è disponibile per questa chiave"; il
  badge dice "nessun modello"; la scansione va direttamente all'OCR locale senza chiamare Groq, finché
  una nuova "Prova" non trova un modello. Se succede stabilmente, è il segnale per passare al progetto
  "OCR locale ragionato".

### Scansione

1. Se Groq è attivo, ha una chiave e non è in pausa: si mostra "Lettura con Groq…", si riduce
   l'immagine (`ridimensionaJpeg`), si fa **una** richiesta `POST /openai/v1/chat/completions` con le
   pagine come immagini base64 e il prompt di `promptScontrino` (riusato). Tempo massimo 30 s.
2. Risposta valida con almeno un prodotto → si usa quella (`normalizzaRispostaIA`, riusata).
3. Altrimenti (non configurato, in pausa, errore, tempo scaduto, nessun prodotto) → OCR locale come
   oggi, con un avviso che dice perché Groq non è stato usato.
4. Se le pagine (PDF multipagina) superano il numero di immagini ammesso da Groq, chi implementa
   decide se unirle in un'unica immagine o mandare solo le prime: da verificare sul limite reale.

### Chiamate di rete

Un helper nuovo, scritto da zero (non si riusa quello di Gemini): `fetch` con `AbortController` e
tempo massimo, che distingue tempo scaduto, errore di rete, risposta HTTP e corpo non JSON. Il service
worker lascia passare `api.groq.com` senza toccarlo. Il primo passo del piano è verificare nel browser
(dal telefono) che una chiamata a `/openai/v1/models` con la chiave risponda in pochi secondi: questo
esclude che l'attesa infinita vista con Gemini dipenda dall'app (service worker, CSP, helper).

### Errori di Groq

| Risposta | Cosa fa l'app |
|---|---|
| 401 / 403 | `chiaveNonValida = true` (vedi sopra); messaggio "Chiave Groq non valida o revocata: creane una nuova" + link. Il badge diventa rosso. |
| 404 / modello ritirato | Nuovo modello dall'elenco, un solo nuovo tentativo (vedi sopra). |
| 429 | Pausa per il tempo di `retry-after` (o dei header `x-ratelimit-reset-*`); se assente, 60 s. Se il messaggio indica un limite giornaliero, pausa fino al reset indicato. |
| 5xx, tempo scaduto, rete | Nessuna pausa; OCR locale per questo scontrino. |
| Risposta non interpretabile | OCR locale; il testo grezzo non si mostra all'utente oltre a un estratto breve. |

La logica di classificazione (`classificaErroreGroq(status, corpo, headers)` → `{tipo, pausaMs, messaggio}`)
sta in `logic.js` con i test.

### Casi di prova e statistiche

I casi di prova in IndexedDB restano. Le righe IA si salvano con `iaFonte: 'groq'` e `iaModello`.
I casi vecchi con `iaFonte: 'gemini'/'openrouter'` e `geminiRighe` restano leggibili (non si migrano).
Poiché l'OCR locale non gira più in parallelo con l'IA, il confronto "OCR vs IA" e `statisticheOcr`
si aggiornano solo con gli scontrini letti dall'OCR (*scelta di chi scrive il design*: far girare
Tesseract in parallelo sul telefono rallenta la scansione e non serve all'utente). Il riquadro di
confronto OCR/IA (`aggiornaConfrontoIA`, `#ocr-confronto`) si rimuove.

Se Groq fallisce e l'OCR locale non è caricato (offline al primo avvio), la scansione si ferma con un
messaggio che invita a inserire i prodotti a mano, come oggi.

## Cosa si cancella

- `logic.js`: `costruisciRichiestaGemini`, `normalizzaRispostaGemini`, `costruisciRichiestaOpenRouter`,
  `testoRispostaOpenRouter`, `scegliModelloOpenRouter`, `messaggioErroreOpenRouter`,
  `scegliModelloGemini`, `leggiLimiteGemini`, `improntaChiave`, `quotaModelloFinita`,
  `leggiEsclusiGemini`, `aggiungiEsclusoGemini`, `finePausaGemini`, `leggiPausaGemini`,
  `messaggioErroreGemini`, `conRagionamentoRidotto`, `erroreRagionamentoGemini`,
  `prossimaMezzanotteLosAngeles` (se non usata altrove) e i relativi test.
- `index.html`: i due riquadri Gemini/OpenRouter, `catenaIA`, `ATTESA_IA_DOPO_OCR_MS`, la gara in
  `gestisciFileOCR`, tutte le funzioni di chiamata/pausa/esclusi di Gemini e OpenRouter.
- `sw.js`: l'eccezione per `generativelanguage.googleapis.com` e `openrouter.ai` diventa per
  `api.groq.com`.
- CLAUDE.md: la sezione "Scontrini con IA" va riscritta per Groq.
- Si tengono: `promptScontrino`, `normalizzaRispostaIA`, `controlloTotale`, `sommaAttesaLettura`,
  `confrontaLetture`, `ridimensionaJpeg`, OCR locale, casi di prova.

## Lasciato a chi implementa

- Il criterio esatto per riconoscere i modelli Groq che leggono immagini (dopo una risposta reale di
  `/models`) e la lista di preferenze.
- Se usare la modalità JSON (`response_format`) di Groq con i modelli vision, se supportata.
- Come gestire PDF con più pagine del limite di immagini di Groq.
- Verificare nel browser che `api.groq.com` accetti chiamate dirette (CORS); se non le accetta, il
  piano si ferma e si torna dall'utente.
