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
  entrateExtra: [],
  regoleBanca: {},
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
    origine: (m.origine === 'ocr' || m.origine === 'banca') ? m.origine : 'manuale',
    ...(m.rif ? { rif: _str(m.rif).slice(0, 120) } : {})
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

  out.entrateExtra = _arrObj(d.entrateExtra).map(e => {
    const importo = Math.max(0, round2(_num(e.importo)));
    const alloc = { needs: 0, wants: 0, savings: 0 };
    MACRO_IDS.forEach(id => { alloc[id] = Math.max(0, round2(_num(e.alloc && e.alloc[id]))); });
    const somma = round2(alloc.needs + alloc.wants + alloc.savings);
    if (somma > importo) MACRO_IDS.forEach(id => { alloc[id] = 0; }); // incoerente: da riassegnare
    return { id: _str(e.id) || uid(), data: _str(e.data), descrizione: _str(e.descrizione), importo, alloc,
      ...(e.rif ? { rif: _str(e.rif).slice(0, 120) } : {}) };
  }).filter(e => e.importo > 0);

  out.regoleBanca = {};
  if (d.regoleBanca && typeof d.regoleBanca === 'object' && !Array.isArray(d.regoleBanca)) {
    Object.keys(d.regoleBanca).slice(0, 500).forEach(k => {
      const r = d.regoleBanca[k];
      if (!k || k.length > 40 || k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      if (r && MACRO_IDS.includes(r.macro) && typeof r.voce === 'string' && r.voce) {
        Object.defineProperty(out.regoleBanca, k, { value: { macro: r.macro, voce: r.voce }, enumerable: true, writable: true, configurable: true });
      }
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
    movimenti: _arrObj(a.movimenti), scontrini: _arrObj(a.scontrini), righeProdotto: _arrObj(a.righeProdotto)
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
  const { movimenti, scontrini, righeProdotto, compattato, ...resto } = a;
  return {
    ...resto,
    nRighe: (Array.isArray(righeProdotto) && righeProdotto.length) || a.nRighe || 0,
    nMovimenti: (Array.isArray(movimenti) && movimenti.length) || a.nMovimenti || 0,
    nScontrini: (Array.isArray(scontrini) && scontrini.length) || a.nScontrini || 0
  };
}
/** Separa lo stato in {leggero, dettagli}: dettagli = record completi da mettere in IndexedDB. */
function separaArchivio(st) {
  const dettagli = [];
  const leggero = { ...st, archivioMesi: st.archivioMesi.map(a => {
    const haDettaglio = (a.movimenti && a.movimenti.length) || (a.scontrini && a.scontrini.length) || (a.righeProdotto && a.righeProdotto.length);
    if (haDettaglio) dettagli.push({ ...a, movimenti: a.movimenti || [], scontrini: a.scontrini || [], righeProdotto: a.righeProdotto || [] });
    return meseLeggero(a);
  }) };
  return { leggero, dettagli };
}
/** Ricompone lo stato completo (per l'export) unendo i dettagli letti da IndexedDB. */
function ricomponiArchivio(stLeggero, dettagli) {
  const perId = new Map((dettagli || []).map(r => [r.id, r]));
  return { ...stLeggero, archivioMesi: stLeggero.archivioMesi.map(a => {
    const r = perId.get(a.id);
    const { nMovimenti, nScontrini, nRighe, ...base } = a;
    return { ...base, movimenti: r ? r.movimenti : (a.movimenti || []), scontrini: r ? r.scontrini : (a.scontrini || []),
      righeProdotto: r ? (r.righeProdotto || []) : (a.righeProdotto || []) };
  }) };
}
/** Reddito totale di un mese archiviato (base + entrate extra). */
function redditoMese(a) { return round2(_num(a.reddito) + _num(a.extraTot)); }
/** Differenze tra due mesi archiviati (b - a), per macro. */
function confrontaMesi(a, b) {
  const campi = [['Needs', 'spesoNeeds'], ['Wants', 'spesoWants'], ['Savings', 'versatoSavings'], ['Avanzo', 'avanzoTotale'], ['Reddito', null]];
  return campi.map(([nome, k]) => {
    const va = k ? round2(_num(a[k])) : redditoMese(a), vb = k ? round2(_num(b[k])) : redditoMese(b);
    const delta = round2(vb - va);
    return { nome, a: va, b: vb, delta, pct: va !== 0 ? Math.round(delta / va * 100) : null };
  });
}

/* ============================================================
   ENTRATE EXTRA
   Un'entrata extra va nel totale del mese. L'utente decide poi come
   ripartirla tra Needs/Wants/Savings (`alloc`): la quota assegnata
   aumenta il budget della macro per il mese (via saldoRiportato, che
   la chiusura mese azzera: l'extra non si trascina).
   ============================================================ */
function totaleEntrateExtra(st) {
  return round2((st.entrateExtra || []).reduce((a, e) => a + Number(e.importo || 0), 0));
}
function redditoTotale(st) { return round2(Number(st.reddito || 0) + totaleEntrateExtra(st)); }
function extraAssegnata(e) {
  const a = e.alloc || {};
  return round2(MACRO_IDS.reduce((t, id) => t + Number(a[id] || 0), 0));
}
function extraDaAssegnare(st) {
  return round2((st.entrateExtra || []).reduce((a, e) => a + (Number(e.importo || 0) - extraAssegnata(e)), 0));
}
/**
 * Valida una nuova ripartizione per un'entrata. Restituisce {alloc, delta}:
 * `delta` = variazione da applicare al budget extra di ciascuna macro.
 * Lancia Error se negativa o se supera l'importo dell'entrata.
 */
function calcolaAllocazione(entrata, nuova) {
  const alloc = {}; const delta = {};
  MACRO_IDS.forEach(id => {
    const v = round2(_num(nuova && nuova[id]));
    if (v < 0) throw new Error('le quote non possono essere negative');
    alloc[id] = v;
    delta[id] = round2(v - Number((entrata.alloc || {})[id] || 0));
  });
  const tot = round2(alloc.needs + alloc.wants + alloc.savings);
  if (tot > round2(entrata.importo)) throw new Error('la somma (' + tot.toFixed(2) + ') supera l\'entrata (' + round2(entrata.importo).toFixed(2) + ')');
  return { alloc, delta };
}

/* ============================================================
   IMPORT ESTRATTI CONTO (CSV / XLSX)
   ============================================================ */
/** Parser CSV: delimitatore automatico (; , tab |), virgolette, BOM, righe vuote scartate. */
function parseCSV(testo) {
  let t = String(testo).replace(/^\uFEFF/, '');
  const campione = t.split(/\r?\n/).filter(r => r.trim()).slice(0, 8).join('\n').replace(/"[^"]*"/g, '');
  const delim = [';', '\t', '|', ','].map(d => [d, campione.split(d).length - 1]).sort((a, b) => b[1] - a[1])[0];
  const D = delim[1] > 0 ? delim[0] : ';';
  const righe = []; let riga = [], cella = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { cella += '"'; i++; } else inQ = false; } else cella += c;
    } else if (c === '"') inQ = true;
    else if (c === D) { riga.push(cella); cella = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      riga.push(cella); cella = '';
      if (riga.some(x => x.trim() !== '')) righe.push(riga.map(x => x.trim()));
      riga = [];
    } else cella += c;
  }
  riga.push(cella);
  if (riga.some(x => x.trim() !== '')) righe.push(riga.map(x => x.trim()));
  return righe;
}

/** Importo da stringa bancaria: "1.234,56", "-12,30", "(5,00)", "12,30-", "€ 7.5". NaN se non valido. */
function parseImportoBanca(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let t = String(v ?? '').replace(/EUR|€|\s/gi, '');
  if (!t) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith('-')) { neg = true; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t)) return NaN;
  const hp = t.includes('.'), hc = t.includes(',');
  if (hp && hc) {
    const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.';
    t = dec === ',' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (hc) {
    t = t.replace(/,/g, '.');
    if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');   // "1,234,567"
  } else if (hp && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** Data in YYYY-MM-DD da dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, ISO, numero seriale Excel. '' se non valida. */
function parseDataBanca(v) {
  const p = n => String(n).padStart(2, '0');
  const valida = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? y + '-' + p(m) + '-' + p(d) : '';
  };
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (/^\d{5}(\.\d+)?$/.test(t) && Number(t) > 20000 && Number(t) < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
    return dt.getUTCFullYear() + '-' + p(dt.getUTCMonth() + 1) + '-' + p(dt.getUTCDate());
  }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})(?!\d)/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return '';
}

function normTesto(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Trova riga di intestazione e colonne (data, descrizione, importo | uscite+entrate). */
function rilevaColonne(righe) {
  const RE = {
    data: /^(data|date|data (operazione|contabile|valuta|movimento))/,
    descrizione: /(descrizione|causale|dettagli|operazione|description|movimento|beneficiario|note)/,
    importo: /^(importo|amount|valore|saldo movimento|importo in euro)/,
    uscite: /(uscite|dare|addebit|debit)/,
    entrate: /(entrate|avere|accredit|credit)/
  };
  let miglior = { punti: 0, idx: 0 };
  righe.slice(0, 30).forEach((r, idx) => {
    const celle = r.map(normTesto);
    let punti = 0;
    Object.values(RE).forEach(re => { if (celle.some(c => c && re.test(c))) punti++; });
    if (punti > miglior.punti) miglior = { punti, idx };
  });
  const intest = (righe[miglior.idx] || []).map(normTesto);
  const trova = re => intest.findIndex(c => c && re.test(c));
  const col = { data: trova(RE.data), descrizione: -1, importo: trova(RE.importo), uscite: trova(RE.uscite), entrate: trova(RE.entrate) };
  col.descrizione = intest.findIndex((c, i) => c && RE.descrizione.test(c) && i !== col.data);
  let header = miglior.punti > 0 ? miglior.idx : -1;
  if (col.importo >= 0 && (col.uscite === col.importo || col.entrate === col.importo)) col.importo = -1;
  // Senza intestazione riconosciuta: si deduce dal contenuto
  if (header === -1 || col.data < 0) {
    const campione = righe.slice(0, 40);
    const n = Math.max(0, ...campione.map(r => r.length));
    let migData = -1, migImp = -1, migTxt = -1, sd = 0, si = 0, st = 0;
    for (let c = 0; c < n; c++) {
      const vals = campione.map(r => r[c]).filter(x => x !== undefined && x !== '');
      const d = vals.filter(x => parseDataBanca(x)).length, i = vals.filter(x => !isNaN(parseImportoBanca(x)) && !parseDataBanca(x)).length;
      const tx = vals.reduce((a, x) => a + (isNaN(parseImportoBanca(x)) && !parseDataBanca(x) ? String(x).length : 0), 0);
      if (d > sd) { sd = d; migData = c; }
      if (i > si) { si = i; migImp = c; }
      if (tx > st) { st = tx; migTxt = c; }
    }
    if (col.data < 0) col.data = migData;
    if (col.importo < 0 && col.uscite < 0 && col.entrate < 0) col.importo = migImp;
    if (col.descrizione < 0) col.descrizione = migTxt;
    if (header === -1) header = -1; // nessuna intestazione: i dati partono dalla riga 0
  }
  return { header, colonne: col, nomi: (righe[Math.max(0, header)] || []) };
}

/** Righe grezze -> movimenti bancari {data, descrizione, importo (uscite negative), rif}. */
function estraiMovimentiBanca(righe, mapp, opzioni = {}) {
  const c = mapp.colonne, inizio = (mapp.header ?? -1) + 1, out = [];
  righe.slice(inizio).forEach(r => {
    const data = parseDataBanca(r[c.data]);
    if (!data) return;
    let importo = NaN;
    if (c.importo >= 0) importo = parseImportoBanca(r[c.importo]);
    else {
      const u = c.uscite >= 0 ? parseImportoBanca(r[c.uscite]) : NaN, e = c.entrate >= 0 ? parseImportoBanca(r[c.entrate]) : NaN;
      if (e > 0) importo = e; else if (Math.abs(u) > 0) importo = -Math.abs(u);
    }
    if (!Number.isFinite(importo) || importo === 0) return;
    if (opzioni.invertiSegno) importo = -importo;
    importo = round2(importo);
    const desc = (c.descrizione >= 0 ? String(r[c.descrizione] ?? '') : r.filter((x, i) => i !== c.data && i !== c.importo && isNaN(parseImportoBanca(x))).join(' ')).replace(/\s+/g, ' ').trim();
    out.push({ data, descrizione: desc, importo, rif: data + '|' + importo.toFixed(2) + '|' + normTesto(desc).slice(0, 40) });
  });
  return out;
}

/** 'esatto' (già importata), 'possibile' (stessa data e importo di una voce esistente) o null. */
function trovaDoppione(riga, st) {
  const abs = round2(Math.abs(riga.importo));
  const insieme = riga.importo < 0 ? st.movimenti : st.entrateExtra;
  if (insieme.some(x => x.rif && x.rif === riga.rif)) return 'esatto';
  if (insieme.some(x => x.data === riga.data && round2(Number(x.importo)) === abs)) return 'possibile';
  return null;
}

const PAROLE_VUOTE_BANCA = new Set(['pagamento', 'pagam', 'pos', 'carta', 'acquisto', 'addebito', 'bonifico', 'pagobancomat', 'visa', 'mastercard', 'debit', 'transazione', 'operazione', 'del', 'dei', 'della', 'per', 'con', 'presso', 'spa', 'srl', 'italia', 'italy', 'web', 'www', 'com', 'eur', 'altri', 'istantaneo', 'sepa', 'a favore', 'favore', 'disposizione', 'contactless', 'apple', 'google', 'pay']);
/** Parola-chiave con cui ricordare la categoria di un esercente (primo termine significativo). */
function chiaveRegola(desc) {
  const t = normTesto(desc).split(' ').filter(x => x.length >= 3 && !PAROLE_VUOTE_BANCA.has(x));
  return t[0] || '';
}
const REGOLE_BANCA_BASE = {
  alimentari: 'esselunga coop conad penny lidl carrefour eurospin pam despar aldi iper tigros simply supermercato',
  carburante: 'eni q8 tamoil esso shell carburante',
  telefonia: 'tim vodafone iliad fastweb wind',
  utenze: 'enel a2a hera acea edison sorgenia iren gas',
  abbonamenti: 'netflix spotify disney dazn youtube',
  online: 'amazon paypal zalando ebay',
  ristorazione: 'ristorante pizzeria trattoria osteria mcdonald burger sushi glovo deliveroo justeat',
  bar: 'bar caffe caffetteria pasticceria',
  farmacia: 'farmacia parafarmacia',
  viaggi: 'ryanair booking airbnb trenitalia italo easyjet',
  'tr-fisso': 'trade republic'
};
/** Suggerisce {macro, voce}: prima le regole imparate dall'utente, poi quelle di base (se la voce esiste). */
function indovinaVoce(desc, st) {
  const chiave = chiaveRegola(desc);
  if (!chiave) return null;
  const imp = st.regoleBanca && Object.prototype.hasOwnProperty.call(st.regoleBanca, chiave) ? st.regoleBanca[chiave] : null;
  if (imp && stIsVoceValida(st, imp.macro, imp.voce)) return { macro: imp.macro, voce: imp.voce };
  const tutto = normTesto(desc).split(' ');
  for (const [voce, parole] of Object.entries(REGOLE_BANCA_BASE)) {
    if (parole.split(' ').some(p => tutto.includes(p))) {
      const macro = MACRO_IDS.find(m => stIsVoceValida(st, m, voce));
      if (macro) return { macro, voce };
    }
  }
  return null;
}

/* ============================================================
   SCONTRINI: lettura con Gemini, confronto con l'OCR locale, analisi prodotti
   ============================================================ */
const CATEGORIA_FALLBACK = 'Altro';

/** Istruzioni per leggere uno scontrino. */
function promptScontrino(categorie) {
  return [
    'Sei un lettore esperto di scontrini fiscali italiani. Leggi l\'immagine (o le immagini: sono pagine dello STESSO scontrino) e restituisci SOLO JSON.',
    'Regole:',
    '- "totale" è il TOTALE COMPLESSIVO stampato sullo scontrino (importo pagato), non la somma delle righe.',
    '- Una riga per ogni prodotto acquistato. "prezzo" è l\'importo FINALE pagato per quella riga (quantità incluse, sconti già applicati).',
    '- Gli sconti vanno applicati al prodotto a cui si riferiscono: NON restituire righe con importo negativo o a zero.',
    '- Ignora intestazione, P.IVA, IVA, resto, metodo di pagamento, punti fedeltà.',
    '- "prodotto": nome leggibile e normalizzato in italiano (espandi le abbreviazioni ovvie, niente codici).',
    '- "categoria": scegli ESATTAMENTE una tra: ' + categorie.join(', ') + '.',
    '- "data" nel formato YYYY-MM-DD. Se un dato non è leggibile lascia stringa vuota o ometti il campo; non inventare.',
    '- Prezzi come numeri con il punto decimale.',
    'Forma della risposta: {"negozio": "", "localita": "", "data": "", "totale": 0, "righe": [{"prodotto": "", "categoria": "", "prezzo": 0}]}'
  ].join('\n');
}

/** Corpo della richiesta a Gemini (generateContent) per leggere uno scontrino da una o più immagini. */
function costruisciRichiestaGemini(immagini, categorie) {
  const prompt = promptScontrino(categorie);
  const T = { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER', ARRAY: 'ARRAY' };
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...immagini.map(i => ({ inline_data: { mime_type: i.mime, data: i.base64 } }))] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: T.OBJECT,
        properties: {
          negozio: { type: T.STRING }, localita: { type: T.STRING }, data: { type: T.STRING }, totale: { type: T.NUMBER },
          righe: { type: T.ARRAY, items: { type: T.OBJECT, properties: {
            prodotto: { type: T.STRING }, categoria: { type: T.STRING, enum: categorie }, prezzo: { type: T.NUMBER }
          }, required: ['prodotto', 'prezzo'] } }
        },
        required: ['righe']
      }
    }
  };
}

/** Risposta di Gemini -> lettura validata (vedi normalizzaRispostaIA). */
function normalizzaRispostaGemini(raw, categorie) { return normalizzaRispostaIA(raw, categorie, 'Gemini'); }

/**
 * Risposta di un servizio IA (oggetto o testo JSON, anche con ```fence``` o testo attorno) -> lettura
 * validata dello scontrino. `servizio` compare nei messaggi ("Gemini", "OpenRouter").
 */
function normalizzaRispostaIA(raw, categorie, servizio) {
  const out = { negozio: '', localita: '', data: '', righe: [], totale: 0, totaleRiportato: null, avvisi: [], errori: [] };
  const nome = _str(servizio) || 'IA';
  let o = raw;
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { o = JSON.parse(t); } catch (_) {
      const i = t.indexOf('{'), j = t.lastIndexOf('}');
      try { o = i >= 0 && j > i ? JSON.parse(t.slice(i, j + 1)) : null; } catch (_) { o = null; }
      if (o === null) { out.errori.push('Risposta di ' + nome + ' non leggibile (JSON non valido).'); return out; }
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) { out.errori.push('Risposta di ' + nome + ' non valida.'); return out; }
  out.negozio = _str(o.negozio).trim().slice(0, 80);
  out.localita = _str(o.localita).trim().slice(0, 80);
  out.data = parseDataBanca(o.data);
  const cat = c => categorie.includes(c) ? c : (categorie.includes(CATEGORIA_FALLBACK) ? CATEGORIA_FALLBACK : categorie[0]);
  let scartate = 0;
  (Array.isArray(o.righe) ? o.righe : []).forEach(r => {
    if (!r || typeof r !== 'object') { scartate++; return; }
    const prodotto = _str(r.prodotto).replace(/\s+/g, ' ').trim().slice(0, 80);
    const prezzo = round2(parseImportoBanca(r.prezzo));
    if (!prodotto || !Number.isFinite(prezzo) || prezzo <= 0) { scartate++; return; }
    out.righe.push({ prodotto, categoria: cat(_str(r.categoria)), prezzo });
  });
  out.totale = round2(out.righe.reduce((a, r) => a + r.prezzo, 0));
  const tr = parseImportoBanca(o.totale);
  out.totaleRiportato = Number.isFinite(tr) && tr > 0 ? round2(tr) : null;
  if (!out.righe.length) out.errori.push(nome + ' non ha trovato prodotti nello scontrino.');
  if (scartate) out.avvisi.push(scartate + ' righe scartate (importo non valido o nome mancante).');
  if (out.totaleRiportato !== null && Math.abs(out.totale - out.totaleRiportato) > 0.01) {
    out.avvisi.push('La somma delle righe (' + out.totale.toFixed(2) + ' €) non coincide col totale letto (' + out.totaleRiportato.toFixed(2) + ' €).');
  }
  return out;
}

/** Quanto dovrebbe costare lo scontrino secondo le righe lette (somma prezzi − sconto complessivo, mai < 0). */
function sommaAttesaLettura(l) {
  const righe = l && Array.isArray(l.righe) ? l.righe : [];
  const somma = righe.reduce((a, r) => a + (Number(r && r.prezzo) || 0), 0);
  return round2(Math.max(0, somma - (Number(l && l.scontoComplessivo) || 0)));
}
/** Somma delle righe contro il totale stampato: 'ok', 'diverso' (con delta) o 'mancante' (totale non letto). */
function controlloTotale(somma, totaleRiportato) {
  const t = Number(totaleRiportato);
  if (totaleRiportato === null || totaleRiportato === undefined || !Number.isFinite(t) || t <= 0) return { stato: 'mancante', delta: null };
  const delta = round2(Number(somma) - t);
  return { stato: Math.abs(delta) > 0.01 ? 'diverso' : 'ok', delta: delta === 0 ? 0 : delta };
}

/* ---------- Groq (API compatibile OpenAI, piano gratuito) ---------- */

/** Corpo per POST /openai/v1/chat/completions: prompt + immagini come data URL, risposta JSON. */
function costruisciRichiestaGroq(immagini, categorie, modello) {
  return {
    model: _str(modello),
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: [
      { type: 'text', text: promptScontrino(categorie) },
      ...(immagini || []).map(i => ({ type: 'image_url', image_url: { url: 'data:' + i.mime + ';base64,' + i.base64 } }))
    ] }]
  };
}
/** Testo della risposta di chat/completions (stringa o array di parti). */
function testoRispostaGroq(j) {
  const c = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('') : '';
}
/** Il modello dichiara di accettare immagini? (campo esplicito, se Groq lo fornisce) */
function _immaginiEsplicite(m) {
  const liste = [m.input_modalities, m.modalities, m.architecture && m.architecture.input_modalities];
  return liste.some(l => Array.isArray(l) && l.includes('image'));
}
const _RE_VISION_GROQ = /llama-4-scout|llama-4-maverick|vision|(^|[-/])vl([-/.]|$)|qwen.*vl/i;
const _PREFERENZE_GROQ = [/llama-4-scout/i, /llama-4-maverick/i];
/** Sceglie dall'elenco di GET /models un modello attivo che legge immagini; null se non ce n'è. */
function scegliModelloGroq(elenco, escludi = []) {
  if (!Array.isArray(elenco)) return null;
  const ok = elenco.filter(m => m && typeof m === 'object' && typeof m.id === 'string' && m.id
    && m.active !== false && !escludi.includes(m.id) && (_immaginiEsplicite(m) || _RE_VISION_GROQ.test(m.id)));
  const rango = m => _immaginiEsplicite(m) ? -1 : (i => i < 0 ? _PREFERENZE_GROQ.length : i)(_PREFERENZE_GROQ.findIndex(r => r.test(m.id)));
  ok.sort((a, b) => rango(a) - rango(b) || a.id.localeCompare(b.id));
  return ok.length ? ok[0].id : null;
}
/** Durata nel formato degli header di Groq ("2m59.56s", "7.66s", "250ms", "1h2m3s"; numero puro = secondi) -> ms. */
function durataGroqMs(s) {
  const t = _str(s).trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 1000);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/);
  if (!t || !m || !(m[1] || m[2] || m[3] || m[4])) return null;
  return Math.round((+m[1] || 0) * 3600000 + (+m[2] || 0) * 60000 + (+m[3] || 0) * 1000 + (+m[4] || 0));
}
const LINK_CHIAVI_GROQ = 'console.groq.com/keys';
/** Risposta HTTP non ok di Groq -> {tipo, pausaFino, messaggio}. `headers`: oggetto con chiavi minuscole. Mai la chiave nei messaggi. */
function classificaErroreGroq(status, corpo, headers, adessoMs) {
  const e = corpo && typeof corpo === 'object' && corpo.error && typeof corpo.error === 'object' ? corpo.error : {};
  const code = _str(e.code), det = _str(e.message).replace(/gsk_[A-Za-z0-9]+/g, '…').slice(0, 120);
  const h = headers || {};
  if (status === 401 || status === 403) return { tipo: 'chiave', pausaFino: null, messaggio: 'Chiave Groq non valida o revocata: creane una nuova su ' + LINK_CHIAVI_GROQ };
  if (status === 404 || code === 'model_not_found' || code === 'model_decommissioned') return { tipo: 'modello', pausaFino: null, messaggio: 'Modello Groq non più disponibile' };
  if (status === 429) {
    const ms = [h['retry-after'], h['x-ratelimit-reset-requests'], h['x-ratelimit-reset-tokens']].map(durataGroqMs).find(x => x !== null && x > 0);
    return { tipo: 'limite', pausaFino: adessoMs + (ms || 60000), messaggio: 'Limite gratuito di Groq raggiunto' + (det ? ' (' + det + ')' : '') };
  }
  if (status >= 500) return { tipo: 'temporaneo', pausaFino: null, messaggio: 'Groq ha un problema temporaneo (' + status + ')' };
  return { tipo: 'richiesta', pausaFino: null, messaggio: 'Groq ha rifiutato la richiesta (' + status + ')' + (det ? ': ' + det : '') };
}
function _oggettoJson(raw) {
  try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (_) { return null; }
}
/** Configurazione Groq salvata (localStorage) -> sempre valida, mai eccezioni. */
function leggiConfigGroq(raw) {
  const o = (typeof raw === 'string' && _oggettoJson(raw)) || {};
  return { attivo: o.attivo === true, chiave: _str(o.chiave).replace(/\s+/g, ''), modello: _str(o.modello).trim(),
    chiaveNonValida: o.chiaveNonValida === true, salvaFoto: o.salvaFoto === true };
}
/** Nuova configurazione dai campi delle Impostazioni: chiave ripulita; chiave diversa -> modello e "non valida" azzerati. */
function aggiornaConfigGroq(prima, campi) {
  const p = leggiConfigGroq(JSON.stringify(prima || {}));
  const chiave = _str(campi && campi.chiave).replace(/\s+/g, '');
  const nuova = chiave !== p.chiave;
  return { attivo: !!(campi && campi.attivo), chiave, modello: nuova ? '' : p.modello, chiaveNonValida: nuova ? false : p.chiaveNonValida, salvaFoto: !!(campi && campi.salvaFoto) };
}
/** Pausa salvata {fino, motivo} ancora valida, altrimenti null. */
function leggiPausaGroq(raw, adessoMs) {
  const o = typeof raw === 'string' ? _oggettoJson(raw) : null;
  if (!o || !Number.isFinite(o.fino) || o.fino <= adessoMs) return null;
  return { fino: o.fino, motivo: _str(o.motivo) };
}
/** Dalla vecchia configurazione IA si porta solo `salvaFoto`; le chiavi dei vecchi servizi si buttano. */
function configDaVecchiaIA(rawVecchio) {
  const o = (typeof rawVecchio === 'string' && _oggettoJson(rawVecchio)) || {};
  return { ...leggiConfigGroq(null), salvaFoto: o.salvaFoto === true };
}

/* ---------- OpenRouter (API compatibile OpenAI, modelli ":free") ---------- */

/** Corpo per POST /api/v1/chat/completions. `conJson`: il modello accetta response_format. */
function costruisciRichiestaOpenRouter(immagini, categorie, modello, conJson) {
  const corpo = {
    model: _str(modello),
    temperature: 0,
    messages: [{ role: 'user', content: [
      { type: 'text', text: promptScontrino(categorie) },
      ...(immagini || []).map(i => ({ type: 'image_url', image_url: { url: 'data:' + i.mime + ';base64,' + i.base64 } }))
    ] }]
  };
  if (conJson) corpo.response_format = { type: 'json_object' };
  return corpo;
}
/** Testo della risposta di chat/completions (stringa o array di parti). */
function testoRispostaOpenRouter(j) {
  const c = j && Array.isArray(j.choices) && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (p && typeof p.text === 'string') ? p.text : '').join('');
  return '';
}
/**
 * Modello gratuito che legge immagini, da `data` di GET /api/v1/models: id ":free", immagine in ingresso,
 * prezzo 0. Il contesto più ampio vince (di solito i modelli più grandi). -> {id, json} | null.
 */
function scegliModelloOpenRouter(elenco, escludi = []) {
  const zero = v => v !== undefined && v !== null && v !== '' && Number(v) === 0;
  const ok = (Array.isArray(elenco) ? elenco : []).filter(m => m && typeof m === 'object' && typeof m.id === 'string'
    && /:free$/.test(m.id) && !escludi.includes(m.id)
    && m.architecture && Array.isArray(m.architecture.input_modalities) && m.architecture.input_modalities.includes('image')
    && m.pricing && zero(m.pricing.prompt) && zero(m.pricing.completion));
  if (!ok.length) return null;
  ok.sort((a, b) => (Number(b.context_length) || 0) - (Number(a.context_length) || 0) || a.id.length - b.id.length);
  const m = ok[0];
  return { id: m.id, json: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('response_format') };
}
/** Messaggio comprensibile per un errore HTTP di OpenRouter (mai contiene la chiave). */
function messaggioErroreOpenRouter(status, dettaglio) {
  const d = String(dettaglio || '').slice(0, 160);
  if (status === 404 || /no endpoints/i.test(d)) return 'modello OpenRouter non disponibile o senza lettura immagini';
  if (status === 401) return 'chiave OpenRouter non valida: controllala in Impostazioni';
  if (status === 402) return 'credito OpenRouter esaurito (usa un modello :free)';
  if (status === 403) return 'richiesta bloccata da OpenRouter' + (d ? ' (' + d + ')' : '');
  if (status === 429) return 'limite gratuito di OpenRouter raggiunto' + (d ? ' (' + d + ')' : '');
  if (status === 400) return 'richiesta rifiutata da OpenRouter' + (d ? ' (' + d + ')' : '');
  if (status >= 500) return 'OpenRouter temporaneamente non disponibile';
  return 'errore OpenRouter ' + status;
}

/**
 * Sceglie il modello Gemini migliore tra quelli che la chiave può usare.
 * `elenco`: risposta di models.list ([{name:'models/...', supportedGenerationMethods:[...]}]).
 * Preferenze: flash stabile più recente > alias "flash-latest" > flash-lite stabile > altro flash > altro gemini. Mai preview/image/tts/live.
 * `escludi`: nomi da non proporre (es. il modello appena ritirato, che Google può ancora elencare).
 */
function scegliModelloGemini(elenco, escludi = []) {
  const tutti = (Array.isArray(elenco) ? elenco : []).map(m => ({
    nome: String((m && m.name) || '').replace(/^models\//, ''),
    metodi: (m && (m.supportedGenerationMethods || m.metodi)) || []
  })).filter(m => /^gemini-/.test(m.nome) && m.metodi.includes('generateContent') && !escludi.includes(m.nome)
    && !/(image|tts|live|embedding|audio|robotics|computer|learnlm|vision)/.test(m.nome));
  if (!tutti.length) return null;
  const versione = n => { const v = n.match(/gemini-(\d+(?:\.\d+)?)/); return v ? parseFloat(v[1]) : 0; };
  const migliore = lista => lista.sort((a, b) => versione(b.nome) - versione(a.nome) || a.nome.length - b.nome.length)[0];
  // L'alias "-latest" segue l'ultimo modello uscito, che spesso non ha quota gratuita: meglio un flash stabile.
  const stabili = tutti.filter(m => /^gemini-\d+(\.\d+)?-flash$/.test(m.nome));
  if (stabili.length) return migliore(stabili).nome;
  const alias = tutti.find(m => m.nome === 'gemini-flash-latest');
  if (alias) return alias.nome;
  const lite = tutti.filter(m => /^gemini-\d+(\.\d+)?-flash-lite$/.test(m.nome));
  if (lite.length) return migliore(lite).nome;
  const flash = tutti.filter(m => /flash/.test(m.nome) && !/(lite|preview|exp|thinking)/.test(m.nome));
  if (flash.length) return migliore(flash).nome;
  const altri = tutti.filter(m => !/(lite|preview|exp|thinking)/.test(m.nome));
  return (altri.length ? migliore(altri) : migliore(tutti)).nome;
}

/**
 * Quale limite gratuito ha fatto scattare un 429 di Gemini. `corpo`: JSON di errore di Google
 * ({error:{message, details}}), oppure il solo testo; qualsiasi altra cosa → "sconosciuto".
 */
function leggiLimiteGemini(corpo) {
  const out = { tipo: 'sconosciuto', limite: null, modello: '', attesaMs: null };
  const err = corpo && typeof corpo === 'object' ? corpo.error : null;
  const msg = typeof corpo === 'string' ? corpo : (err && typeof err.message === 'string' ? err.message : '');
  const det = err && Array.isArray(err.details) ? err.details : [];
  const tipoDi = d => d && typeof d['@type'] === 'string' ? d['@type'] : '';
  const viol = det.filter(d => /QuotaFailure$/.test(tipoDi(d))).flatMap(d => Array.isArray(d.violations) ? d.violations : []).filter(v => v && typeof v === 'object');
  const ids = viol.map(v => _str(v.quotaId)).join(' ');
  if (viol.some(v => _str(v.quotaValue) === '0') || /limit:\s*0(?!\d)/i.test(msg)) out.tipo = 'zero';
  else if (/PerDay/.test(ids) || /per\s*day/i.test(msg)) out.tipo = 'giorno';
  else if (/PerMinute/.test(ids) || /per\s*minute/i.test(msg)) out.tipo = 'minuto';
  const pesa = v => _str(v.quotaValue) === '0' ? 3 : /PerDay/.test(_str(v.quotaId)) ? 2 : /PerMinute/.test(_str(v.quotaId)) ? 1 : 0;
  const v = viol.slice().sort((a, b) => pesa(b) - pesa(a))[0];
  const lim = v && _str(v.quotaValue) !== '' ? Number(v.quotaValue) : (msg.match(/limit:\s*(\d+)/i) || [])[1];
  if (lim !== undefined && Number.isFinite(Number(lim))) out.limite = Number(lim);
  out.modello = (v && v.quotaDimensions && _str(v.quotaDimensions.model)) || ((msg.match(/model:\s*([\w.-]+)/i) || [])[1] || '').replace(/\.+$/, '');
  const retry = det.find(d => /RetryInfo$/.test(tipoDi(d)));
  const sec = retry && /^([\d.]+)s$/.test(_str(retry.retryDelay)) ? parseFloat(retry.retryDelay) : parseFloat((msg.match(/retry in ([\d.]+)\s*s/i) || [])[1]);
  if (Number.isFinite(sec)) out.attesaMs = Math.round(sec * 1000);
  return out;
}

/** Impronta (FNV-1a 32 bit, 8 hex) di una chiave API: lega dati locali alla chiave senza salvarla. */
function improntaChiave(chiave) {
  let h = 0x811c9dc5;
  const s = _str(chiave);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
/** Un 429 che dice "questo modello oggi non si può più usare" (quota 0 o giornaliera, che sono per modello). */
function quotaModelloFinita(info) { return !!info && (info.tipo === 'zero' || info.tipo === 'giorno'); }
function _leggiEsclusi(raw) {
  let o;
  try { o = JSON.parse(raw); } catch (_) { return null; }
  if (!o || typeof o !== 'object' || typeof o.impronta !== 'string' || !o.modelli || typeof o.modelli !== 'object' || Array.isArray(o.modelli)) return null;
  return o;
}
/** Modelli Gemini esclusi (quota finita) ancora validi per la chiave con questa impronta. */
function leggiEsclusiGemini(raw, impronta, adessoMs) {
  const o = _leggiEsclusi(raw);
  if (!o || o.impronta !== impronta) return [];
  return Object.keys(o.modelli).filter(k => typeof o.modelli[k] === 'number' && o.modelli[k] > adessoMs);
}
/** Aggiunge `modello` agli esclusi fino a `finoMs`; un'impronta diversa (chiave cambiata) riparte da zero. */
function aggiungiEsclusoGemini(raw, impronta, modello, finoMs, adessoMs) {
  const modelli = Object.create(null);
  for (const k of leggiEsclusiGemini(raw, impronta, adessoMs)) modelli[k] = _leggiEsclusi(raw).modelli[k];
  modelli[_str(modello)] = finoMs;
  return JSON.stringify({ impronta, modelli });
}

/** Ora "da orologio" di Los Angeles per un istante (Intl gestisce l'ora legale USA). */
function _oraLosAngeles(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(ms).map(x => [x.type, x.value]));
  return { h: +p.hour, m: +p.minute, s: +p.second };
}
/** Prossima mezzanotte di Los Angeles dopo `adessoMs`: è quando Google azzera le quote giornaliere. */
function prossimaMezzanotteLosAngeles(adessoMs) {
  const o = _oraLosAngeles(adessoMs);
  const daMezzanotte = ((o.h * 60 + o.m) * 60 + o.s) * 1000 + (((adessoMs % 1000) + 1000) % 1000);
  let t = adessoMs - daMezzanotte + 24 * 3600000;
  const h = _oraLosAngeles(t).h;   // se in mezzo c'è il cambio d'ora si cade sulle 23 o sull'1
  if (h === 23) t += 3600000; else if (h === 1) t -= 3600000;
  return t;
}
/** Fino a quando non chiedere più nulla a Gemini dopo un 429 (`info` da leggiLimiteGemini). */
function finePausaGemini(info, adessoMs) {
  const tipo = info && info.tipo;
  if (tipo === 'giorno' || tipo === 'zero') return prossimaMezzanotteLosAngeles(adessoMs);
  const attesa = info && Number.isFinite(info.attesaMs) ? info.attesaMs : 60000;
  return adessoMs + attesa;
}
/** Pausa salvata (testo JSON di localStorage) ancora valida, oppure null se manca, è scaduta o è rovinata. */
function leggiPausaGemini(raw, adessoMs) {
  let o;
  try { o = JSON.parse(raw); } catch (_) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.fino !== 'number' || !Number.isFinite(o.fino) || o.fino <= adessoMs) return null;
  return { fino: o.fino, motivo: _str(o.motivo).slice(0, 200) };
}

function _messaggio429(info, d) {
  const mod = info && info.modello ? '"' + info.modello + '"' : '';
  const lim = info && Number.isFinite(info.limite) ? info.limite : null;
  switch (info && info.tipo) {
    case 'zero': return 'il modello ' + (mod ? mod + ' ' : '') + 'non è incluso nel piano gratuito della tua chiave (limite 0)';
    case 'giorno': return 'quota giornaliera gratuita esaurita' + (lim !== null ? ' (' + lim + ' richieste al giorno' + (mod ? ' per ' + mod : '') + ')' : (mod ? ' (' + mod + ')' : ''));
    case 'minuto': return 'troppe richieste in un minuto' + (lim !== null ? ' (limite ' + lim + ' al minuto)' : '');
    default: return 'quota gratuita esaurita o troppe richieste' + (d ? ' (' + d + ')' : '');
  }
}

/** Messaggio comprensibile per un errore HTTP dell'API Gemini (mai contiene la chiave). Per il 429, `info` da leggiLimiteGemini. */
function messaggioErroreGemini(status, dettaglio, info) {
  const d = String(dettaglio || '').slice(0, 160);
  if (status === 400 && /api key|api_key/i.test(d)) return 'chiave API non valida: controllala in Impostazioni';
  if (status === 400) return 'richiesta rifiutata da Gemini' + (d ? ' (' + d + ')' : '');
  if (status === 401 || status === 403) return 'chiave API non autorizzata o non abilitata per questo modello';
  if (status === 404) return 'modello non trovato' + (d ? ' (' + d + ')' : '') + ': controlla il nome del modello in Impostazioni';
  if (status === 429) return _messaggio429(info, d);
  if (status >= 500) return 'servizio Gemini temporaneamente non disponibile';
  return 'errore Gemini ' + status;
}

/**
 * I modelli Gemini 3.x e gli alias *-latest "ragionano" prima di rispondere (livello medio/alto di
 * default): con foto e risposta JSON possono impiegare più dell'attesa dell'app. Per leggere uno
 * scontrino basta un ragionamento minimo. Per gli altri modelli restituisce `corpo` tale e quale
 * (stesso oggetto), perché i 2.x usano un'altra opzione e rifiuterebbero questa.
 */
function conRagionamentoRidotto(corpo, modello) {
  if (!/^gemini-(?:3|flash-latest|flash-lite-latest)/i.test(String(modello || ''))) return corpo;
  return { ...corpo, generationConfig: { ...(corpo.generationConfig || {}), thinkingConfig: { thinkingLevel: 'low' } } };
}
/** Un 400 che cita il "thinking": il modello non accetta il livello di ragionamento, si riprova senza. */
function erroreRagionamentoGemini(status, dettaglio) {
  return status === 400 && /thinking/i.test(String(dettaglio || ''));
}
function _tokenNome(s) { return normTesto(s).split(' ').filter(Boolean); }
/**
 * Quanto la lettura `letta` coincide con il riferimento `rif` (entrambe: [{prodotto, prezzo}]).
 * Una riga coincide se il prezzo è uguale e i nomi hanno almeno una parola con le stesse prime 3 lettere.
 */
function confrontaLetture(letta, rif) {
  const usate = new Set(); let uguali = 0;
  rif.forEach(r => {
    const tr = _tokenNome(r.prodotto);
    for (let i = 0; i < letta.length; i++) {
      if (usate.has(i) || Math.abs(round2(letta[i].prezzo) - round2(r.prezzo)) > 0.005) continue;
      const tl = _tokenNome(letta[i].prodotto);
      const nomeOk = !tr.length || !tl.length || tr.some(a => tl.some(b => a.slice(0, 3) === b.slice(0, 3)));
      if (nomeOk) { usate.add(i); uguali++; break; }
    }
  });
  const tot = Math.max(letta.length, rif.length);
  return { righeRif: rif.length, righeLette: letta.length, righeUguali: uguali, accuratezza: tot ? uguali / tot : 1 };
}
/** Accuratezza media dell'OCR locale sugli ultimi `n` casi (con lettura OCR e riferimento finale). */
function statisticheOcr(casi, n = 20) {
  const validi = casi.filter(c => Array.isArray(c.ocrRighe) && Array.isArray(c.finaleRighe) && c.finaleRighe.length)
    .sort((a, b) => String(a.creato).localeCompare(String(b.creato))).slice(-n);
  if (!validi.length) return { n: 0, accuratezza: null, totaleOk: null };
  const acc = validi.map(c => confrontaLetture(c.ocrRighe, c.finaleRighe).accuratezza);
  const totOk = validi.filter(c => Number.isFinite(c.ocrTotale) && Math.abs(c.ocrTotale - c.totaleFinale) <= 0.01).length;
  return { n: validi.length, accuratezza: acc.reduce((a, b) => a + b, 0) / acc.length, totaleOk: totOk / validi.length };
}

/** Nome prodotto senza il suffisso "(lordo X − sconto Y)" che l'anteprima aggiunge. */
function nomeProdottoPulito(s) { return String(s ?? '').replace(/\s*\(lordo [^)]*\)\s*$/i, '').replace(/\s+/g, ' ').trim(); }

/** Aggrega righe prodotto [{prodotto, categoria, prezzo, negozio, data}] per categoria, negozio e prodotto. */
function aggregaProdotti(righe) {
  const cat = new Map(), neg = new Map(), prod = new Map();
  righe.forEach(r => {
    const prezzo = round2(_num(r.prezzo)); if (prezzo <= 0) return;
    const nome = nomeProdottoPulito(r.prodotto), chiave = normTesto(nome) || nome.toLowerCase();
    const negozio = _str(r.negozio).trim() || '—', categoria = _str(r.categoria, 'Altro') || 'Altro';
    const c = cat.get(categoria) || { categoria, totale: 0, n: 0 }; c.totale = round2(c.totale + prezzo); c.n++; cat.set(categoria, c);
    const n = neg.get(negozio) || { negozio, totale: 0, n: 0 }; n.totale = round2(n.totale + prezzo); n.n++; neg.set(negozio, n);
    const p = prod.get(chiave) || { chiave, prodotto: nome, categoria, n: 0, totale: 0, min: Infinity, max: 0, ultimo: 0, ultimaData: '', ultimoNegozio: '', negozi: {} };
    p.n++; p.totale = round2(p.totale + prezzo); p.min = Math.min(p.min, prezzo); p.max = Math.max(p.max, prezzo);
    if (String(r.data) >= p.ultimaData) { p.ultimaData = String(r.data); p.ultimo = prezzo; p.ultimoNegozio = negozio; }
    const pn = Object.prototype.hasOwnProperty.call(p.negozi, negozio) ? p.negozi[negozio] : { min: Infinity, n: 0 };
    pn.min = Math.min(pn.min, prezzo); pn.n++;
    Object.defineProperty(p.negozi, negozio, { value: pn, enumerable: true, writable: true, configurable: true });
    prod.set(chiave, p);
  });
  const perProdotto = [...prod.values()].sort((a, b) => b.totale - a.totale);
  const risparmi = perProdotto.filter(p => Object.keys(p.negozi).length >= 2).map(p => {
    const [nMin, vMin] = Object.entries(p.negozi).sort((a, b) => a[1].min - b[1].min)[0];
    return { prodotto: p.prodotto, negozioMin: nMin, prezzoMin: vMin.min, negozioUltimo: p.ultimoNegozio, prezzoUltimo: p.ultimo, delta: round2(p.ultimo - vMin.min) };
  }).filter(x => x.delta > 0.01 && x.negozioMin !== x.negozioUltimo).sort((a, b) => b.delta - a.delta);
  return {
    perCategoria: [...cat.values()].sort((a, b) => b.totale - a.totale),
    perNegozio: [...neg.values()].sort((a, b) => b.totale - a.totale),
    perProdotto, risparmi,
    totale: round2([...cat.values()].reduce((a, c) => a + c.totale, 0))
  };
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
    parseCSV, parseImportoBanca, parseDataBanca, normTesto, rilevaColonne, estraiMovimentiBanca, trovaDoppione, chiaveRegola, indovinaVoce,
    costruisciRichiestaGroq, testoRispostaGroq, scegliModelloGroq, durataGroqMs, classificaErroreGroq, leggiConfigGroq, aggiornaConfigGroq, leggiPausaGroq, configDaVecchiaIA,
    costruisciRichiestaGemini, normalizzaRispostaGemini, promptScontrino, normalizzaRispostaIA, controlloTotale, sommaAttesaLettura, costruisciRichiestaOpenRouter, testoRispostaOpenRouter, scegliModelloOpenRouter, messaggioErroreOpenRouter, messaggioErroreGemini, conRagionamentoRidotto, erroreRagionamentoGemini, scegliModelloGemini, leggiLimiteGemini, improntaChiave, quotaModelloFinita, leggiEsclusiGemini, aggiungiEsclusoGemini, prossimaMezzanotteLosAngeles, finePausaGemini, leggiPausaGemini, confrontaLetture, statisticheOcr, nomeProdottoPulito, aggregaProdotti,
    totaleEntrateExtra, redditoTotale, redditoMese, extraAssegnata, extraDaAssegnare, calcolaAllocazione,
    stIsVoceValida, stIsOrfano, stSpesoMacro, stSpesoVoce, totaleScontrini
  };
}
