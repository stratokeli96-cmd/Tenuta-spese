# Tenuta Spese — Setup desktop (v1)

App single-file basata su `index.html`. Apri il file in un browser desktop
e usa la funzione di export per salvare i dati come file JSON con timestamp.

> 📱 **Vuoi usarla come app sull'iPhone?** Vedi [`INSTALL_IPHONE.md`](INSTALL_IPHONE.md):
> la app è installabile come PWA (avvio a schermo intero dalla Home, offline).

## 1. Avvio

Apri `index.html` con il tuo browser desktop (Chrome, Edge, Firefox).
Il layout è ottimizzato per schermi di larghezza ≥ 1280px; su mobile è disponibile
un layout responsive a colonna singola.

## 2. Salvataggio dei dati su Google Drive

L'app salva i dati come file JSON con nome `dati_DD-MM-YYYY_HH-MM.json`
(es. `dati_03-06-2026_11-30.json`) tramite il normale download del browser.

Per far finire il file direttamente nel tuo Google Drive senza passaggi manuali:

### a) Installa Google Drive per desktop

1. Scarica e installa **Google Drive per desktop**: <https://www.google.com/drive/download/>
2. Esegui il login con il tuo account Google.
3. Drive crea una unità sincronizzata (es. `G:\Il mio Drive\` su Windows,
   `~/Google Drive/` su macOS). Tutto ciò che metti lì viene caricato sul cloud.

### b) Crea una cartella dedicata

Dentro la cartella sincronizzata crea `Tenuta-spese\` (o il nome che preferisci).

### c) Imposta il browser per scaricare lì

**Chrome / Edge**:
- Impostazioni → *Download*
- *Posizione*: imposta `G:\Il mio Drive\Tenuta-spese\` (o l'equivalente macOS).
- Disattiva *"Chiedi dove salvare ogni file prima di scaricarlo"* per evitare la
  finestra di dialogo a ogni export.

**Firefox**:
- Impostazioni → *File e applicazioni* → *Download*
- *Salva i file in*: imposta la cartella Drive sincronizzata.

### d) Esporta

Nell'app → *Impostazioni* → *Esporta JSON*. Il file viene scaricato direttamente
nella cartella Drive e dopo qualche secondo è disponibile sul cloud.

## 3. Ripristino dati

*Impostazioni* → *Importa JSON* → seleziona un file precedentemente esportato.

## Note

- L'app richiede `index.html`, `logic.js`, `sw.js`, `manifest.json` e `icons/`
  (non solo `index.html`). Al **primo avvio serve la rete**: Chart.js, OCR (Tesseract
  + dati italiano) e pdf.js si scaricano da CDN e poi restano in cache per l'uso offline.
- Per avviare via PWA/service worker serve un server (`python3 -m http.server`) o
  GitHub Pages; aprendo il file con `file://` l'app funziona ma senza service worker.
- Dalla Dashboard compare un promemoria se l'ultimo backup JSON ha più di 14 giorni.
- I dati di lavoro persistono nel `localStorage` del browser. L'export è il
  meccanismo di backup/sincronizzazione tra macchine.
