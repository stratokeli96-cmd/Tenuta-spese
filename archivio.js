/* ============================================================
   ARCHIVIO MESI — IndexedDB
   Dettaglio (movimenti + scontrini) dei mesi chiusi. In localStorage
   restano solo i totali. Vedi docs/superpowers/specs/2026-11-06-storico-mesi-design.md
   Se IndexedDB non è disponibile, Archivio.ok resta false e l'app
   continua a tenere tutto in localStorage come prima.
   ============================================================ */
const Archivio = (() => {
  const DB = 'tenuta-spese', VERSIONE = 1;
  const STORE = 'mesi', STORE_BACKUP = 'mesi_prima_import';
  let db = null;

  function init() {
    return new Promise(resolve => {
      if (typeof indexedDB === 'undefined') return resolve(false);
      let req;
      try { req = indexedDB.open(DB, VERSIONE); } catch (_) { return resolve(false); }
      req.onupgradeneeded = () => {
        [STORE, STORE_BACKUP].forEach(n => {
          if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n, { keyPath: 'id' });
        });
      };
      req.onsuccess = () => { db = req.result; api.ok = true; resolve(true); };
      req.onerror = req.onblocked = () => resolve(false);
    });
  }

  /** Esegue fn(tx) in una transazione e risolve quando è COMPLETATA (durabile). */
  function tx(stores, modo, fn) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('Archivio non disponibile'));
      const t = db.transaction(stores, modo);
      let esito;
      Promise.resolve(fn(t)).then(v => { esito = v; }, reject);
      t.oncomplete = () => resolve(esito);
      t.onerror = t.onabort = () => reject(t.error || new Error('Transazione annullata'));
    });
  }
  const richiesta = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const api = {
    ok: false,
    init,
    salva: rec => tx([STORE], 'readwrite', t => richiesta(t.objectStore(STORE).put(rec))),
    salvaTutti: recs => tx([STORE], 'readwrite', t => Promise.all(recs.map(r => richiesta(t.objectStore(STORE).put(r))))),
    leggi: id => tx([STORE], 'readonly', t => richiesta(t.objectStore(STORE).get(id))),
    tutti: () => tx([STORE], 'readonly', t => richiesta(t.objectStore(STORE).getAll())),
    conta: () => tx([STORE], 'readonly', t => richiesta(t.objectStore(STORE).count())),
    svuota: () => tx([STORE], 'readwrite', t => richiesta(t.objectStore(STORE).clear())),
    /** Import: copia lo storico attuale nel backup, poi lo sostituisce con `recs`. Tutto in UNA transazione. */
    sostituisciConBackup: recs => tx([STORE, STORE_BACKUP], 'readwrite', async t => {
      const corrente = t.objectStore(STORE), backup = t.objectStore(STORE_BACKUP);
      const vecchi = await richiesta(corrente.getAll());
      await richiesta(backup.clear());
      await Promise.all(vecchi.map(r => richiesta(backup.put(r))));
      await richiesta(corrente.clear());
      await Promise.all(recs.map(r => richiesta(corrente.put(r))));
    }),
    backupPrimaImport: () => tx([STORE_BACKUP], 'readonly', t => richiesta(t.objectStore(STORE_BACKUP).getAll()))
  };
  return api;
})();
