/* ============================================================
   LOGICA PURA — Tenuta Spese
   Nessun accesso a DOM o localStorage: testabile con `node --test`
   (vedi tests/logic.test.js). Caricato da index.html prima dello
   script principale e precaricato dal service worker.
   ============================================================ */
const VOCI_NEEDS_DEFAULT = [
  { id:'alimentari',  nome:'Alimentari',                budget:258 },
  { id:'utenze',      nome:'Utenze (luce/gas/acqua)',   budget:139 },
  { id:'telefonia',   nome:'Telefonia + internet',      budget:37  },
  { id:'carburante',  nome:'Carburante motorino',       budget:30  },
  { id:'farmacia',    nome:'Farmacia ricorrente',       budget:5   },
  { id:'moto',        nome:'Moto: RCA + bollo + manut.',budget:35  },
  { id:'tari',        nome:'TARI',                      budget:7   },
  { id:'sanitarie',   nome:'Sanitarie irregolari',      budget:16  },
  { id:'buffer',      nome:'Buffer / imprevisti',       budget:22  }
];
const VOCI_WANTS_DEFAULT = [
  { id:'ristorazione',  nome:'Ristorazione e vita sociale', budget:200 },
  { id:'online',        nome:'Online (acquisti <100)',      budget:45  },
  { id:'contanti',      nome:'Contanti (barbiere + extra)', budget:35  },
  { id:'bar',           nome:'Bar e caffetterie',           budget:22  },
  { id:'sport',         nome:'Sport / hobby',               budget:14  },
  { id:'abbonamenti',   nome:'Abbonamenti digitali',        budget:12  },
  { id:'altro-wants',   nome:'Altro / imprevisti Wants',    budget:6   },
  { id:'viaggi',        nome:'Viaggi e weekend',            budget:94  },
  { id:'abbigliamento', nome:'Abbigliamento (stagionale)',  budget:65  }
];
const VOCI_SAVINGS_DEFAULT = [
  { id:'tr-fisso',  nome:'Versamento fisso (Trade Republic)', budget:150 }
];

const STATO_DEFAULT = {
  meseCorrente: 'Mag 2026',
  reddito: 1192,
  macros: {
    needs:   { id:'needs',   nome:'Needs',   budget:549, voci: JSON.parse(JSON.stringify(VOCI_NEEDS_DEFAULT))   },
    wants:   { id:'wants',   nome:'Wants',   budget:493, voci: JSON.parse(JSON.stringify(VOCI_WANTS_DEFAULT))   },
    savings: { id:'savings', nome:'Savings', budget:150, voci: JSON.parse(JSON.stringify(VOCI_SAVINGS_DEFAULT)) }
  },
  movimenti: [],
  scontrini: [],
  righeProdotto: [],
  storicoProdotti: {},
  archivioMesi: [],
  saldoRiportato: { needs:0, wants:0, savings:0 }
};

const VECCHIO_TO_MACRO = {
  'needs-correnti':   'needs',
  'cuscinetto-needs': 'needs',
  'carta-wants':      'wants',
  'cuscinetto-wants': 'wants',
  'trade-republic':   'savings'
};

function rilevaVecchioSchema(obj) {
  return obj && obj.contenitori && obj.contenitori['needs-correnti'];
}

function migraDaVecchioSchema(vecchio) {
  const out = JSON.parse(JSON.stringify(STATO_DEFAULT));
  out.meseCorrente = vecchio.meseCorrente || out.meseCorrente;
  out.reddito = vecchio.reddito ?? out.reddito;

  const sommaBudget = { needs:0, wants:0, savings:0 };
  const vociPerMacro = { needs:[], wants:[], savings:[] };
  const seenIds = { needs:new Set(), wants:new Set(), savings:new Set() };

  Object.values(vecchio.contenitori || {}).forEach(c => {
    const macro = VECCHIO_TO_MACRO[c.id];
    if (!macro) return;
    sommaBudget[macro] += Number(c.budget) || 0;
    (c.voci || []).forEach(v => {
      if (!seenIds[macro].has(v.id)) {
        seenIds[macro].add(v.id);
        vociPerMacro[macro].push({ id:v.id, nome:v.nome, budget:Number(v.budget)||0 });
      }
    });
  });

  ['needs','wants','savings'].forEach(m => {
    out.macros[m].budget = sommaBudget[m] || out.macros[m].budget;
    if (vociPerMacro[m].length) out.macros[m].voci = vociPerMacro[m];
  });

  out.movimenti = (vecchio.movimenti || []).map(m => ({
    id: m.id,
    data: m.data,
    macro: VECCHIO_TO_MACRO[m.contenitore] || 'needs',
    voce: m.voce,
    importo: Number(m.importo) || 0,
    descrizione: m.descrizione || '',
    origine: m.origine || 'manuale'
  }));

  (vecchio.versamentiTR || []).forEach(v => {
    out.movimenti.push({
      id: v.id,
      data: v.data,
      macro: 'savings',
      voce: 'tr-fisso',
      importo: Number(v.importo) || 0,
      descrizione: v.tipo || 'Versamento Trade Republic',
      origine: 'manuale'
    });
  });

  out.scontrini = (vecchio.scontrini || []).map(s => ({ ...s, origine:'manuale' }));
  out.righeProdotto = vecchio.righeProdotto || [];
  out.storicoProdotti = vecchio.storicoProdotti || {};

  const sr = vecchio.saldoRiportato || {};
  out.saldoRiportato = {
    needs:   (Number(sr['needs-correnti'])||0) + (Number(sr['cuscinetto-needs'])||0),
    wants:   (Number(sr['cuscinetto-wants'])||0),
    savings: (Number(sr['trade-republic'])||0)
  };

  out.archivioMesi = (vecchio.archivioMesi || []).map(m => ({
    mese: m.mese,
    spesoNeeds:   (Number(m.spesoNeedsCorrenti)||0) + (Number(m.spesoCuscinettoNeeds)||0),
    spesoWants:   (Number(m.spesoCartaWants)||0)    + (Number(m.spesoCuscinettoWants)||0),
    versatoSavings: Number(m.versatoTR)||0,
    avanzoVerso: Number(m.avanzoWants)||0
  }));

  return out;
}

/* ============================================================
   UTILITY
   ============================================================ */
/** Data locale YYYY-MM-DD (NON UTC: dopo mezzanotte italiana toISOString darebbe il giorno prima). */
function oggi(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/** Cella CSV: raddoppia le virgolette e neutralizza le "formule" (=, +, -, @) per Excel. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function copiaProfonda(o) { return JSON.parse(JSON.stringify(o)); }

/* ============================================================
   VALIDAZIONE STATO (import / caricamento da localStorage)
   Restituisce una COPIA normalizzata oppure lancia Error.
   ============================================================ */
const SCHEMA_VERSION = 2;
const MACRO_IDS = ['needs', 'wants', 'savings'];

function _num(v, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function _str(v, def = '') { return (v === null || v === undefined) ? def : String(v); }
function _arrObj(a) { return Array.isArray(a) ? a.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []; }

function validaStato(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('il file non contiene un oggetto dati valido');
  }
  const d = copiaProfonda(input);
  const out = copiaProfonda(STATO_DEFAULT);

  out.meseCorrente = _str(d.meseCorrente).trim() || out.meseCorrente;
  const red = _num(d.reddito, NaN);
  out.reddito = (Number.isFinite(red) && red >= 0) ? red : out.reddito;

  if (!d.macros || typeof d.macros !== 'object') throw new Error('sezione "macros" mancante');
  MACRO_IDS.forEach(id => {
    const m = d.macros[id];
    if (!m || typeof m !== 'object' || !Array.isArray(m.voci)) {
      throw new Error('macro "' + id + '" mancante o senza voci');
    }
    const visti = new Set();
    const voci = [];
    _arrObj(m.voci).forEach(v => {
      const vid = _str(v.id);
      if (!vid || visti.has(vid)) return;
      visti.add(vid);
      const voce = { id: vid, nome: _str(v.nome, 'Voce'), budget: Math.max(0, _num(v.budget)) };
      if (Number.isFinite(Number(v.quotaPct)) && v.quotaPct !== null) voce.quotaPct = Number(v.quotaPct);
      voci.push(voce);
    });
    const macro = { id, nome: _str(m.nome, out.macros[id].nome), budget: Math.max(0, _num(m.budget)), voci };
    if (Number.isFinite(Number(m.quotaPct)) && m.quotaPct !== null) macro.quotaPct = Number(m.quotaPct);
    out.macros[id] = macro;
  });

  out.movimenti = _arrObj(d.movimenti).map(m => ({
    id: _str(m.id) || uid(),
    data: _str(m.data),
    macro: _str(m.macro),
    voce: _str(m.voce),
    importo: round2(_num(m.importo)),
    descrizione: _str(m.descrizione),
    origine: m.origine === 'ocr' ? 'ocr' : 'manuale'
  }));
  out.scontrini = _arrObj(d.scontrini).map(s => ({
    ...s,
    id: _str(s.id) || uid(),
    data: _str(s.data),
    negozio: _str(s.negozio),
    localita: _str(s.localita),
    totale: round2(_num(s.totale)),
    origine: s.origine === 'ocr' ? 'ocr' : 'manuale'
  }));
  out.righeProdotto = _arrObj(d.righeProdotto).map(r => ({
    ...r,
    id: _str(r.id) || uid(),
    scontrinoId: _str(r.scontrinoId),
    prodotto: _str(r.prodotto),
    categoria: _str(r.categoria, 'Altro'),
    prezzo: round2(_num(r.prezzo))
  }));

  out.storicoProdotti = {};
  if (d.storicoProdotti && typeof d.storicoProdotti === 'object' && !Array.isArray(d.storicoProdotti)) {
    Object.keys(d.storicoProdotti).forEach(k => {
      const s = d.storicoProdotti[k];
      if (!s || typeof s !== 'object') return;
      out.storicoProdotti[k] = {
        ...s,
        prodotto: _str(s.prodotto), categoria: _str(s.categoria, 'Altro'),
        volte: _num(s.volte), spesaTotale: round2(_num(s.spesaTotale)), ultimoPrezzo: round2(_num(s.ultimoPrezzo))
      };
    });
  }

  const idVisti = new Set();
  out.archivioMesi = _arrObj(d.archivioMesi).map(a => {
    let id = _str(a.id) || uid();
    while (idVisti.has(id)) id = uid();
    idVisti.add(id);
    return { ...a, id };
  }).map(a => ({
    ...a,
    mese: _str(a.mese),
    reddito: _num(a.reddito), spesoNeeds: _num(a.spesoNeeds), spesoWants: _num(a.spesoWants),
    versatoSavings: _num(a.versatoSavings), avanzoTotale: _num(a.avanzoTotale),
    movimenti: _arrObj(a.movimenti), scontrini: _arrObj(a.scontrini)
  }));

  const sr = (d.saldoRiportato && typeof d.saldoRiportato === 'object') ? d.saldoRiportato : {};
  out.saldoRiportato = { needs: _num(sr.needs), wants: _num(sr.wants), savings: _num(sr.savings) };
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

/* ============================================================
   ARCHIVIO MESI: separazione stato leggero / dettaglio
   Il dettaglio (movimenti, scontrini) dei mesi chiusi vive in IndexedDB;
   in localStorage restano solo i totali.
   ============================================================ */
/** Copia leggera di un mese archiviato (senza movimenti/scontrini). */
function meseLeggero(a) {
  const { movimenti, scontrini, compattato, ...resto } = a;
  return {
    ...resto,
    nMovimenti: (Array.isArray(movimenti) && movimenti.length) || a.nMovimenti || 0,
    nScontrini: (Array.isArray(scontrini) && scontrini.length) || a.nScontrini || 0
  };
}
/** Separa lo stato in {leggero, dettagli}: dettagli = record completi da mettere in IndexedDB. */
function separaArchivio(st) {
  const dettagli = [];
  const leggero = { ...st, archivioMesi: st.archivioMesi.map(a => {
    const haDettaglio = (a.movimenti && a.movimenti.length) || (a.scontrini && a.scontrini.length);
    if (haDettaglio) dettagli.push({ ...a, movimenti: a.movimenti || [], scontrini: a.scontrini || [] });
    return meseLeggero(a);
  }) };
  return { leggero, dettagli };
}
/** Ricompone lo stato completo (per l'export) unendo i dettagli letti da IndexedDB. */
function ricomponiArchivio(stLeggero, dettagli) {
  const perId = new Map((dettagli || []).map(r => [r.id, r]));
  return { ...stLeggero, archivioMesi: stLeggero.archivioMesi.map(a => {
    const r = perId.get(a.id);
    const { nMovimenti, nScontrini, ...base } = a;
    return { ...base, movimenti: r ? r.movimenti : (a.movimenti || []), scontrini: r ? r.scontrini : (a.scontrini || []) };
  }) };
}
/** Differenze tra due mesi archiviati (b - a), per macro. */
function confrontaMesi(a, b) {
  const campi = [['Needs', 'spesoNeeds'], ['Wants', 'spesoWants'], ['Savings', 'versatoSavings'], ['Avanzo', 'avanzoTotale'], ['Reddito', 'reddito']];
  return campi.map(([nome, k]) => {
    const va = round2(_num(a[k])), vb = round2(_num(b[k]));
    const delta = round2(vb - va);
    return { nome, a: va, b: vb, delta, pct: va !== 0 ? Math.round(delta / va * 100) : null };
  });
}

/** Importa un oggetto qualunque (nuovo o vecchio schema) e restituisce uno stato valido. */
function importaStato(dati) {
  return validaStato(rilevaVecchioSchema(dati) ? migraDaVecchioSchema(dati) : dati);
}

/* ============================================================
   CALCOLI (importi arrotondati al centesimo: niente deriva float)
   ============================================================ */
function stIsVoceValida(st, macroId, voceId) {
  const m = st.macros[macroId];
  return !!m && m.voci.some(v => v.id === voceId);
}
function stIsOrfano(st, mov) {
  return !mov.macro || !st.macros[mov.macro] || !stIsVoceValida(st, mov.macro, mov.voce);
}
function totaleScontrini(st) {
  return round2(st.scontrini.reduce((a, s) => a + Number(s.totale || 0), 0));
}
function stSpesoMacro(st, macroId) {
  let s = st.movimenti
    .filter(m => m.macro === macroId && !stIsOrfano(st, m))
    .reduce((a, m) => a + Number(m.importo), 0);
  if (macroId === 'needs') s += totaleScontrini(st);
  return round2(s);
}
function stSpesoVoce(st, macroId, voceId) {
  let s = st.movimenti
    .filter(m => m.macro === macroId && m.voce === voceId)
    .reduce((a, m) => a + Number(m.importo), 0);
  if (macroId === 'needs' && voceId === VOCE_SCONTRINI) s += totaleScontrini(st);
  return round2(s);
}
/** Voce che riceve gli scontrini OCR: non eliminabile. */
const VOCE_SCONTRINI = 'alimentari';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATO_DEFAULT, SCHEMA_VERSION, VOCE_SCONTRINI, oggi, round2, uid, escapeHtml, csvCell, copiaProfonda,
    validaStato, importaStato, rilevaVecchioSchema, migraDaVecchioSchema,
    meseLeggero, separaArchivio, ricomponiArchivio, confrontaMesi,
    stIsVoceValida, stIsOrfano, stSpesoMacro, stSpesoVoce, totaleScontrini
  };
}
