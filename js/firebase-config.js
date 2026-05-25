// ============================================================
//  CONFIG FIREBASE  —  INCOLLA QUI i valori del TUO progetto
//  (Firebase console → Project settings → "Le tue app" → Web app → SDK setup)
//
//  Questi valori NON sono segreti: possono stare nel codice client.
//  La sicurezza dei dati è garantita dalle Firestore Security Rules
//  (file firestore.rules) + dall'autenticazione, non dal nascondere la config.
//
//  Finché apiKey e projectId restano vuoti, l'app funziona SOLO in locale
//  (localStorage), senza login né sincronizzazione cloud. Vedi SETUP.md.
// ============================================================

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// La sync cloud si attiva automaticamente quando la config è compilata.
export const FIREBASE_ENABLED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
