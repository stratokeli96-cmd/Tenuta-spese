// ============================================================
//  STORE — layer di persistenza offline-first
//
//  - Salva sempre in localStorage (avvio istantaneo + fallback).
//  - Se configurato (repo GitHub privato + PAT fine-grained), sincronizza
//    lo stato come un singolo file JSON tramite l'API Contents di GitHub.
//  - Ogni salvataggio remoto è un commit → la cronologia git fa da backup.
//  - Sync a polling (no real-time push): adeguata a un'app personale a
//    utente singolo con volumi di dati modesti.
//
//  Schema del file remoto (tenuta-spese.json):
//    { "stato": { ...stato app... }, "updatedAt": <ms> }
//  updatedAt vive dentro il blob → confronto last-write-wins senza chiamate
//  extra. Lo "sha" del file GitHub è tenuto in memoria solo come precondizione
//  del PUT (controllo di concorrenza).
// ============================================================

const LOCAL_KEY   = 'smartFinance_v1';
const CFG_KEY     = 'smartFinance_sync_cfg';
const UPDATED_KEY = 'smartFinance_updatedAt';
const FILE_PATH   = 'tenuta-spese.json';
const POLL_MS     = 30000;
const DEBOUNCE_MS = 1500;

let cfg = null;        // { repo, token }
let sha = null;        // sha corrente del file remoto (precondizione del PUT)
let pollTimer = null;
let pushTimer = null;
let pending = false;   // modifica locale non ancora confermata sul remoto
let started = false;   // listener globali registrati una sola volta

const cbs = { remote: () => {}, status: () => {} };

// --- base64 UTF-8 (gestisce accenti, €, ecc.) ---
function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(b64) { return decodeURIComponent(escape(atob(String(b64).replace(/\n/g, '')))); }

function loadCfg() {
  try { const raw = localStorage.getItem(CFG_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function localUpdatedAt() { return Number(localStorage.getItem(UPDATED_KEY) || 0); }
function apiUrl()  { return `https://api.github.com/repos/${cfg.repo}/contents/${FILE_PATH}`; }
function headers() {
  return { 'Authorization': `Bearer ${cfg.token}`, 'Accept': 'application/vnd.github+json' };
}

export const store = {
  onRemote(fn) { cbs.remote = fn; },
  onStatus(fn) { cbs.status = fn; },

  isEnabled() { return Boolean(cfg && cfg.repo && cfg.token); },

  getConfig() { return cfg ? { repo: cfg.repo, token: cfg.token } : { repo: '', token: '' }; },
  setConfig({ repo, token }) {
    const cleanRepo = (repo || '').trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/+$/, '');
    cfg = { repo: cleanRepo, token: (token || '').trim() };
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    sha = null;
    this.init();
  },

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
    localStorage.setItem(UPDATED_KEY, String(Date.now()));
    if (this.isEnabled()) this._pushDebounced();
  },

  init() {
    cfg = loadCfg();
    if (!this.isEnabled()) { cbs.status('local'); return; }
    if (!started) {
      started = true;
      window.addEventListener('online', () => { pending ? this._push() : this._pull(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this._pull(); });
      window.addEventListener('focus', () => this._pull());
    }
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) this._pull(); }, POLL_MS);
    this._pull();
  },

  _pushDebounced() {
    pending = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => this._push(), DEBOUNCE_MS);
  },

  // GET del file remoto. → { missing:true } se assente (404); altrimenti
  // { sha, updatedAt, stato }. Lancia con .httpStatus sugli altri errori HTTP.
  async _fetchRemote() {
    const res = await fetch(apiUrl(), { cache: 'no-store', headers: headers() });
    if (res.status === 404) return { missing: true };
    if (!res.ok) {
      const msg = (res.status === 401 || res.status === 403)
        ? 'Token non valido o permessi insufficienti'
        : 'HTTP ' + res.status;
      const err = new Error(msg);
      err.httpStatus = res.status;
      throw err;
    }
    const data = await res.json();
    const parsed = JSON.parse(b64decode(data.content));
    return { sha: data.sha, updatedAt: Number(parsed.updatedAt || 0), stato: parsed.stato };
  },

  _applyRemote(stato, updatedAt) {
    this.saveLocal(stato);
    localStorage.setItem(UPDATED_KEY, String(updatedAt));
    cbs.remote(stato);
  },

  async _push() {
    if (!this.isEnabled()) return;
    cbs.status('syncing');
    const updatedAt = localUpdatedAt() || Date.now();
    const stato = this.loadLocal() || {};
    const content = b64encode(JSON.stringify({ stato, updatedAt }));
    const body = { message: `update ${new Date(updatedAt).toISOString()}`, content };
    if (sha) body.sha = sha;
    try {
      let res = await fetch(apiUrl(), { method: 'PUT', cache: 'no-store', headers: headers(), body: JSON.stringify(body) });
      if (res.status === 409) {
        // Conflitto (scrittura da un altro dispositivo): last-write-wins per updatedAt.
        const r = await this._fetchRemote();
        if (!r.missing) {
          sha = r.sha;
          if (r.stato && r.updatedAt > updatedAt) {
            // Il remoto è più recente del nostro push: vince il remoto, niente overwrite.
            this._applyRemote(r.stato, r.updatedAt);
            pending = false;
            cbs.status('synced');
            return;
          }
          body.sha = sha; // il nostro è più recente: ripush con sha aggiornato
        } else {
          delete body.sha;
        }
        res = await fetch(apiUrl(), { method: 'PUT', cache: 'no-store', headers: headers(), body: JSON.stringify(body) });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      sha = data.content && data.content.sha;
      pending = false;
      cbs.status('synced');
    } catch (e) {
      console.warn('push fallita (offline?):', e.message);
      cbs.status('offline');
    }
  },

  async _pull() {
    if (!this.isEnabled()) return { ok: false, error: 'non configurato' };
    try {
      const r = await this._fetchRemote();
      if (r.missing) { sha = null; await this._push(); return { ok: true }; }
      sha = r.sha;
      if (!pending && r.stato && r.updatedAt > localUpdatedAt()) {
        this._applyRemote(r.stato, r.updatedAt);
      }
      cbs.status('synced');
      return { ok: true };
    } catch (e) {
      console.warn('pull fallita:', e.message);
      cbs.status(e.httpStatus ? 'error' : 'offline');
      return { ok: false, error: e.message };
    }
  },

  // Verifica/forza una sincronizzazione (bottone "Sincronizza ora").
  async testConnection() {
    if (!this.isEnabled()) return { ok: false, error: 'Inserisci repository e token' };
    cbs.status('syncing');
    return this._pull();
  }
};
