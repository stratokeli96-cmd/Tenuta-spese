# Cosa devo fare — guida pratica passo-passo

Questa è la lista delle cose che devi fare **tu**, in ordine, per avere l'app
funzionante su iPhone e desktop con i dati sincronizzati.
(Per i dettagli tecnici di ogni passo vedi `SETUP.md`.)

Tempo totale: ~30 minuti. Non serve saper programmare: devi solo copiare/incollare.

---

## Livello 0 — Provarla subito, senza cloud (2 min)

Serve solo per vedere se gira. I dati restano sul singolo dispositivo, niente login.

- [ ] Apri un terminale nella cartella del progetto e lancia:
  ```bash
  python3 -m http.server 8080
  ```
- [ ] Vai su <http://localhost:8080/index.html> nel browser.
- [ ] In alto vedrai il pallino di stato su **"Solo locale"** → è normale a questo punto.

> Se vuoi solo provarla, puoi fermarti qui. Per averla su iPhone e sincronizzata,
> continua con i livelli sotto.

---

## Livello 1 — Creare il progetto Firebase (10 min) ⚠️ PASSO PIÙ IMPORTANTE

È il cuore: senza questo non c'è login né sincronizzazione tra dispositivi.

- [ ] Vai su <https://console.firebase.google.com> e accedi con il tuo Google.
- [ ] **Aggiungi progetto** → dagli un nome (es. `tenuta-spese`) → crea.
- [ ] Menu a sinistra → **Authentication** → *Get started*:
  - [ ] abilita **Google**
  - [ ] abilita **Email/Password**
- [ ] Menu a sinistra → **Firestore Database** → *Create database*:
  - [ ] modalità **Production**
  - [ ] region **europe-west** (più vicina all'Italia)
- [ ] Icona ingranaggio ⚙ in alto → **Project settings** → scorri fino a
  *"Le tue app"* → clicca l'icona **Web** `</>` → registra l'app.
- [ ] Ti compare un blocco `firebaseConfig = { ... }`: **lascialo aperto**, ti serve al prossimo passo.

---

## Livello 2 — Incollare la config nell'app (2 min)

- [ ] Apri il file **`js/firebase-config.js`**.
- [ ] Copia i valori dal blocco Firebase dentro le virgolette. Deve diventare così
  (con i TUOI valori al posto degli esempi):
  ```js
  export const firebaseConfig = {
    apiKey: "AIza...iltuovalore",
    authDomain: "tenuta-spese.firebaseapp.com",
    projectId: "tenuta-spese",
    storageBucket: "tenuta-spese.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:1234:web:abcd"
  };
  ```
- [ ] Salva. Ricarica <http://localhost:8080/index.html>: ora deve comparire il
  pulsante **Accedi / Sincronizza** e il pallino diventa **"Sincronizzato"** dopo il login.

> Questi valori NON sono segreti: possono stare nel codice. La sicurezza è data
> dalle regole Firestore (passo dopo) + dal login.

---

## Livello 3 — Pubblicare regole + mettere l'app online (10 min)

Serve per: (a) proteggere i dati, (b) avere un indirizzo `https://...` da aprire sull'iPhone.

- [ ] Installa lo strumento Firebase (una volta sola):
  ```bash
  npm install -g firebase-tools
  ```
- [ ] Accedi e collega il progetto:
  ```bash
  firebase login
  firebase use --add        # seleziona il progetto che hai creato
  ```
- [ ] Pubblica le regole di sicurezza e l'app:
  ```bash
  firebase deploy --only firestore:rules
  firebase deploy --only hosting
  ```
- [ ] Alla fine il terminale ti dà un indirizzo tipo
  **`https://tenuta-spese.web.app`** → questo è il link della tua app online.

---

## Livello 4 — Installarla sull'iPhone (2 min)

- [ ] Sull'iPhone apri quell'indirizzo `https://...web.app` **con Safari**
  (deve essere Safari, non Chrome).
- [ ] Tocca **Condividi** (il quadrato con la freccia) → **Aggiungi a Home**.
- [ ] Parte a tutto schermo come un'app vera, con la sua icona.
- [ ] Tocca **Accedi / Sincronizza** → Google o email.
- [ ] Da ora la **stessa cronologia** è identica su iPhone e desktop, in tempo reale.

---

## Fatto! Cosa succede dopo

- I dati stanno sul cloud (Firebase): cambi telefono e li ritrovi.
- Funziona **anche offline**: le modifiche si sincronizzano da sole al ritorno della rete.
- Al **primo login** i dati che avevi già in locale vengono caricati sul cloud automaticamente.
- Prima del primo accesso, per sicurezza, puoi fare
  **Impostazioni → Esporta backup** (scarica un JSON).

---

## Cose che NON devi fare ora (le rimandiamo)

- **Sign in with Apple** → richiede l'Apple Developer Program ($99/anno). Si aggiunge dopo.
- **App vera sull'App Store** → serve un Mac con Xcode. Lo scaffolding è già pronto
  (`capacitor.config.ts`), ma si fa più avanti. Dettagli in `SETUP.md` (sezioni 7 e 8).

---

## Se qualcosa non va

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Pallino sempre su "Solo locale" | config Firebase non compilata | ricontrolla `js/firebase-config.js` (apiKey e projectId pieni) |
| Pagina bianca aprendo il file | aperto con doppio click (`file://`) | usa `python3 -m http.server 8080` e apri `http://localhost:8080` |
| Login fallisce | provider non abilitato | Firebase → Authentication → abilita Google / Email-Password |
| "Aggiungi a Home" assente | non stai usando Safari | apri il link con **Safari**, non Chrome |
| `firebase: command not found` | strumento non installato | `npm install -g firebase-tools` |
