// ============================================================
//  STORE — layer di persistenza offline-first
//
//  - Salva sempre in localStorage (avvio istantaneo + fallback senza login).
//  - Se Firebase è configurato e l'utente è loggato, sincronizza lo stato
//    su Firestore in un singolo documento users/{uid}/data/state.
//  - Firestore con persistenza IndexedDB gestisce l'offline: le scritture
//    fatte senza rete vengono messe in coda e inviate al ritorno online.
//  - onSnapshot tiene allineati in tempo reale tutti i dispositivi.
//
//  Modello a documento singolo (non collezioni): scelta deliberata per
//  un'app a utente singolo con volumi di dati modesti. È atomico, semplice
//  e privo di stati di sync parziali. Se un giorno i dati crescessero molto
//  (decine di migliaia di movimenti) si potrà passare a collezioni; vedi
//  la nota in SETUP.md.
// ============================================================

import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';

const LOCAL_KEY = 'smartFinance_v1';
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

let fb = null;            // moduli + handle firebase, popolato in initFirebase()
let unsub = null;         // funzione di unsubscribe dello snapshot
let currentUser = null;
let applying = false;     // guardia anti-eco (evita riscrivere ciò che arriva dal cloud)
let seeded = false;

const cbs = { remote: () => {}, auth: () => {}, status: () => {} };

export const store = {
  onRemote(fn) { cbs.remote = fn; },
  onAuth(fn)   { cbs.auth = fn; },
  onStatus(fn) { cbs.status = fn; },

  isEnabled() { return FIREBASE_ENABLED; },
  getUser()   { return currentUser; },

  loadLocal() {
    try { const raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  },
  saveLocal(stato) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(stato)); } catch (e) {}
  },

  // Chiamata dall'app a ogni modifica dello stato.
  async persist(stato) {
    this.saveLocal(stato);
    if (fb && currentUser && !applying) {
      try {
        await fb.setDoc(
          fb.doc(fb.db, 'users', currentUser.uid, 'data', 'state'),
          { stato, updatedAt: fb.serverTimestamp() }
        );
      } catch (e) {
        // offline: la persistenza locale di Firestore farà il flush al ritorno online
        console.warn('persist deferita (offline?):', e.message);
      }
    }
  },

  async initFirebase() {
    if (!FIREBASE_ENABLED) { cbs.status('local'); return; }
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-firestore.js`)
      ]);
      const app = appMod.initializeApp(firebaseConfig);
      // Persistenza offline (IndexedDB) con supporto multi-tab.
      const db = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({
          tabManager: fsMod.persistentMultipleTabManager()
        })
      });
      const auth = authMod.getAuth(app);

      fb = {
        app, db, auth,
        doc: fsMod.doc, setDoc: fsMod.setDoc, onSnapshot: fsMod.onSnapshot,
        serverTimestamp: fsMod.serverTimestamp,
        GoogleAuthProvider: authMod.GoogleAuthProvider,
        signInWithPopup: authMod.signInWithPopup,
        signOut: authMod.signOut,
        createUser: authMod.createUserWithEmailAndPassword,
        signInEmail: authMod.signInWithEmailAndPassword
      };

      authMod.onAuthStateChanged(auth, (user) => {
        currentUser = user;
        seeded = false;
        if (unsub) { unsub(); unsub = null; }
        cbs.auth(user);
        if (user) this._subscribe(user);
        else cbs.status('local');
      });
      cbs.status('ready');
    } catch (e) {
      console.error('initFirebase fallita:', e);
      cbs.status('error');
    }
  },

  _subscribe(user) {
    const ref = fb.doc(fb.db, 'users', user.uid, 'data', 'state');
    cbs.status('syncing');
    unsub = fb.onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        // Primo accesso su account vuoto: semina il cloud con i dati locali.
        if (!seeded) {
          seeded = true;
          const local = this.loadLocal();
          if (local) this.persist(local);
        }
        cbs.status('synced');
        return;
      }
      const data = snap.data();
      if (data && data.stato) {
        applying = true;
        this.saveLocal(data.stato);
        cbs.remote(data.stato, snap.metadata.fromCache);
        applying = false;
      }
      cbs.status(snap.metadata.fromCache ? 'offline' : 'synced');
    }, (err) => {
      console.error('snapshot error:', err);
      cbs.status('error');
    });
  },

  // --- Azioni di autenticazione ---
  async loginGoogle()           { return fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider()); },
  async loginEmail(email, pw)   { return fb.signInEmail(fb.auth, email, pw); },
  async registerEmail(email, pw){ return fb.createUser(fb.auth, email, pw); },
  async logout()                { return fb.signOut(fb.auth); }
};
