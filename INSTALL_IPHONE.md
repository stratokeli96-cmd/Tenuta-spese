# Tenuta Spese — Installazione su iPhone (PWA)

Questa app si installa sull'iPhone come una **vera app**: si avvia dalla Home a
schermo intero (senza la barra degli indirizzi di Safari) e **funziona offline**.
È una *PWA* (Progressive Web App): nessun App Store, nessun costo, nessun account
sviluppatore. I tuoi dati restano **solo sul telefono** (in `localStorage`).

---

## 1. Pubblicazione su GitHub Pages (una volta sola)

La app va servita via HTTPS perché il funzionamento offline (service worker)
lo richiede. GitHub Pages lo fa gratis.

1. Vai sul repository su GitHub → **Settings** → **Pages**.
2. In **Source** scegli **Deploy from a branch**.
3. Seleziona il branch **`Tenuta-spese-telefono`** e la cartella **`/ (root)`**.
4. **Save**. Dopo 1–2 minuti la app sarà online a un indirizzo tipo:

   ```
   https://stratokeli96-cmd.github.io/tenuta-spese/index.html
   ```

> GitHub Pages serve **solo i file della app** (HTML/CSS/JS statici).
> Non riceve né memorizza i tuoi dati: quelli restano nel browser del telefono.

---

## 2. Installazione sull'iPhone

> ⚠️ **Usa Safari.** Su iOS solo Safari può installare una PWA — Chrome/Firefox no.

1. Apri l'indirizzo GitHub Pages **in Safari**.
2. Tocca il pulsante **Condividi** (il quadrato con la freccia in alto ↑).
3. Scorri e tocca **«Aggiungi a Home»** (*Add to Home Screen*).
4. Conferma con **Aggiungi**.
5. Sulla Home compare l'icona **Tenuta Spese** (€ oro su sfondo scuro).

Avviando l'app dall'icona parte a **schermo intero**, senza barra indirizzi.

---

## 3. Far funzionare l'app offline

- Al **primo avvio tieni la rete attiva** per qualche secondo: il service worker
  scarica e mette in cache la app e le librerie (grafici, font, OCR).
- Dopo, la app si apre e funziona **anche in modalità aereo**.
- L'**OCR degli scontrini** si attiva offline **dopo averlo usato una volta
  online** (la prima volta scarica il motore di riconoscimento e il dizionario
  italiano, poi resta in cache).

---

## 4. Backup dei dati (importante)

iOS può cancellare i dati delle PWA non aperte per **circa 7 giorni**. I dati non
sono sincronizzati su alcun server, quindi **fai backup periodici**:

- Nell'app → **Impostazioni** → **Esporta JSON** → salva il file (es. su iCloud Drive
  tramite il foglio di condivisione).
- Per ripristinare: **Impostazioni** → **Importa JSON**.

Esporta dopo ogni sessione importante e prima di lunghi periodi senza usare l'app.

---

## 5. Aggiornamenti

Quando il branch `Tenuta-spese-telefono` viene aggiornato su GitHub, GitHub Pages
ripubblica automaticamente. La app sul telefono prende la nuova versione al primo
avvio **con rete attiva** (il service worker aggiorna la cache in background).

---

## Risoluzione problemi

| Problema | Causa / soluzione |
|---|---|
| Non vedo «Aggiungi a Home» | Stai usando Chrome/Firefox: apri il link **in Safari**. |
| Non funziona offline | Apri l'app **una volta con la rete attiva** per popolare la cache. |
| L'OCR non parte offline | Va usato **una volta online** per scaricare il motore Tesseract. |
| Dati spariti | iOS ha ripulito lo storage: ripristina con **Importa JSON** dal backup. |
| Si apre con la barra di Safari | Avviala dall'**icona sulla Home**, non dal link in Safari. |
