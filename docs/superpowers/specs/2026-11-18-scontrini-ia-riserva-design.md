# Scontrini: Gemini riparato + OpenRouter come riserva — design

Data: 2026-11-18 · Stato: bozza da approvare

## Perché

La lettura degli scontrini con Gemini non funziona più: ogni giorno, alla prima scansione, l'app dice
"limite giornaliero" e blocca Gemini fino alla mezzanotte di Los Angeles. L'OCR locale (Tesseract)
che subentra legge male le righe: prende parole qualsiasi ("via") come prodotti e numeri a caso come
prezzi, e negli scontrini salvati finiscono importi assurdi.

Causa probabile (ipotesi, coerente con il sintomo e con le segnalazioni sul forum di Google):
il modello predefinito è l'alias `gemini-flash-latest`, che Google sposta sull'ultimo modello uscito.
Per molte chiavi gratuite il nuovo modello ha quota **0** → Google risponde 429 "limit: 0" →
`leggiLimiteGemini` lo classifica `tipo: 'zero'` → `finePausaGemini` mette in pausa **tutto Gemini**
fino a mezzanotte LA. Il giorno dopo si ripete. Il modello "rotto" non viene mai sostituito, perché
la sostituzione automatica scatta solo sul 404.

L'utente vuole: che gli scontrini vengano letti correttamente, gratis, senza dipendere da un solo
fornitore.

## Obiettivi

1. Gemini torna a funzionare quando la chiave ha almeno un modello gratuito: un "limite 0" porta a
   cambiare modello, non a fermarsi per un giorno.
2. Un secondo servizio gratuito, **OpenRouter** (modelli `:free` che leggono immagini), usato quando
   Gemini non è configurato, è in pausa o fallisce.
3. Prezzi assurdi non finiscono nei dati senza che l'utente se ne accorga: se la somma delle righe
   non coincide col totale stampato, lo si vede in modo evidente e si chiede conferma al salvataggio.

## Non obiettivi

- Migliorare il parser dell'OCR locale (`parseScontrino`): resta l'ultima risorsa così com'è.
- Servizi a pagamento o che richiedono carta di credito.
- Un server/proxy proprio: l'app resta statica su GitHub Pages, le chiamate partono dal browser.

## Anti-obiettivi (sarebbe un fallimento anche se "funziona")

- Bruciare la quota gratuita con raffiche di richieste (riserve in parallelo, tentativi in loop).
- Chiavi API nei backup, nello `stato`, negli URL o nei messaggi d'errore.
- La scansione che resta appesa ad aspettare un servizio remoto.
- Una pausa di un servizio che blocca anche l'altro.

## Vincoli (dal progetto)

- Tutto in `index.html` + logica pura in `logic.js` con test `node --test` (CLAUDE.md).
- Chiavi e modelli solo in `localStorage['tenuta-spese.ia']`; pausa per servizio in localStorage.
- Bump di `APP_VERSION` e `CACHE_VERSION` insieme.
- Valori da utente/rete in `innerHTML` sempre passati da `escapeHtml()`.
- OpenRouter piano gratuito: circa 50 richieste/giorno e 20/minuto senza crediti (da verificare
  sulla documentazione al momento dell'implementazione: i numeri cambiano). L'elenco dei modelli
  `:free` cambia spesso → il modello va scelto dall'elenco dell'API, non scritto nel codice.

## Approcci considerati

1. **Solo riparare Gemini** (limite 0 → cambio modello). Poco lavoro, ma resta un solo fornitore che
   cambia regole spesso.
2. **Riparare Gemini + OpenRouter di riserva** ← scelto dall'utente. Più lavoro e una seconda chiave,
   ma due fornitori indipendenti; l'OCR locale resta l'ultima risorsa.
3. **Solo migliorare l'OCR locale.** Gratis e offline, ma non raggiungerà mai la qualità di un modello
   che guarda l'immagine: gli errori segnalati sono proprio il suo limite.

## Design

### 1. Gemini: quota del modello finita = cambia modello

Le quote gratuite di Gemini sono **per modello**. Non sappiamo con certezza se l'utente riceve
"limite 0" (`tipo:'zero'`) o "quota giornaliera esaurita" (`tipo:'giorno'`); il design copre entrambi
(*scelta del builder-check: robusto a tutte e due le cause*).

- Un 429 `zero` o `giorno` non mette più in pausa tutto Gemini. Il modello va nella lista dei
  **modelli esclusi** (localStorage, solo dispositivo) **fino alla prossima mezzanotte di Los
  Angeles** (quando Google azzera le quote): così un modello che torna gratuito viene ripreso da
  solo. La lista si azzera anche se cambia la chiave.
- Si sceglie un sostituto con `scegliModelloGemini(elenco, esclusi)`, lo si prova con **una**
  richiesta, e se funziona lo si salva e lo si comunica con un toast (come oggi per il 404).
- Se non resta nessun modello utilizzabile, o anche il sostituto dà 429: solo allora pausa di Gemini
  fino a mezzanotte LA, con messaggio "nessun modello gratuito disponibile per questa chiave oggi".
- Il 429 `minuto` resta com'è (pausa breve indicata da Google).
- `scegliModelloGemini`: preferire i flash **stabili** con numero di versione (`gemini-2.5-flash`…)
  all'alias `gemini-flash-latest`; poi i flash-lite stabili; mai preview/exp.
  `IA_MODELLO_DEFAULT` diventa un flash stabile. Chi ha già `gemini-flash-latest` salvato non viene
  toccato finché non riceve un 429 di quota.
- Per scansione al massimo: 1 richiesta + (solo su 404 o 429 di quota) 1 `models.list` + 1 richiesta
  sul sostituto. Mai più di così.
- La pausa riguarda solo Gemini, mai OpenRouter.
- "Prova la connessione" in Impostazioni segue la stessa regola e mostra sempre il modello in uso e
  l'eventuale lista di modelli esclusi oggi.
- Il messaggio d'errore mostrato all'utente riporta sempre il tipo di limite e il modello, così la
  causa vera resta visibile.

### 2. OpenRouter come secondo servizio

- Endpoint OpenAI-compatibile `POST https://openrouter.ai/api/v1/chat/completions`, chiave
  nell'header `Authorization: Bearer …` (mai nell'URL). Immagini come `image_url` con data URL JPEG
  ridotto (stesso `ridimensionaJpeg`).
- Stesso prompt di Gemini (estratto in una funzione comune in `logic.js`), risposta chiesta in JSON;
  `response_format` JSON solo se il modello lo dichiara supportato (`supported_parameters`),
  altrimenti solo prompt. La risposta passa dalla stessa normalizzazione/validazione di Gemini
  (`normalizzaRispostaGemini` generalizzata con il nome del servizio nei messaggi).
- Modello: scelto da `GET /api/v1/models` filtrando immagine in ingresso, prezzo 0 e id `:free`
  (funzione pura `scegliModelloOpenRouter` in `logic.js`, con test). Un 404/"no endpoints"
  → si riesegue la scelta escludendo il modello rotto (stessa logica di Gemini).
- 429 di OpenRouter → pausa propria (`tenuta-spese.ia-pausa-openrouter`), che non tocca Gemini.
- Errori leggibili in italiano, senza mai la chiave (`messaggioErroreOpenRouter`).

### 3. Ordine e tempi della scansione

Sequenza, mai in parallelo tra servizi remoti:
**Gemini** (se attivo, con chiave e non in pausa) → se fallisce o è in pausa → **OpenRouter** (se
attivo, con chiave e non in pausa) → se fallisce → **OCR locale**.
L'OCR locale continua a girare in parallelo da subito (serve per il confronto e come riserva).
La regola "non restare appesi" vale per l'intera catena remota: finito l'OCR locale, si concedono
`ATTESA_GEMINI_DOPO_OCR_MS` (rinominabile in `ATTESA_IA_DOPO_OCR_MS`) alla catena e poi si prosegue
con l'OCR. Se l'OCR non è disponibile si aspetta la catena fino in fondo.
*Scelte del builder-check:*
- Il timeout per singola richiesta remota nella catena scende a 25 s (oggi 40 s), così un Gemini
  lento lascia spazio a OpenRouter quando l'OCR non è disponibile.
- Quando la finestra di attesa è scaduta e si è già mostrato il risultato dell'OCR, la richiesta già
  partita può finire in background (la sua lettura va nel caso di prova, come oggi), ma **non si
  avvia** il servizio successivo: nessuna quota spesa per un risultato che nessuno userà.
Il messaggio nella preview dice chi ha letto lo scontrino e, se c'è stato un ripiego, perché
("Gemini in pausa fino alle …, letto con OpenRouter").

### 4. Controllo sul totale

Già oggi il salvataggio chiede conferma quando la somma delle righe non torna con il totale letto
(`index.html`, salvataggio scontrino). Le cifre assurde passano quando il totale stampato **non**
viene letto (nessun confronto possibile) o quando la conferma si accetta senza accorgersene. Quindi:

- Se `totaleRiportato` esiste e differisce dalla somma delle righe di più di 0,01 €, la preview
  mostra un avviso **rosso** in cima con le due cifre e la differenza; il totale nella preview è
  evidenziato.
- La conferma al salvataggio esistente resta, per qualsiasi fonte (Gemini, OpenRouter, OCR).
- Se il totale stampato non è stato letto: avviso giallo in cima alla preview "totale non letto,
  controlla le righe" e **anche in questo caso** una conferma al salvataggio che mostra la somma
  delle righe ("Il totale dello scontrino non è stato letto: la somma dei prodotti è X €. È
  giusta?"). *Scelta del builder-check.*

### 5. Impostazioni

La sezione diventa "IA per gli scontrini" con due blocchi uguali per struttura:
Gemini (com'è oggi) e OpenRouter (attiva, chiave, modello + "Cerca modello", "Prova la
connessione"), più una riga di stato per servizio (attivo / in pausa fino alle … / non configurato).
Avviso privacy per OpenRouter: la foto va a OpenRouter e al fornitore del modello gratuito, che può
usarla per migliorare i suoi servizi.

```
IA per gli scontrini
 ─ Gemini (Google) ─────────────── ● attivo · gemini-2.5-flash
   [x] usa  Chiave [••••••]  Modello [gemini-2.5-flash] [Cerca] [Prova]
 ─ OpenRouter (riserva) ────────── ● non configurato
   [ ] usa  Chiave [        ]  Modello [          ] [Cerca] [Prova]
 Ordine: Gemini → OpenRouter → OCR del telefono
```

### 6. Casi di prova

Il caso salvato registra quale servizio ha letto lo scontrino. I campi esistenti `geminiRighe`/
`geminiTotale`/`usoGemini` restano per compatibilità con i casi già salvati; si aggiungono
`iaFonte` (`'gemini'|'openrouter'|null`) e l'eventuale modello usato.

## Lasciato al builder

- Nomi esatti delle nuove funzioni e la forma della lista di modelli esclusi in localStorage.
- Come generalizzare la normalizzazione (parametro, wrapper) senza rompere i test esistenti.
- Il dettaglio CSS dei due blocchi in Impostazioni (seguire i token e le convenzioni mobile).
- Verificare dalla documentazione di OpenRouter, prima di scrivere il client: chiamate dal browser
  (CORS), header consigliati (`HTTP-Referer`/`X-Title`), forma del 429 e dei limiti gratuiti.
  Se le chiamate dal browser non fossero permesse, fermarsi e tornare dall'utente.
- Test: nuove funzioni pure in `logic.js` con test in `tests/logic.test.js`; fixture finte.
