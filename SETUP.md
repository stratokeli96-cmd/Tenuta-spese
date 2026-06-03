# Tenuta Spese — Setup desktop (v1)

Versione **desktop-only** basata su `piano_mensile_2.html` (single-file).
Niente PWA, niente sync GitHub, niente mobile. Apri il file in un browser desktop
e usa la funzione di export per salvare i dati come file JSON con timestamp.

## 1. Avvio

Apri `piano_mensile_2.html` con il tuo browser desktop (Chrome, Edge, Firefox).
Il layout è ottimizzato per schermi di larghezza ≥ 1280px.

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

- Il file `piano_mensile_2.html` è autosufficiente: non richiede server né
  dipendenze. Può essere copiato/spostato liberamente.
- I dati di lavoro persistono nel `localStorage` del browser. L'export è il
  meccanismo di backup/sincronizzazione tra macchine.
