# Smart Finance — Setup PWA + sync su repo GitHub

App PWA single-codebase: gira su **web/desktop** e si installa su **iPhone**
("Aggiungi a Home"), con **dati sincronizzati su un repository GitHub privato** e
**funzionamento offline** (le modifiche fatte senza rete vengono inviate al ritorno online).
Tutto **gratis**: niente Google Cloud, niente Firebase, niente carta di credito.

```
index.html              ← la PWA
css/styles.css
js/app.js               ← logica app (UI, grafici, OCR)
js/store.js             ← persistenza offline-first + sync via API GitHub
sw.js                   ← service worker (offline)
manifest.webmanifest    ← installabilità PWA
icons/                  ← icone app
capacitor.config.ts     ← scaffolding iOS (per il futuro, non usato dalla PWA)
piano_mensile_2.html    ← versione legacy single-file (riferimento, non usata dalla PWA)
```

---

## 1. Provare subito in locale (senza sync)

I service worker e gli ES module **non funzionano aprendo il file con `file://`**:
serve un piccolo server HTTP. Dalla cartella del progetto:

```bash
python3 -m http.server 8080
# poi apri http://localhost:8080/index.html
```

Senza configurazione l'app funziona comunque, **solo in locale** (localStorage):
nessuna sincronizzazione. Il pallino di stato mostra "Solo locale".

---

## 2. Come funziona la sincronizzazione

I dati sono un singolo file JSON in un **repo GitHub privato**, letto/scritto dal client
tramite l'**API Contents di GitHub**. Schema del file (`tenuta-spese.json`):

```json
{ "stato": { ...stato app... }, "updatedAt": 1716000000000 }
```

- **Salvataggio**: ogni modifica → subito in localStorage; un PUT *debounced* (~1.5s) crea un
  commit nel repo. La cronologia git è quindi anche il tuo **backup versionato**.
- **Caricamento**: all'avvio e in polling (~30s, più al focus/visibilità) l'app fa un GET; se la
  versione remota è più recente (`updatedAt`), la applica.
- **Conflitti**: *last-write-wins*. Lo `sha` del file fa da controllo di concorrenza: se due
  dispositivi scrivono insieme, il secondo PUT gestisce il `409` rinfrescando lo `sha` e ritentando.
- **Offline**: se il PUT fallisce, la modifica resta in coda (pill "Offline (in coda)") e parte al
  ritorno della rete.

Limite richieste API GitHub: **5000/ora** autenticato; il polling ne usa ~120/ora.

---

## 3. Creare repo privato + token (una volta sola)

1. Crea un **repository privato** per i dati: <https://github.com/new> → nome es.
   `tenuta-spese-data` → **Private** → *Add a README* → **Create repository**.
2. Genera un **fine-grained token**:
   <https://github.com/settings/personal-access-tokens/new>
   - *Repository access* → **Only select repositories** → scegli `tenuta-spese-data`;
   - *Permissions* → *Repository permissions* → **Contents: Read and write**;
   - imposta una **Expiration** (i token scadono: rigenerali alla scadenza);
   - **Generate token** → copia la stringa `github_pat_…`.
3. Nell'app → **Impostazioni** → **Sincronizzazione (GitHub)**:
   - **Repository**: `tuonome/tenuta-spese-data`;
   - **Token**: il `github_pat_…`;
   - **Salva e sincronizza** → poi **Sincronizza ora** per verificare.

> Sicurezza: il token vive **solo nel localStorage del browser** in cui lo inserisci — non finisce
> nel codice pubblicato su Pages. Essendo fine-grained e limitato a un solo repo privato, il danno
> in caso di compromissione è circoscritto a quel repo di dati.

---

## 4. Pubblicare l'app (GitHub Pages)

1. Carica il codice dell'app sul suo repository su GitHub.
2. Repo → **Settings** → **Pages** → *Deploy from a branch* → branch + cartella **/ (root)** → Save.
3. Ottieni un URL tipo `https://tuonome.github.io/tenuta-spese/`.

> I path nell'app sono relativi (`./…`), quindi funziona anche sotto il sottopercorso `/<repo>/` di Pages.
> Tieni il repo dei **dati** privato; il repo dell'**app** può essere pubblico (non contiene dati né token).

---

## 5. Installare sull'iPhone

1. Apri l'URL Pages in **Safari** sull'iPhone.
2. Tocca **Condividi** → **Aggiungi a Home**.
3. L'app parte a tutto schermo come un'app nativa, con la sua icona.
4. Apri **Impostazioni** e incolla `repository` + `token` (come al punto 3): da quel momento la
   **stessa cronologia** è allineata tra iPhone, desktop e web.

---

## 6. Offline & stato

- localStorage è la verità locale: l'app parte e funziona anche senza rete.
- Le modifiche offline vengono inviate appena torna la connessione.
- Il pallino di stato indica: *Solo locale / Sincronizzo / Sincronizzato / Offline (in coda) / Errore sync*.

## 7. App nativa iOS / App Store (in seguito, serve un Mac)

Lo scaffolding è già pronto (`capacitor.config.ts`). Su un **Mac con Xcode**:
```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init "Smart Finance" "com.tuonome.smartfinance" --web-dir=.
npx cap add ios
npx cap copy
npx cap open ios     # build/firma in Xcode → TestFlight / App Store
```
L'OCR (Tesseract.js) e la sync via fetch funzionano dentro il webview Capacitor come nel browser.

---

## Nota tecnica: modello dati

Lo stato è salvato come **file JSON singolo** (`{ stato, updatedAt }`): scelta voluta per un'app a
utente singolo con volumi modesti — è atomica e semplice. Se un domani i dati crescessero
enormemente, conviene spezzare il file o passare a uno storage con scritture granulari; la logica in
`store.js` è isolata per renderlo agevole.
