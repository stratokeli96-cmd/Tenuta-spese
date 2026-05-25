# Smart Finance — Setup PWA + Firebase

App PWA single-codebase: gira su **web/desktop** e si installa su **iPhone**
("Aggiungi a Home"), con **dati centralizzati su Firebase** e **funzionamento
offline** (le modifiche fatte senza rete vengono sincronizzate al ritorno online).

```
index.html              ← la PWA
css/styles.css
js/app.js               ← logica app (UI, grafici, OCR)
js/store.js             ← persistenza offline-first + sync Firestore
js/firebase-config.js   ← ⚠️ DA COMPILARE con la tua config Firebase
sw.js                   ← service worker (offline)
manifest.webmanifest    ← installabilità PWA
icons/                  ← icone app
firebase.json / firestore.rules / firestore.indexes.json
piano_mensile_2.html    ← versione legacy single-file (riferimento, non usata dalla PWA)
```

---

## 1. Provare subito in locale (senza cloud)

I service worker e gli ES module **non funzionano aprendo il file con `file://`**:
serve un piccolo server HTTP. Dalla cartella del progetto:

```bash
python3 -m http.server 8080
# poi apri http://localhost:8080/index.html
```

Senza config Firebase l'app funziona comunque, **solo in locale** (localStorage):
nessun login, nessuna sincronizzazione. Il pallino di stato mostra "Solo locale".

---

## 2. Creare il progetto Firebase (sync cloud + login)

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto**.
2. **Authentication** → *Get started* → scheda **Sign-in method**:
   - abilita **Google**;
   - abilita **Email/Password**.
3. **Firestore Database** → *Create database* → modalità **Production** → scegli una region (es. `europe-west`).
4. **Project settings** (⚙) → sezione *Le tue app* → icona **Web** (`</>`) → registra l'app →
   copia l'oggetto `firebaseConfig`.
5. Incolla quei valori in **`js/firebase-config.js`**:
   ```js
   export const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "tuo-progetto.firebaseapp.com",
     projectId: "tuo-progetto",
     storageBucket: "tuo-progetto.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:1234:web:abcd"
   };
   ```
   > Questi valori **non sono segreti**: la sicurezza è data dalle regole Firestore + auth.
   Appena compilati, l'app abilita automaticamente login e sync.

---

## 3. Pubblicare regole di sicurezza e deploy (Firebase CLI)

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # seleziona il tuo progetto
firebase deploy --only firestore:rules   # carica firestore.rules
firebase deploy --only hosting           # pubblica la PWA (URL https://...web.app)
```

Le regole (`firestore.rules`) garantiscono che **ogni utente veda solo i propri dati**
(`users/{uid}/...`). Nessun accesso ai dati altrui, nessun accesso anonimo.

---

## 4. Installare sull'iPhone

1. Apri l'URL Hosting (`https://tuo-progetto.web.app`) in **Safari** sull'iPhone.
2. Tocca **Condividi** → **Aggiungi a Home**.
3. L'app parte a tutto schermo come un'app nativa, con la sua icona.
4. Tocca **Accedi / Sincronizza** → Google o email: da quel momento la **stessa
   cronologia** è identica su iPhone, desktop e web.

> La stessa cosa vale su desktop/web: stesso URL, stesso login, dati allineati in tempo reale.

---

## 5. Offline & sincronizzazione

- Firestore tiene una **cache locale (IndexedDB)**: l'app funziona anche senza rete.
- Le modifiche offline vengono **messe in coda** e inviate appena torna la connessione.
- `onSnapshot` aggiorna in **tempo reale** tutti i dispositivi collegati allo stesso account.
- Il pallino di stato indica: *Solo locale / Sincronizzo / Sincronizzato / Offline (in coda)*.

## 6. Migrazione dei dati esistenti

Al **primo login** su un account vuoto, i dati già presenti in locale (incluso un
eventuale backup importato, es. *Mag 2026*) vengono **caricati automaticamente** sul cloud.
Se l'account contiene già dati, vince la versione cloud (è la fonte di verità una volta loggati).
Per sicurezza puoi sempre esportare un backup JSON da **Impostazioni → Esporta backup** prima di accedere.

---

## 7. Sign in with Apple (in seguito)

Richiede un **Apple Developer Program** ($99/anno). Quando lo attivi:
1. crea un *Service ID* e una *Key* per "Sign in with Apple" nel portale Apple Developer;
2. in Firebase Authentication abilita il provider **Apple** e incolla i dati;
3. aggiungi il pulsante nel modale di login (poche righe, simmetrico a Google).

È comunque **obbligatorio per l'App Store** se offri altri social login, quindi va fatto
insieme al passaggio Capacitor qui sotto.

## 8. App nativa iOS / App Store (in seguito, serve un Mac)

Lo scaffolding è già pronto (`capacitor.config.ts`). Su un **Mac con Xcode**:
```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Smart Finance" "com.tuonome.smartfinance" --web-dir=.
npx cap add ios
npx cap copy
npx cap open ios     # build/firma in Xcode → TestFlight / App Store
```
L'OCR (Tesseract.js) e Firebase funzionano dentro il webview Capacitor come nel browser.

---

## Nota tecnica: modello dati

Lo stato è salvato come **documento singolo** `users/{uid}/data/state` (scelta voluta per
un'app a utente singolo con volumi modesti: è atomica e semplice). Se un domani i dati
crescessero enormemente (decine di migliaia di movimenti), conviene passare a **collezioni**
(`movimenti`, `scontrini`, `righeProdotto` separate) per scritture granulari; la struttura
del codice in `store.js` è già isolata per renderlo agevole.
