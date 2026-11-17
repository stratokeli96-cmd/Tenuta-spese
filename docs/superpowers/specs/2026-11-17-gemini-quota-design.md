# Gemini rispettoso dei limiti gratuiti — design breve

Data: 2026-11-17 · Dimensione: modifica piccola

## Perché

La lettura degli scontrini con Gemini funzionava perfettamente, poi ha iniziato a fallire
(timeout, "temporaneamente non disponibile", "quota esaurita"). Google ha spostato
`gemini-flash-latest` sulla generazione 3 (più lenta, molto richiesta, servita per ultima sul
piano gratuito) e ha ritirato `gemini-2.5-flash` per i nuovi utenti. Le correzioni del 17/11
(#19, #21, #23, 94d62e0) reagivano ai guasti provando altri modelli **in parallelo** (fino a 6
richieste per una prova, fino a 5 foto per una scansione): con la quota al limite questo la
consumava ancora di più. La quota gratuita conta soprattutto il **numero di richieste** (al minuto
e al giorno), non il peso della foto.

Obiettivo: Gemini resta gratuito e fa il meno richieste possibile; quando Google dice "basta"
l'app smette di chiedere fino all'azzeramento, lo dice chiaramente e usa l'OCR locale.

## Obiettivi

- Al massimo **una richiesta** a Gemini per scansione (due solo se il modello è stato ritirato:
  elenco modelli + nuovo tentativo).
- **Pausa automatica** dopo un errore di quota (429): nessuna richiesta finché la quota non si
  azzera. Durante la pausa la scansione usa subito l'OCR locale, senza attese.
- **Errore completo**: dal 429 si legge e si mostra quale limite è stato superato (al minuto, al
  giorno, "limite 0" = modello non incluso nel piano gratuito) e fino a quando dura la pausa.
- Resta l'**aggiornamento automatico del modello** quando Google lo ritira (404): si sceglie quello
  giusto dall'elenco e si salva.
- Modello predefinito: `gemini-flash-latest` (oggi `gemini-2.5-flash`, ritirato per i nuovi utenti).

## Non obiettivi

- Altri servizi (Groq ecc.) come riserva: eventuale passo successivo (strada 3), solo se Gemini
  continua a fermarsi spesso.
- Mandare a Gemini solo il testo dell'OCR (perde la precisione della lettura dalla foto).

## Anti-obiettivi

- Qualsiasi automatismo che mandi più di 2 richieste per un'azione dell'utente.
- Pausa o chiave dentro `stato` o nei backup.

## Approcci considerati

1. **Solo Gemini, rispettoso dei limiti** — scelto dall'utente. Lavoro piccolo, nessuna chiave nuova.
2. Passare tutto a Groq — stessi tipi di limiti e ritiri di modelli; qualità di lettura da verificare.
3. Gemini principale + Groq di riserva — più robusto, ma seconda chiave e più lavoro; si valuta dopo
   la 1.

## Comportamento

**Scansione (`analizzaConGemini`)**
- In pausa → nessuna richiesta; avviso "Gemini in pausa fino alle HH:MM (motivo): uso l'OCR locale".
- 404 → elenco modelli, `scegliModelloGemini`, un solo nuovo tentativo; se riesce si salva il modello.
- 429 → si registra la pausa, OCR locale.
- Timeout o 5xx → nessun altro modello: OCR locale (alla prossima scansione si riprova normalmente).

**"Prova la connessione"**
- In pausa → nessuna richiesta; mostra motivo e fine della pausa.
- Una sola richiesta. 404 come sopra. 429 → pausa e messaggio completo. Timeout/5xx → "Gemini ora
  è lento o sovraccarico: riprova tra qualche minuto" (nessuna raffica di modelli).

**Pausa**
- Salvata in `localStorage['tenuta-spese.ia-pausa']` = `{ fino, motivo }` (solo dispositivo).
- Durata: dal 429 di Google — limite al minuto → il `retryDelay` indicato (o 60 s se manca);
  limite al giorno o "limite 0" → fino alla prossima mezzanotte del Pacifico (quando Google azzera
  le quote giornaliere; in Italia le 9:00, o le 8:00 nelle settimane di cambio ora sfasato);
  non riconosciuto → 60 s.
- Si annulla quando scade, o quando si salvano chiave o modello diversi.

## Dove va il codice

- `logic.js` (puro, con test): lettura del 429 (`leggiLimiteGemini`: tipo, limite, modello, attesa
  da `details`/`RetryInfo` e dal testo), calcolo della fine pausa (`finePausaGemini`, mezzanotte
  `America/Los_Angeles` via `Intl`), `messaggioErroreGemini` per il 429 con il dettaglio.
- `index.html`: `richiestaGemini` conserva il corpo dell'errore; scansione e prova come sopra;
  pausa letta/scritta in localStorage.
- Si eliminano le raffiche: `cercaModelloCheRisponde`, `alternativeGemini` (e i suoi test), il ramo
  "alternative" di `correggiModelloGemini`.
- `CLAUDE.md`: riga sugli scontrini con Gemini aggiornata. Versione app + `CACHE_VERSION`.

## Scelte mie (correggibili)

- **Foto più leggera: non la faccio.** La quota conta le richieste, non i pixel; abbassare la
  risoluzione rischia di far sbagliare le scritte piccole degli scontrini, e i timeout visti non
  dipendevano dall'invio della foto.
- Su timeout/5xx nessun nuovo tentativo automatico: oggi tutti i modelli alternativi fallivano
  insieme, quindi riprovare costa richieste senza beneficio.

## Lasciato a chi implementa

- Testo esatto degli avvisi; formato dell'ora (HH:MM locale).

## Coordinamento

Un'altra sessione Claude ha pubblicato modifiche sullo stesso codice (94d62e0). Va fermata prima
di implementare, altrimenti le due versioni si sovrascrivono.
