# Cosa devo fare — guida pratica passo-passo

Questa è la lista delle cose che devi fare **tu**, in ordine, per avere l'app
funzionante su iPhone e desktop con i dati sincronizzati.
(Per i dettagli tecnici di ogni passo vedi `SETUP.md`.)

Tempo totale: ~20 minuti. Non serve saper programmare: devi solo copiare/incollare.
Tutto è **gratis**: niente carta di credito, niente Google Cloud, niente Firebase.

---

## Livello 0 — Provarla subito, senza sync (2 min)

Serve solo per vedere se gira. I dati restano sul singolo dispositivo.

- [ ] Apri un terminale nella cartella del progetto e lancia:
  ```bash
  python3 -m http.server 8080
  ```
- [ ] Vai su <http://localhost:8080/index.html> nel browser.
- [ ] Il pallino di stato è su **"Solo locale"** → è normale a questo punto.

> Se vuoi solo provarla, puoi fermarti qui. Per averla su iPhone e sincronizzata,
> continua con i livelli sotto.

---

## Livello 1 — Creare il repository privato dei dati (5 min)

Qui verranno salvati i tuoi dati. È un repo **separato** da quello dell'app, e **privato**
(solo tu lo vedi).

- [ ] Vai su <https://github.com/new> (accedi col tuo account GitHub).
- [ ] Nome: es. `tenuta-spese-data`.
- [ ] Seleziona **Private**.
- [ ] Spunta **Add a README** (così il repo non è vuoto) → **Create repository**.
- [ ] Annota il nome completo nel formato `tuonome/tenuta-spese-data` (ti serve dopo).

---

## Livello 2 — Generare il token di accesso (5 min)

Il token permette all'app di leggere/scrivere SOLO in quel repo.

- [ ] Vai su <https://github.com/settings/personal-access-tokens/new>
  (Settings → Developer settings → **Fine-grained tokens** → *Generate new token*).
- [ ] **Token name**: es. `tenuta-spese`.
- [ ] **Expiration**: scegli una scadenza (es. 1 anno). ⚠️ alla scadenza dovrai rigenerarlo.
- [ ] **Repository access** → *Only select repositories* → scegli `tenuta-spese-data`.
- [ ] **Permissions** → *Repository permissions* → **Contents** → **Read and write**.
- [ ] **Generate token** → **copia subito** la stringa `github_pat_…` (non sarà più mostrata).

---

## Livello 3 — Incollare i dati nell'app (2 min)

- [ ] Apri l'app → **Impostazioni** → card **"Sincronizzazione (GitHub)"**.
- [ ] **Repository**: incolla `tuonome/tenuta-spese-data`.
- [ ] **Token**: incolla il `github_pat_…`.
- [ ] Premi **Salva e sincronizza** → il pallino diventa **"Sincronizzato"**.
- [ ] Premi **Sincronizza ora** per verificare: nel repo comparirà il file `tenuta-spese.json`.

> Il token resta solo nel browser di questo dispositivo (non finisce nel codice pubblico).
> Ripeterai questo passo una volta per ogni dispositivo.

---

## Livello 4 — Mettere l'app online (GitHub Pages, 5 min)

Serve per avere un indirizzo `https://...` da aprire sull'iPhone.

- [ ] Carica il codice dell'app sul suo repository GitHub (quello pubblico dell'app).
- [ ] Repo dell'app → **Settings** → **Pages** → *Build and deployment* → Source: **Deploy from a branch**
  → seleziona il branch e cartella **/ (root)** → **Save**.
- [ ] Dopo qualche minuto avrai un indirizzo tipo
  **`https://tuonome.github.io/tenuta-spese/`**.

---

## Livello 5 — Installarla sull'iPhone (2 min)

- [ ] Sull'iPhone apri quell'indirizzo `https://...github.io/...` **con Safari**
  (deve essere Safari, non Chrome).
- [ ] Tocca **Condividi** (il quadrato con la freccia) → **Aggiungi a Home**.
- [ ] Parte a tutto schermo come un'app vera, con la sua icona.
- [ ] Apri **Impostazioni** e incolla `repository` + `token` (come al Livello 3).
- [ ] Da ora la **stessa cronologia** è identica su iPhone e desktop.

---

## Fatto! Cosa succede dopo

- I dati stanno nel tuo repo privato: cambi telefono e li ritrovi.
- Ogni salvataggio è un **commit** → hai un **backup con cronologia** automatico.
- Funziona **anche offline**: le modifiche si sincronizzano da sole al ritorno della rete.
- La sincronizzazione tra dispositivi avviene a intervalli (~30s) e quando riapri l'app.

---

## Cose che NON devi fare ora (le rimandiamo)

- **App vera sull'App Store** → serve un Mac con Xcode. Lo scaffolding è già pronto
  (`capacitor.config.ts`), ma si fa più avanti. Dettagli in `SETUP.md`.

---

## Se qualcosa non va

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Pallino sempre su "Solo locale" | repo/token non inseriti | Impostazioni → compila Repository e Token |
| "Token non valido o permessi insufficienti" | token scaduto o senza Contents R/W | rigenera il token (Livello 2) |
| Pagina bianca aprendo il file | aperto con doppio click (`file://`) | usa `python3 -m http.server 8080` e apri `http://localhost:8080` |
| "Aggiungi a Home" assente | non stai usando Safari | apri il link con **Safari**, non Chrome |
| I dati non si allineano tra dispositivi | repo/token diversi | usa lo **stesso** `owner/repo` e un token valido su entrambi |
