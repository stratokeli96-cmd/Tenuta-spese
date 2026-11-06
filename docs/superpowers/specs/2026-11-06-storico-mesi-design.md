# Storico mesi persistente (sotto-progetto C)

## Obiettivo
Conservare il dettaglio di **tutti** i mesi chiusi (movimenti e scontrini) senza saturare `localStorage` (~5 MB), per permettere analisi su molti mesi. Il backup completo resta un singolo file JSON da salvare su Drive/iCloud.

## Decisioni (concordate con l'utente)
- Archivio sul telefono in **IndexedDB** + file di export completo su Drive. Nessun servizio esterno.
- Il **mese corrente resta in `localStorage`** (sincrono, invariato). Solo i mesi chiusi vanno in IndexedDB.
- Nessuna riscrittura asincrona dell'app.

## Modello dati
- `stato.archivioMesi[]` in localStorage diventa **leggero**: `{id, mese, reddito, spesoNeeds, spesoWants, versatoSavings, avanzoTotale, nMovimenti, nScontrini}`.
- IndexedDB `tenuta-spese` / store `mesi`: record completo `{id, mese, ..., movimenti[], scontrini[]}`.
- Store `mesi_prima_import`: copia di sicurezza di `mesi` prima di ogni import.
- Il **file di export** ha lo stesso schema di prima (archivioMesi con movimenti/scontrini): compatibile con i backup esistenti.

## Flussi
- **Chiusura mese:** il record completo va prima in localStorage (nessuna perdita se l'app si chiude), poi in IndexedDB; a scrittura riuscita il dettaglio viene tolto da localStorage.
- **Migrazione:** all'avvio i mesi che hanno ancora il dettaglio in localStorage vengono copiati in IndexedDB e poi alleggeriti.
- **Export:** ricompone lo stato completo leggendo IndexedDB. Pulsante "Condividi" (Drive/File) con fallback al download.
- **Import:** valida, copia lo storico attuale in `mesi_prima_import`, sostituisce `mesi`, alleggerisce lo stato.
- **Reset totale:** svuota anche IndexedDB.
- **Se IndexedDB non è disponibile:** si resta nel comportamento precedente (dettaglio in localStorage).
- **UI:** dalla tabella dei mesi archiviati si apre il dettaglio (sola lettura) e si può confrontare due mesi.

## Logica pura testata (`logic.js`)
`separaArchivio`, `ricomponiArchivio`, `confrontaMesi`, assegnazione degli `id` ai mesi.

## Rischi
Se il browser cancella IndexedDB l'unica copia è il file su Drive: restano `storage.persist()` e il promemoria backup.
