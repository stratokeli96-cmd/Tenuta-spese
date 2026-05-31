import { store } from './store.js';

/* ============================================================
   STATO + MIGRAZIONE
   ============================================================ */
const STORAGE_KEY      = 'smartFinance_v1';
const STORAGE_KEY_OLD  = 'pianoMensile_v1';

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

  // somma budget contenitori → macro
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

  // movimenti: rimappa contenitore → macro
  out.movimenti = (vecchio.movimenti || []).map(m => ({
    id: m.id,
    data: m.data,
    macro: VECCHIO_TO_MACRO[m.contenitore] || 'needs',
    voce: m.voce,
    importo: Number(m.importo) || 0,
    descrizione: m.descrizione || '',
    origine: m.origine || 'manuale'
  }));

  // versamenti TR diventano movimenti su savings/tr-fisso
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

  // scontrini + righe prodotto: come sono
  out.scontrini = (vecchio.scontrini || []).map(s => ({ ...s, origine:'manuale' }));
  out.righeProdotto = vecchio.righeProdotto || [];
  out.storicoProdotti = vecchio.storicoProdotti || {};

  // saldo riportato
  const sr = vecchio.saldoRiportato || {};
  out.saldoRiportato = {
    needs:   (Number(sr['needs-correnti'])||0) + (Number(sr['cuscinetto-needs'])||0),
    wants:   (Number(sr['cuscinetto-wants'])||0),
    savings: (Number(sr['trade-republic'])||0)
  };

  // archivio mesi: rimappa
  out.archivioMesi = (vecchio.archivioMesi || []).map(m => ({
    mese: m.mese,
    spesoNeeds:   (Number(m.spesoNeedsCorrenti)||0) + (Number(m.spesoCuscinettoNeeds)||0),
    spesoWants:   (Number(m.spesoCartaWants)||0)    + (Number(m.spesoCuscinettoWants)||0),
    versatoSavings: Number(m.versatoTR)||0,
    avanzoVerso: Number(m.avanzoWants)||0
  }));

  return out;
}

function caricaStato() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Object.assign({}, JSON.parse(JSON.stringify(STATO_DEFAULT)), parsed);
    }
    // prova lo schema vecchio
    const rawOld = localStorage.getItem(STORAGE_KEY_OLD);
    if (rawOld) {
      const vecchio = JSON.parse(rawOld);
      if (rilevaVecchioSchema(vecchio)) {
        const migrato = migraDaVecchioSchema(vecchio);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrato));
        return migrato;
      }
    }
  } catch(e) {
    console.error('caricaStato:', e);
  }
  return JSON.parse(JSON.stringify(STATO_DEFAULT));
}

function salvaStato() {
  try { store.persist(stato); }
  catch(e) { toast('Errore salvataggio: '+e.message, 'danger'); }
}

let stato = caricaStato();
let vistaCorrente = 'dashboard';

// Applica uno stato arrivato dal cloud (onSnapshot) e ridisegna la vista attiva.
function applyRemoteState(s) {
  stato = Object.assign({}, JSON.parse(JSON.stringify(STATO_DEFAULT)), s);
  aggiornaEtichetteMese();
  rerenderVistaCorrente();
}
function rerenderVistaCorrente() {
  const fn = VIEW_RENDERERS[vistaCorrente];
  if (fn) fn();
}
function aggiornaEtichetteMese() {
  const a = document.getElementById('current-month-label');
  const b = document.getElementById('reddito-display');
  if (a) a.textContent = stato.meseCorrente;
  if (b) b.textContent = fmtRound(stato.reddito);
}

/* ============================================================
   UTILITY
   ============================================================ */
const fmt = (n) => {
  const num = Number(n) || 0;
  return '€ ' + num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtRound = (n) => '€ ' + Math.round(Number(n) || 0).toLocaleString('it-IT');
const fmtData = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
};
const oggi = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const MACRO_COLOR = { needs: '#d4a24a', wants: '#c98a2e', savings: '#6b8e5a' };
const MACRO_LABEL = { needs: 'Needs', wants: 'Wants', savings: 'Savings' };

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, kind = 'info', ms = 3000) {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ============================================================
   MODAL
   ============================================================ */
let modalAction = null;
function apriModal(titolo, testo, azione) {
  document.getElementById('modal-titolo').textContent = titolo;
  document.getElementById('modal-testo').textContent = testo;
  modalAction = azione;
  document.getElementById('modal-confirm').classList.add('active');
}
function chiudiModal() {
  document.getElementById('modal-confirm').classList.remove('active');
  modalAction = null;
}
document.getElementById('modal-annulla').addEventListener('click', chiudiModal);
document.getElementById('modal-conferma').addEventListener('click', () => {
  if (modalAction) modalAction();
  chiudiModal();
});

/* ============================================================
   CALCOLI
   ============================================================ */
function spesoMacro(macroId) {
  let s = stato.movimenti
    .filter(m => m.macro === macroId)
    .reduce((acc, m) => acc + Number(m.importo), 0);
  if (macroId === 'needs') {
    s += stato.scontrini.reduce((acc, sc) => acc + Number(sc.totale), 0);
  }
  return s;
}
function spesoVoce(macroId, voceId) {
  let s = stato.movimenti
    .filter(m => m.macro === macroId && m.voce === voceId)
    .reduce((acc, m) => acc + Number(m.importo), 0);
  if (macroId === 'needs' && voceId === 'alimentari') {
    s += stato.scontrini.reduce((acc, sc) => acc + Number(sc.totale), 0);
  }
  return s;
}
function saldoMacro(macroId) {
  const m = stato.macros[macroId];
  const riporto = stato.saldoRiportato[macroId] || 0;
  return (m?.budget || 0) + riporto - spesoMacro(macroId);
}
function totBudget() {
  return Object.values(stato.macros).reduce((a, m) => a + (Number(m.budget)||0), 0);
}
function totSpeso() {
  return ['needs','wants','savings'].reduce((a, id) => a + spesoMacro(id), 0);
}

/* ============================================================
   NAVIGAZIONE
   ============================================================ */
const VIEW_RENDERERS = {
  dashboard: renderDashboard,
  needs:     () => renderMacroPage('needs'),
  wants:     () => renderMacroPage('wants'),
  savings:   () => renderMacroPage('savings'),
  inserimento: renderInserimento,
  scontrino:   renderScontrino,
  storico:     renderStorico,
  prodotti:    renderProdotti,
  'cambio-mese': renderCambioMese,
  impostazioni: renderImpostazioni
};

function navigateTo(view) {
  if (!view) return;
  vistaCorrente = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.tabbar-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  const fn = VIEW_RENDERERS[view];
  if (fn) fn();
  chiudiDrawer();
  window.scrollTo({ top: 0 });
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = TITOLI[view] || 'Smart Finance';
}
const TITOLI = {
  dashboard: 'Dashboard', needs: 'Needs', wants: 'Wants', savings: 'Savings',
  inserimento: 'Nuova spesa', scontrino: 'Scontrino OCR', storico: 'Transazioni',
  prodotti: 'Prodotti', 'cambio-mese': 'Cambio mese', impostazioni: 'Impostazioni'
};
document.querySelectorAll('.nav-item, .tabbar-item').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.view));
});

/* ---- Drawer mobile + topbar ---- */
function apriDrawer()  { document.querySelector('.sidebar')?.classList.add('open'); document.getElementById('drawer-backdrop')?.classList.add('active'); }
function chiudiDrawer(){ document.querySelector('.sidebar')?.classList.remove('open'); document.getElementById('drawer-backdrop')?.classList.remove('active'); }
document.getElementById('btn-menu')?.addEventListener('click', apriDrawer);
document.getElementById('drawer-backdrop')?.addEventListener('click', chiudiDrawer);

/* ============================================================
   DASHBOARD
   ============================================================ */
let chartDonut = null;
let chartAndamento = null;
let donutState = { level: 'macro', macro: null };

function renderDashboard() {
  document.getElementById('current-month-label').textContent = stato.meseCorrente;
  document.getElementById('reddito-display').textContent = fmtRound(stato.reddito);

  const tB = totBudget();
  const tS = totSpeso();
  const tR = tB - tS + Object.values(stato.saldoRiportato).reduce((a,v)=>a+(Number(v)||0),0);

  document.getElementById('kpi-budget').textContent = fmt(tB);
  document.getElementById('kpi-budget-month').textContent = stato.meseCorrente;
  document.getElementById('kpi-speso').textContent = fmt(tS);
  document.getElementById('kpi-residuo').textContent = fmt(tR);
  document.getElementById('kpi-residuo-pct').textContent =
    (tB > 0 ? Math.round((tR / tB) * 100) : 0) + '% del budget';

  // trend speso vs mese precedente
  const prev = stato.archivioMesi[stato.archivioMesi.length - 1];
  const speseTrendEl = document.getElementById('kpi-speso-trend');
  if (prev) {
    const tSPrev = (prev.spesoNeeds||0) + (prev.spesoWants||0) + (prev.versatoSavings||0);
    const delta = tS - tSPrev;
    const pct = tSPrev > 0 ? Math.round(delta / tSPrev * 100) : 0;
    speseTrendEl.className = 'kpi-trend ' + (delta > 0 ? 'up' : 'down');
    speseTrendEl.textContent = (delta >= 0 ? '+' : '') + pct + '% vs ' + prev.mese;
  } else {
    speseTrendEl.className = 'kpi-trend';
    speseTrendEl.textContent = '— vs mese precedente';
  }

  renderMacrosRow();
  renderDonut();
  renderUltimeTx();
  renderChartAndamento();
}

function renderMacrosRow() {
  const row = document.getElementById('macros-row');
  row.innerHTML = '';
  ['needs','wants','savings'].forEach(id => {
    const m = stato.macros[id];
    const speso = spesoMacro(id);
    const budget = m.budget;
    const riporto = stato.saldoRiportato[id] || 0;
    const saldo = budget + riporto - speso;
    const pct = budget > 0 ? Math.min(100, (speso/budget)*100) : 0;
    const cls = speso > (budget + riporto) ? 'danger' : (pct >= 80 ? 'warning' : '');

    const card = document.createElement('div');
    card.className = 'macro-card ' + id;
    card.innerHTML = `
      <div class="head">
        <div class="name">${m.nome}</div>
        <div class="pct">${Math.round(pct)}%</div>
      </div>
      <div class="amount num">${fmt(saldo)}</div>
      <div class="sub">speso ${fmt(speso)} su ${fmt(budget + riporto)}</div>
      <div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
    `;
    card.addEventListener('click', () => {
      document.querySelector(`.nav-item[data-view="${id}"]`).click();
    });
    row.appendChild(card);
  });
}

function renderDonut() {
  const ctx = document.getElementById('chart-donut');
  if (chartDonut) chartDonut.destroy();

  const center = {
    crumb: document.getElementById('donut-crumb'),
    label: document.getElementById('donut-label'),
    value: document.getElementById('donut-value')
  };
  const centerEl = document.getElementById('donut-center');
  const backBtn = document.getElementById('donut-back');
  const meta = document.getElementById('donut-meta');
  // overlay deve essere cliccabile solo al livello dettaglio (per tornare indietro)
  centerEl.style.pointerEvents = (donutState.level === 'voce') ? 'auto' : 'none';
  centerEl.style.cursor = (donutState.level === 'voce') ? 'pointer' : 'default';

  let labels, data, colors;

  if (donutState.level === 'macro') {
    labels = ['Needs','Wants','Savings'];
    data = ['needs','wants','savings'].map(id => spesoMacro(id));
    colors = ['#d4a24a','#c98a2e','#6b8e5a'];
    center.crumb.textContent = 'Totale';
    center.label.textContent = stato.meseCorrente;
    center.value.textContent = fmt(data.reduce((a,b)=>a+b,0));
    backBtn.style.display = 'none';
    meta.textContent = 'macro · click su una fetta per il dettaglio';
  } else {
    const m = stato.macros[donutState.macro];
    labels = m.voci.map(v => v.nome);
    data = m.voci.map(v => spesoVoce(m.id, v.id));
    const base = MACRO_COLOR[m.id];
    colors = m.voci.map((_,i) => shadeColor(base, i, m.voci.length));
    center.crumb.textContent = 'Dettaglio';
    center.label.textContent = m.nome;
    center.value.textContent = fmt(data.reduce((a,b)=>a+b,0));
    backBtn.style.display = '';
    meta.textContent = m.nome + ' · click al centro o sul bottone per tornare';
  }

  chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: '#0c0c0e',
        borderWidth: 3,
        hoverOffset: 12,
        hoverBorderColor: '#16161a'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      animation: { animateRotate: true, duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#9a978f', font: { family: 'Inter', size: 11 }, boxWidth: 10, padding: 10 }
        },
        tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + fmt(ctx.parsed) } }
      },
      onClick: (evt, els) => {
        if (donutState.level === 'macro' && els.length) {
          const i = els[0].index;
          donutState = { level: 'voce', macro: ['needs','wants','savings'][i] };
          renderDonut();
        }
      }
    }
  });
}

function shadeColor(hex, idx, total) {
  // varia leggermente HSL: keep H, varia L tra 35% e 65%
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2/255;
  const d = (max-min)/255;
  if (d === 0) { h=0; s=0; }
  else {
    s = d / (1 - Math.abs(2*l - 1));
    switch(max) {
      case r: h = ((g-b)/255/d + (g<b?6:0)); break;
      case g: h = ((b-r)/255/d + 2); break;
      case b: h = ((r-g)/255/d + 4); break;
    }
    h *= 60;
  }
  const lightShift = 0.30 + (idx/Math.max(1,total-1)) * 0.40;
  return hslToHex(h, Math.max(0.4, s), lightShift);
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs(((h/60)%2) - 1));
  const m = l - c/2;
  let r,g,b;
  if      (h<60)  { r=c; g=x; b=0; }
  else if (h<120) { r=x; g=c; b=0; }
  else if (h<180) { r=0; g=c; b=x; }
  else if (h<240) { r=0; g=x; b=c; }
  else if (h<300) { r=x; g=0; b=c; }
  else            { r=c; g=0; b=x; }
  const toHex = v => Math.round((v+m)*255).toString(16).padStart(2,'0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

document.getElementById('donut-back').addEventListener('click', () => {
  donutState = { level: 'macro', macro: null };
  renderDonut();
});
document.getElementById('donut-center').addEventListener('click', () => {
  if (donutState.level === 'voce') {
    donutState = { level: 'macro', macro: null };
    renderDonut();
  }
});

function renderUltimeTx() {
  const lista = document.getElementById('ultime-tx');
  const tx = [];
  stato.movimenti.forEach(m => {
    const macro = stato.macros[m.macro];
    const v = macro?.voci.find(v => v.id === m.voce);
    tx.push({
      data: m.data,
      desc: m.descrizione || (v?.nome || ''),
      voce: (macro?.nome || '') + ' · ' + (v?.nome || m.voce),
      macroId: m.macro,
      origine: m.origine || 'manuale',
      importo: m.importo
    });
  });
  stato.scontrini.forEach(s => {
    tx.push({
      data: s.data,
      desc: s.negozio + (s.localita ? ' (' + s.localita + ')' : ''),
      voce: 'Needs · Alimentari',
      macroId: 'needs',
      origine: s.origine || 'manuale',
      importo: s.totale
    });
  });
  tx.sort((a,b) => b.data.localeCompare(a.data));
  const ultime = tx.slice(0, 6);

  if (ultime.length === 0) {
    lista.innerHTML = '<li class="empty-state">Nessuna transazione</li>';
    return;
  }

  lista.innerHTML = ultime.map(t => `
    <li class="tx-item">
      <span class="tx-date">${fmtData(t.data)}</span>
      <div>
        <div class="tx-desc">
          ${escapeHtml(t.desc || '—')}
          <span class="badge ${t.macroId}">${MACRO_LABEL[t.macroId]||''}</span>
          ${t.origine === 'ocr' ? '<span class="badge ocr">OCR</span>' : ''}
        </div>
        <div class="tx-voce">${escapeHtml(t.voce)}</div>
      </div>
      <span class="tx-amount num">${fmt(t.importo)}</span>
    </li>
  `).join('');
}

function renderChartAndamento() {
  if (chartAndamento) { try { chartAndamento.destroy(); } catch(e){} chartAndamento = null; }
  let ctx = document.getElementById('chart-andamento');
  const wrap = ctx ? ctx.parentElement : document.querySelector('#view-dashboard .card:last-child > div:last-child');
  if (!wrap) return;
  if (stato.archivioMesi.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Nessun mese archiviato. Il trend appare dopo il primo cambio mese.</div>';
    return;
  }
  if (!document.getElementById('chart-andamento')) {
    wrap.innerHTML = '<canvas id="chart-andamento"></canvas>';
  }
  const ctx2 = document.getElementById('chart-andamento');
  const mesi = stato.archivioMesi.map(m => m.mese);
  chartAndamento = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: mesi,
      datasets: [
        { label: 'Needs',   data: stato.archivioMesi.map(m => m.spesoNeeds   || 0), borderColor: '#d4a24a', backgroundColor: '#d4a24a22', tension: 0.35, borderWidth: 2, fill: true },
        { label: 'Wants',   data: stato.archivioMesi.map(m => m.spesoWants   || 0), borderColor: '#c98a2e', backgroundColor: '#c98a2e22', tension: 0.35, borderWidth: 2, fill: true },
        { label: 'Savings', data: stato.archivioMesi.map(m => m.versatoSavings || 0), borderColor: '#6b8e5a', backgroundColor: '#6b8e5a22', tension: 0.35, borderWidth: 2, fill: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#9a978f', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#9a978f' }, grid: { color: '#232326' } },
        y: { ticks: { color: '#9a978f', callback: (v) => '€' + v }, grid: { color: '#232326' } }
      }
    }
  });
}

/* ============================================================
   MACRO PAGE TEMPLATE
   ============================================================ */
let treemapChart = null;
let gaugeAnim = null;

function renderMacroPage(macroId) {
  const m = stato.macros[macroId];
  const speso = spesoMacro(macroId);
  const riporto = stato.saldoRiportato[macroId] || 0;
  const saldo = m.budget + riporto - speso;
  const pct = m.budget > 0 ? Math.min(100, (speso/(m.budget+riporto))*100) : 0;

  const cont = document.getElementById('view-' + macroId);
  cont.innerHTML = `
    <div class="page-header">
      <h1 class="page-title" style="display:flex; align-items:center; gap:14px;">
        <span style="width:14px; height:14px; border-radius:50%; background:${MACRO_COLOR[macroId]}; display:inline-block;"></span>
        ${m.nome}
      </h1>
      <p class="page-subtitle">${macroId === 'needs' ? 'Spese essenziali. Il taglio del reddito non le tocca.' :
        macroId === 'wants' ? 'Spese discrezionali. Stile di vita.' :
        'Capitale di accumulo. Investimenti, fondo emergenza, obiettivi.'}</p>
    </div>

    <div class="macro-header">
      <div class="macro-stats">
        <div class="stat-cell"><div class="lbl">Budget</div><div class="val num">${fmt(m.budget + riporto)}</div></div>
        <div class="stat-cell"><div class="lbl">Speso</div><div class="val num ${speso > m.budget + riporto ? 'danger' : ''}">${fmt(speso)}</div></div>
        <div class="stat-cell"><div class="lbl">${macroId === 'savings' ? 'Da versare' : 'Residuo'}</div><div class="val num ${saldo < 0 ? 'danger' : 'success'}">${fmt(saldo)}</div></div>
      </div>
      <div class="gauge-card">
        <canvas id="gauge-${macroId}" width="160" height="160"></canvas>
        <div class="gauge-label">${Math.round(pct)}% utilizzato</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">
        Composizione spese
        <span class="section-meta">treemap delle sotto-voci</span>
      </div>
      <div class="treemap-wrap"><canvas id="treemap-${macroId}"></canvas></div>
    </div>

    <div class="card">
      <div class="section-title">
        Dettaglio voci
        <span class="section-meta">${m.voci.length} voci</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Voce</th>
              <th style="text-align:right;">Budget €</th>
              <th style="text-align:right;">Speso €</th>
              <th style="text-align:right;">Residuo €</th>
              <th style="width:24%;">%</th>
            </tr>
          </thead>
          <tbody>
            ${m.voci.map(v => {
              const sp = spesoVoce(macroId, v.id);
              const rs = v.budget - sp;
              const p = v.budget > 0 ? Math.min(100, (sp/v.budget)*100) : 0;
              const fillClass = sp > v.budget ? 'danger' : (p >= 80 ? 'warning' : '');
              return `
                <tr>
                  <td>${escapeHtml(v.nome)}</td>
                  <td class="amount-cell">${fmt(v.budget)}</td>
                  <td class="amount-cell">${fmt(sp)}</td>
                  <td class="amount-cell" style="color:${rs<0?'var(--danger)':'var(--text)'};">${fmt(rs)}</td>
                  <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <div class="bar-inline"><div class="bar-inline-fill ${fillClass}" style="width:${p}%; background:${fillClass==='danger'?'var(--danger)':fillClass==='warning'?'var(--warning)':MACRO_COLOR[macroId]};"></div></div>
                      <span class="num" style="font-size:11px; color:var(--text-muted); min-width:36px; text-align:right;">${Math.round(p)}%</span>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  drawGauge(`gauge-${macroId}`, pct, MACRO_COLOR[macroId]);
  drawTreemap(`treemap-${macroId}`, macroId);
}

function drawGauge(canvasId, pct, color) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const cx = W/2, cy = H/2 + 10;
  const radius = 60;
  const start = Math.PI * 0.8;
  const end   = Math.PI * 2.2;
  const targetAngle = start + (end - start) * (pct/100);

  let current = 0;
  if (gaugeAnim) cancelAnimationFrame(gaugeAnim);
  function frame() {
    current += (targetAngle - start) * 0.08;
    const cur = Math.min(targetAngle, start + current);
    ctx.clearRect(0,0,W,H);
    // track
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#2a2a30';
    ctx.lineCap = 'round';
    ctx.stroke();
    // value arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, cur);
    ctx.strokeStyle = pct > 100 ? '#c14a4a' : (pct >= 80 ? '#c98a2e' : color);
    ctx.stroke();
    // text
    ctx.fillStyle = '#ece9e2';
    ctx.font = '600 22px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(pct) + '%', cx, cy - 4);
    if (cur < targetAngle - 0.001) {
      gaugeAnim = requestAnimationFrame(frame);
    }
  }
  frame();
}

function drawTreemap(canvasId, macroId) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (treemapChart) { try { treemapChart.destroy(); } catch(e){} }
  const m = stato.macros[macroId];
  const data = m.voci
    .map(v => ({ nome: v.nome, valore: spesoVoce(macroId, v.id), budget: v.budget }))
    .filter(d => d.valore > 0);

  if (data.length === 0) {
    ctx.parentElement.innerHTML = '<div class="empty-state">Nessuna spesa registrata su questa macro.</div>';
    return;
  }

  const base = MACRO_COLOR[macroId];
  treemapChart = new Chart(ctx, {
    type: 'treemap',
    data: {
      datasets: [{
        tree: data,
        key: 'valore',
        backgroundColor: (c) => {
          if (c.type !== 'data') return 'transparent';
          const i = c.dataIndex;
          return shadeColor(base, i, data.length);
        },
        borderColor: '#0c0c0e',
        borderWidth: 2,
        spacing: 2,
        labels: {
          display: true,
          color: '#fff',
          font: { family: 'Inter', size: 12, weight: '600' },
          formatter: (c) => {
            const d = c.raw._data;
            return [d.nome, fmt(d.valore)];
          },
          align: 'left',
          position: 'top'
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].raw._data.nome,
            label: (item) => 'Speso: ' + fmt(item.raw._data.valore) + ' / Budget: ' + fmt(item.raw._data.budget)
          }
        }
      }
    }
  });
}

/* ============================================================
   INSERIMENTO SPESA
   ============================================================ */
function renderInserimento() {
  const sel = document.getElementById('sp-macro');
  if (sel.options.length === 0) {
    sel.innerHTML = ['needs','wants','savings']
      .map(id => `<option value="${id}">${stato.macros[id].nome}</option>`).join('');
    sel.addEventListener('change', popolaSelectVoci);
  }
  popolaSelectVoci();
  if (!document.getElementById('sp-data').value) {
    document.getElementById('sp-data').value = oggi();
  }
}
function popolaSelectVoci() {
  const macroId = document.getElementById('sp-macro').value;
  const macro = stato.macros[macroId];
  const sel = document.getElementById('sp-voce');
  sel.innerHTML = (macro?.voci || []).map(v => `<option value="${v.id}">${v.nome}</option>`).join('');
}

document.getElementById('btn-aggiungi-spesa').addEventListener('click', () => {
  const data = document.getElementById('sp-data').value;
  const macro = document.getElementById('sp-macro').value;
  const voce = document.getElementById('sp-voce').value;
  const importo = parseFloat(document.getElementById('sp-importo').value);
  const descrizione = document.getElementById('sp-descrizione').value.trim();

  if (!data || !macro || !voce || isNaN(importo) || importo <= 0) {
    toast('Compila data, macro, voce e importo valido.', 'warning');
    return;
  }
  if (macro === 'needs' && voce === 'alimentari') {
    if (!confirm('Stai registrando una spesa Alimentari come singola. Per gli scontrini è meglio usare il modulo OCR. Procedere comunque?')) return;
  }

  stato.movimenti.push({
    id: uid(), data, macro, voce, importo, descrizione, origine: 'manuale'
  });
  salvaStato();
  document.getElementById('sp-importo').value = '';
  document.getElementById('sp-descrizione').value = '';
  toast('Spesa registrata: ' + fmt(importo), 'success');
});

/* ============================================================
   SCONTRINO OCR
   ============================================================ */
const CATEGORIE_ALIMENTARI = [
  'Verdura', 'Frutta', 'Carne/Salumi', 'Pesce', 'Latticini',
  'Surgelati', 'Dispensa', 'Panetteria', 'Bevande', 'Bevande/Alcolici',
  'Igiene/Casa', 'Altro'
];

let ocrText = '';

function renderScontrino() {
  if (!document.getElementById('sc-data').value) {
    document.getElementById('sc-data').value = oggi();
  }
  if (document.querySelectorAll('#scontrino-rows .scontrino-row').length === 0) {
    aggiungiRigaScontrino();
  }
  aggiornaTotaleScontrino();
}

function aggiungiRigaScontrino(prodotto = '', categoria = 'Altro', prezzo = '') {
  const wrap = document.getElementById('scontrino-rows');
  const div = document.createElement('div');
  div.className = 'scontrino-row';
  div.innerHTML = `
    <input type="text" class="sr-prodotto" placeholder="Nome prodotto" value="${escapeHtml(prodotto)}" />
    <select class="sr-categoria">
      ${CATEGORIE_ALIMENTARI.map(c => `<option ${c===categoria?'selected':''}>${c}</option>`).join('')}
    </select>
    <input type="number" step="0.01" min="0" class="sr-prezzo" placeholder="0.00" value="${prezzo}" />
    <button class="btn-icon-danger sr-rimuovi" title="Rimuovi">×</button>
  `;
  wrap.appendChild(div);
  div.querySelector('.sr-rimuovi').addEventListener('click', () => {
    div.remove();
    aggiornaTotaleScontrino();
  });
  div.querySelector('.sr-prezzo').addEventListener('input', aggiornaTotaleScontrino);
}

function aggiornaTotaleScontrino() {
  const inputs = document.querySelectorAll('#scontrino-rows .sr-prezzo');
  let tot = 0;
  inputs.forEach(i => { tot += parseFloat(i.value) || 0; });
  document.getElementById('sc-totale').textContent = fmt(tot);
}

document.getElementById('btn-add-row').addEventListener('click', () => aggiungiRigaScontrino());

document.getElementById('btn-reset-scontrino').addEventListener('click', () => {
  document.getElementById('scontrino-rows').innerHTML = '';
  document.getElementById('sc-negozio').value = '';
  document.getElementById('sc-localita').value = '';
  document.getElementById('sc-data').value = oggi();
  aggiungiRigaScontrino();
  aggiornaTotaleScontrino();
  document.getElementById('ocr-debug').textContent = '';
  ocrText = '';
});

document.getElementById('btn-toggle-debug').addEventListener('click', () => {
  const dbg = document.getElementById('ocr-debug');
  if (dbg.style.display === 'none') {
    dbg.style.display = 'block';
    dbg.textContent = ocrText || '(nessun testo OCR ancora estratto)';
    document.getElementById('btn-toggle-debug').textContent = 'Nascondi testo OCR';
  } else {
    dbg.style.display = 'none';
    document.getElementById('btn-toggle-debug').textContent = 'Mostra testo OCR';
  }
});

// --- Drag & drop / file input ---
const ocrZone   = document.getElementById('ocr-zone');
const ocrInput  = document.getElementById('ocr-input');
const ocrProgress = document.getElementById('ocr-progress');
const ocrProgressFill = document.getElementById('ocr-progress-fill');
const ocrStatus = document.getElementById('ocr-status');
const ocrPreview = document.getElementById('ocr-preview');

ocrZone.addEventListener('click', () => ocrInput.click());
ocrZone.addEventListener('dragover', e => { e.preventDefault(); ocrZone.classList.add('drag'); });
ocrZone.addEventListener('dragleave', () => ocrZone.classList.remove('drag'));
ocrZone.addEventListener('drop', e => {
  e.preventDefault();
  ocrZone.classList.remove('drag');
  if (e.dataTransfer.files.length) gestisciFileOCR(e.dataTransfer.files[0]);
});
ocrInput.addEventListener('change', e => {
  if (e.target.files.length) gestisciFileOCR(e.target.files[0]);
});

async function gestisciFileOCR(file) {
  ocrPreview.classList.remove('active');
  ocrProgress.classList.add('active');
  ocrProgressFill.style.width = '0%';
  ocrStatus.textContent = 'Caricamento file…';

  try {
    let imageDataUrl;
    if (file.type === 'application/pdf') {
      ocrStatus.textContent = 'Rendering PDF…';
      imageDataUrl = await renderPdfFirstPage(file);
    } else {
      imageDataUrl = await fileToDataUrl(file);
    }

    ocrStatus.textContent = 'OCR in corso…';
    if (typeof Tesseract === 'undefined') {
      throw new Error('Libreria OCR non caricata (offline?). Inserisci i prodotti manualmente.');
    }
    const result = await Tesseract.recognize(imageDataUrl, 'ita', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          ocrProgressFill.style.width = pct + '%';
          ocrStatus.textContent = 'Riconoscimento testo… ' + pct + '%';
        } else if (m.status) {
          ocrStatus.textContent = m.status;
        }
      }
    });
    ocrText = result.data.text || '';
    ocrProgressFill.style.width = '100%';
    ocrStatus.textContent = 'Estrazione campi…';

    const parsed = parseScontrino(ocrText);
    popolaPreviewDaParser(parsed);

    ocrPreview.classList.add('active');
    setTimeout(() => { ocrProgress.classList.remove('active'); ocrStatus.textContent = ''; }, 600);
    toast(`OCR completato: ${parsed.righe.length} righe estratte`, 'success');
  } catch(e) {
    console.error(e);
    ocrStatus.textContent = '';
    ocrProgress.classList.remove('active');
    toast('OCR fallito: ' + e.message, 'danger', 5000);
    // mostra comunque la preview vuota per inserimento manuale
    ocrPreview.classList.add('active');
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function renderPdfFirstPage(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js non caricato');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toDataURL('image/png');
}

/* ---------- Parser scontrini italiani ---------- */
function parseScontrino(txt) {
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result = { negozio: '', localita: '', data: '', totale: 0, righe: [] };

  // Insegna: prima riga "lunga maiuscola"
  for (const l of lines) {
    if (l.length >= 4 && l.length <= 40 && /^[A-Z][A-Z\s\.&'\-0-9]+$/.test(l)) {
      result.negozio = capitalize(l);
      break;
    }
  }

  // Data dd/mm/yy(yy) o dd-mm-yyyy o dd.mm.yyyy
  for (const l of lines) {
    const md = l.match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{2,4})/);
    if (md) {
      let [_, dd, mm, yy] = md;
      if (yy.length === 2) yy = (parseInt(yy) > 50 ? '19' : '20') + yy;
      const iso = `${yy}-${mm}-${dd}`;
      if (!isNaN(new Date(iso).getTime())) {
        result.data = iso;
        break;
      }
    }
  }

  // Pattern: nome prodotto + prezzo a fine riga (1,99 / 1.99 / 12,50 con eventuale segno/qtà)
  const PRICE_RE = /([\-]?\d{1,4}[.,]\d{2})\s*([A-Z]{0,2})?\s*$/;
  const SKIP_RE = /^(IVA|RESTO|CONTANTI|CONTANTE|CARTA|BANCOMAT|POS|SUBTOT|SUB[- ]?TOTALE|TOTALE\s*COMPLESSIVO|N\.?\s*ARTIC|N\.?\s*PEZZI|SCONTRINO|DOC|RT|MATRIC|C\.?F\.?|P\.?\s*IVA|CASSA|OPERAT|CASSIERE|FIDELITY|PUNTI|BARCODE|GRAZIE|CODICE|TICKET|EAN)/i;
  const TOTAL_RE = /^(TOTALE|TOT\.?|EURO|TOT\s+EURO|TOTALE\s+EURO|TOT\s+VENDITA|VENDITA)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const lUp = l.toUpperCase();

    // totale finale
    if (TOTAL_RE.test(lUp) && !/SUB/.test(lUp)) {
      const m = l.match(PRICE_RE);
      if (m) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (!isNaN(v)) result.totale = Math.max(result.totale, Math.abs(v));
      }
      continue;
    }

    if (SKIP_RE.test(lUp)) continue;

    const m = l.match(PRICE_RE);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (isNaN(v) || v <= 0 || v > 999) continue;
      // estrai nome: tutto prima del prezzo
      const nomeRaw = l.slice(0, m.index).trim().replace(/[\s,;:]+$/, '');
      // filtra righe che sono solo numeri o quantità tipo "2x1,99"
      if (!nomeRaw || /^\d/.test(nomeRaw) || nomeRaw.length < 2) continue;
      result.righe.push({
        prodotto: capitalize(nomeRaw),
        categoria: indovinaCategoria(nomeRaw),
        prezzo: v
      });
    }
  }

  // se il totale non è stato trovato, prendi la somma
  if (!result.totale && result.righe.length) {
    result.totale = result.righe.reduce((a,r) => a + r.prezzo, 0);
  }
  return result;
}

function capitalize(s) {
  return s.toLowerCase().split(/\s+/).map(w => w.length ? w[0].toUpperCase()+w.slice(1) : w).join(' ').trim();
}

const CAT_HINTS = {
  'Verdura':       ['insalat','fungh','patat','pomod','zucch','melanz','carot','spinac','cipoll','verdur','broccol','cavol','peperon','sedan','rucol','finocch'],
  'Frutta':        ['mela','mele','pera','banan','fragol','ananas','arancia','limon','uva','pesca','albicocc','kiw','mandarin','clement','frutt','mirtill'],
  'Carne/Salumi':  ['petto','pollo','suino','manzo','vitell','bovin','salam','prosciut','procrudo','wurstel','salsicc','bresaol','mortadell','speck','cotech','tacchin','carne'],
  'Pesce':         ['salmon','tonno','merluz','gambero','vongol','calam','pesce','sgombr','orata','spigol','branzin','platess','sogliol','seppia'],
  'Latticini':     ['latte','mozz','formag','grana','parmig','ricott','yogurt','yog','fage','stracch','gorgon','panna','burro','crescenz'],
  'Surgelati':     ['surg','sl ','pizza marg','minestron','fagiolin'],
  'Dispensa':      ['pasta','riso','sale','zucch','olio','aceto','sugo','passata','pomodor','natu','farina','biscot','cerial','muesl','crema','marmel','miele'],
  'Panetteria':    ['pane','focacc','fett bisc','crackers','grissin','bisc'],
  'Bevande':       ['acqua','succo','spuma','cola','aranciat','the ','thè ','tisana','tonic','energy','frizz','minerale'],
  'Bevande/Alcolici':['birra','vino','prosecc','spritz','wisk','whisky','gin','vodka','rum','liquor','aperitiv','nebbiol','barolo','chianti'],
  'Igiene/Casa':   ['shopper','busta','carta ig','sapone','detersiv','detergent','sgrass','dentifr','spazzol','spugn','panno','assorb','shampoo','bagno','rotolo']
};
function indovinaCategoria(nome) {
  const n = nome.toLowerCase();
  for (const [cat, hints] of Object.entries(CAT_HINTS)) {
    if (hints.some(h => n.includes(h))) return cat;
  }
  return 'Altro';
}

function popolaPreviewDaParser(p) {
  document.getElementById('scontrino-rows').innerHTML = '';
  document.getElementById('sc-data').value = p.data || oggi();
  document.getElementById('sc-negozio').value = p.negozio || '';
  document.getElementById('sc-localita').value = '';
  if (p.righe.length === 0) {
    aggiungiRigaScontrino();
  } else {
    p.righe.forEach(r => aggiungiRigaScontrino(r.prodotto, r.categoria, r.prezzo));
  }
  aggiornaTotaleScontrino();
}

document.getElementById('btn-salva-scontrino').addEventListener('click', () => {
  const data = document.getElementById('sc-data').value;
  const negozio = document.getElementById('sc-negozio').value.trim();
  const localita = document.getElementById('sc-localita').value.trim();
  if (!data || !negozio) {
    toast('Inserisci almeno data e negozio.', 'warning');
    return;
  }
  const righe = [];
  document.querySelectorAll('#scontrino-rows .scontrino-row').forEach(row => {
    const prodotto = row.querySelector('.sr-prodotto').value.trim();
    const categoria = row.querySelector('.sr-categoria').value;
    const prezzo = parseFloat(row.querySelector('.sr-prezzo').value);
    if (prodotto && !isNaN(prezzo) && prezzo > 0) {
      righe.push({ prodotto, categoria, prezzo });
    }
  });
  if (righe.length === 0) {
    toast('Aggiungi almeno un prodotto valido.', 'warning');
    return;
  }
  const totale = righe.reduce((a,r) => a + r.prezzo, 0);
  const scontrinoId = uid();
  const origine = ocrText ? 'ocr' : 'manuale';

  stato.scontrini.push({ id: scontrinoId, data, negozio, localita, totale, origine });
  righe.forEach(r => {
    stato.righeProdotto.push({
      id: uid(), scontrinoId, data, negozio,
      prodotto: r.prodotto, categoria: r.categoria, prezzo: r.prezzo
    });
    const key = r.prodotto + '||' + r.categoria;
    if (!stato.storicoProdotti[key]) {
      stato.storicoProdotti[key] = {
        prodotto: r.prodotto, categoria: r.categoria,
        volte: 0, spesaTotale: 0, ultimoPrezzo: 0
      };
    }
    const s = stato.storicoProdotti[key];
    s.volte += 1;
    s.spesaTotale += r.prezzo;
    s.ultimoPrezzo = r.prezzo;
  });
  salvaStato();
  toast(`Scontrino salvato: ${negozio} · ${righe.length} prodotti · ${fmt(totale)}`, 'success');

  document.getElementById('btn-reset-scontrino').click();
  ocrPreview.classList.remove('active');
});

/* ============================================================
   STORICO TRANSAZIONI
   ============================================================ */
function renderStorico() {
  const fv = document.getElementById('filtro-voce');
  popolaFiltroVoci();
  applicaFiltri();
}
function popolaFiltroVoci() {
  const macro = document.getElementById('filtro-macro').value;
  const sel = document.getElementById('filtro-voce');
  sel.innerHTML = '<option value="">Tutte</option>';
  if (macro && stato.macros[macro]) {
    stato.macros[macro].voci.forEach(v => {
      sel.innerHTML += `<option value="${v.id}">${escapeHtml(v.nome)}</option>`;
    });
  }
}
document.getElementById('filtro-macro').addEventListener('change', () => { popolaFiltroVoci(); applicaFiltri(); });
document.getElementById('filtro-voce').addEventListener('change', applicaFiltri);
document.getElementById('filtro-testo').addEventListener('input', applicaFiltri);
document.getElementById('filtro-da').addEventListener('change', applicaFiltri);
document.getElementById('filtro-a').addEventListener('change', applicaFiltri);

function applicaFiltri() {
  const fMacro = document.getElementById('filtro-macro').value;
  const fVoce = document.getElementById('filtro-voce').value;
  const fTesto = document.getElementById('filtro-testo').value.toLowerCase();
  const fDa = document.getElementById('filtro-da').value;
  const fA = document.getElementById('filtro-a').value;

  const tx = [];
  stato.movimenti.forEach(m => {
    const macro = stato.macros[m.macro];
    const v = macro?.voci.find(v => v.id === m.voce);
    tx.push({
      id: m.id, data: m.data,
      macro: m.macro, macroNome: macro?.nome || '',
      voce: m.voce, voceNome: v?.nome || m.voce,
      descrizione: m.descrizione || '',
      importo: m.importo,
      origine: m.origine || 'manuale',
      tipo: 'movimento'
    });
  });
  stato.scontrini.forEach(s => {
    tx.push({
      id: s.id, data: s.data,
      macro: 'needs', macroNome: 'Needs',
      voce: 'alimentari', voceNome: 'Alimentari',
      descrizione: 'Scontrino ' + s.negozio + (s.localita ? ' · ' + s.localita : ''),
      importo: s.totale,
      origine: s.origine || 'manuale',
      tipo: 'scontrino'
    });
  });
  tx.sort((a,b) => b.data.localeCompare(a.data));

  const filtrate = tx.filter(t => {
    if (fMacro && t.macro !== fMacro) return false;
    if (fVoce && t.voce !== fVoce) return false;
    if (fTesto && !t.descrizione.toLowerCase().includes(fTesto) && !t.voceNome.toLowerCase().includes(fTesto)) return false;
    if (fDa && t.data < fDa) return false;
    if (fA && t.data > fA) return false;
    return true;
  });

  const tbody = document.getElementById('tx-body');
  if (filtrate.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nessuna transazione trovata.</td></tr>';
    return;
  }
  tbody.innerHTML = filtrate.map(t => `
    <tr>
      <td class="num">${fmtData(t.data)}</td>
      <td><span class="badge ${t.macro}">${escapeHtml(t.macroNome)}</span></td>
      <td>${escapeHtml(t.voceNome)}</td>
      <td>${escapeHtml(t.descrizione)}</td>
      <td><span class="badge ${t.origine === 'ocr' ? 'ocr' : 'manual'}">${t.origine === 'ocr' ? 'OCR' : 'manuale'}</span></td>
      <td class="amount-cell">${fmt(t.importo)}</td>
      <td><button class="btn-icon-danger" data-id="${t.id}" data-tipo="${t.tipo}">elimina</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-icon-danger').forEach(btn => {
    btn.addEventListener('click', () => confermaEliminazione(btn.dataset.id, btn.dataset.tipo));
  });
}

function confermaEliminazione(id, tipo) {
  apriModal(
    'Eliminare la transazione?',
    tipo === 'scontrino'
      ? 'Lo scontrino e i suoi prodotti verranno rimossi. Lo Storico Prodotti verrà ricalcolato.'
      : 'La transazione verrà rimossa dai movimenti del mese.',
    () => {
      if (tipo === 'movimento') {
        stato.movimenti = stato.movimenti.filter(m => m.id !== id);
      } else if (tipo === 'scontrino') {
        const righe = stato.righeProdotto.filter(r => r.scontrinoId === id);
        righe.forEach(r => {
          const key = r.prodotto + '||' + r.categoria;
          const s = stato.storicoProdotti[key];
          if (s) {
            s.volte -= 1;
            s.spesaTotale -= r.prezzo;
            if (s.volte <= 0) delete stato.storicoProdotti[key];
          }
        });
        stato.righeProdotto = stato.righeProdotto.filter(r => r.scontrinoId !== id);
        stato.scontrini = stato.scontrini.filter(s => s.id !== id);
      }
      salvaStato();
      applicaFiltri();
      toast('Transazione eliminata.', 'info');
    }
  );
}

document.getElementById('btn-export-csv').addEventListener('click', exportaCSV);
document.getElementById('btn-export-json').addEventListener('click', () => exportaJSON('transazioni'));

function exportaCSV() {
  const rows = [['Data','Macro','Voce','Descrizione','Origine','Importo']];
  stato.movimenti.forEach(m => {
    const macro = stato.macros[m.macro];
    const v = macro?.voci.find(v => v.id === m.voce);
    rows.push([m.data, macro?.nome||'', v?.nome||'', m.descrizione||'', m.origine||'manuale', m.importo.toFixed(2).replace('.',',')]);
  });
  stato.scontrini.forEach(s => {
    rows.push([s.data, 'Needs', 'Alimentari', 'Scontrino ' + s.negozio, s.origine||'manuale', s.totale.toFixed(2).replace('.',',')]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
  scaricaFile('transazioni_' + stato.meseCorrente.replace(' ','_') + '.csv', csv, 'text/csv;charset=utf-8');
}

/* ============================================================
   STORICO PRODOTTI
   ============================================================ */
let prodSort = { key: 'spesaTotale', dir: 'desc' };
let chartPareto = null;

function renderProdotti() {
  // popola filtro categorie
  const cats = new Set();
  Object.values(stato.storicoProdotti).forEach(p => cats.add(p.categoria));
  const sel = document.getElementById('filtro-categoria');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tutte</option>' + [...cats].sort().map(c => `<option ${c===cur?'selected':''}>${escapeHtml(c)}</option>`).join('');

  disegnaTabellaProdotti();
  disegnaPareto();
}

document.getElementById('cerca-prodotto').addEventListener('input', disegnaTabellaProdotti);
document.getElementById('filtro-categoria').addEventListener('change', disegnaTabellaProdotti);
document.querySelectorAll('#tabella-prodotti thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (prodSort.key === k) prodSort.dir = prodSort.dir === 'asc' ? 'desc' : 'asc';
    else { prodSort.key = k; prodSort.dir = 'asc'; }
    document.querySelectorAll('#tabella-prodotti thead th.sortable').forEach(x => x.classList.remove('asc','desc'));
    th.classList.add(prodSort.dir);
    disegnaTabellaProdotti();
  });
});

function disegnaTabellaProdotti() {
  const cerca = document.getElementById('cerca-prodotto').value.toLowerCase();
  const cat = document.getElementById('filtro-categoria').value;
  const tbody = document.getElementById('prodotti-body');
  let lista = Object.values(stato.storicoProdotti).map(p => ({
    ...p,
    prezzoMedio: p.volte > 0 ? p.spesaTotale / p.volte : 0
  }));
  if (cerca) lista = lista.filter(p => p.prodotto.toLowerCase().includes(cerca) || p.categoria.toLowerCase().includes(cerca));
  if (cat) lista = lista.filter(p => p.categoria === cat);
  lista.sort((a, b) => {
    const A = a[prodSort.key], B = b[prodSort.key];
    if (typeof A === 'string') return prodSort.dir === 'asc' ? A.localeCompare(B) : B.localeCompare(A);
    return prodSort.dir === 'asc' ? (A - B) : (B - A);
  });

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nessun prodotto. Registra uno scontrino per popolare lo storico.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td>${escapeHtml(p.prodotto)}</td>
      <td style="color: var(--text-muted);">${escapeHtml(p.categoria)}</td>
      <td class="amount-cell">${p.volte}</td>
      <td class="amount-cell">${fmt(p.spesaTotale)}</td>
      <td class="amount-cell">${fmt(p.prezzoMedio)}</td>
      <td class="amount-cell">${fmt(p.ultimoPrezzo)}</td>
    </tr>
  `).join('');
}

function disegnaPareto() {
  if (chartPareto) { try { chartPareto.destroy(); } catch(e){} chartPareto = null; }
  let ctx = document.getElementById('chart-pareto');
  const wrap = ctx ? ctx.parentElement : document.querySelector('#view-prodotti .card:first-child > div:last-child');
  if (!wrap) return;
  const lista = Object.values(stato.storicoProdotti)
    .sort((a,b) => b.spesaTotale - a.spesaTotale)
    .slice(0, 20);
  if (lista.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Nessun prodotto da analizzare.</div>';
    return;
  }
  if (!document.getElementById('chart-pareto')) {
    wrap.innerHTML = '<canvas id="chart-pareto"></canvas>';
  }
  ctx = document.getElementById('chart-pareto');
  const totale = lista.reduce((a,p) => a + p.spesaTotale, 0);
  let cum = 0;
  const cumPct = lista.map(p => { cum += p.spesaTotale; return totale > 0 ? (cum/totale)*100 : 0; });

  chartPareto = new Chart(ctx, {
    data: {
      labels: lista.map(p => p.prodotto),
      datasets: [
        {
          type: 'bar',
          label: 'Spesa €',
          data: lista.map(p => p.spesaTotale),
          backgroundColor: '#d4a24a',
          borderRadius: 4,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: 'Cumulativa %',
          data: cumPct,
          borderColor: '#6c8eb0',
          backgroundColor: '#6c8eb022',
          tension: 0.2,
          borderWidth: 2,
          yAxisID: 'y1',
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#9a978f', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.type === 'bar'
              ? 'Spesa: ' + fmt(ctx.parsed.y)
              : 'Cumulativa: ' + Math.round(ctx.parsed.y) + '%'
          }
        }
      },
      scales: {
        x: { ticks: { color: '#9a978f', maxRotation: 60, minRotation: 45, font: { size: 10 } }, grid: { display:false } },
        y: { position: 'left', ticks: { color: '#9a978f', callback: v => '€' + v }, grid: { color: '#232326' } },
        y1: { position: 'right', min: 0, max: 100, ticks: { color: '#6c8eb0', callback: v => v + '%' }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

/* ============================================================
   CAMBIO MESE
   ============================================================ */
function renderCambioMese() {
  const div = document.getElementById('chiusura-riepilogo');
  const sN = spesoMacro('needs');
  const sW = spesoMacro('wants');
  const sS = spesoMacro('savings');
  const budN = stato.macros.needs.budget + (stato.saldoRiportato.needs||0);
  const budW = stato.macros.wants.budget + (stato.saldoRiportato.wants||0);
  const avanzoW = Math.max(0, budW - sW);

  div.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
      <div><div style="color:var(--text-dim); font-size:11px; letter-spacing:0.1em; text-transform:uppercase;">Mese in chiusura</div><strong style="font-family:var(--font-display); font-size:20px;">${escapeHtml(stato.meseCorrente)}</strong></div>
      <div><div style="color:var(--text-dim); font-size:11px; letter-spacing:0.1em; text-transform:uppercase;">Needs spesi</div><strong class="num" style="font-size:18px;">${fmt(sN)}</strong> / ${fmt(budN)}</div>
      <div><div style="color:var(--text-dim); font-size:11px; letter-spacing:0.1em; text-transform:uppercase;">Wants spesi</div><strong class="num" style="font-size:18px;">${fmt(sW)}</strong> / ${fmt(budW)}</div>
      <div><div style="color:var(--text-dim); font-size:11px; letter-spacing:0.1em; text-transform:uppercase;">Savings versati</div><strong class="num" style="font-size:18px; color:var(--success);">${fmt(sS)}</strong></div>
      <div><div style="color:var(--text-dim); font-size:11px; letter-spacing:0.1em; text-transform:uppercase;">Avanzo Wants → Savings</div><strong class="num" style="font-size:18px; color:var(--accent);">${fmt(avanzoW)}</strong></div>
      <div><div style="color:var(--text-dim); font-size:11px; letter-spacing:0.1em; text-transform:uppercase;">Avanzo Needs (riserva)</div><strong class="num" style="font-size:18px;">${fmt(Math.max(0, budN - sN))}</strong></div>
    </div>
  `;

  const tbody = document.getElementById('archivio-body');
  if (stato.archivioMesi.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nessun mese archiviato.</td></tr>';
  } else {
    tbody.innerHTML = stato.archivioMesi.map(m => `
      <tr>
        <td>${escapeHtml(m.mese)}</td>
        <td class="amount-cell">${fmt(m.spesoNeeds||0)}</td>
        <td class="amount-cell">${fmt(m.spesoWants||0)}</td>
        <td class="amount-cell">${fmt(m.versatoSavings||0)}</td>
        <td class="amount-cell">${fmt(m.avanzoVerso||0)}</td>
      </tr>
    `).join('');
  }
}

document.getElementById('btn-chiudi-mese').addEventListener('click', () => {
  const nuovoMese = document.getElementById('nuovo-mese').value.trim();
  if (!nuovoMese) {
    toast('Inserisci il nome del nuovo mese.', 'warning');
    return;
  }
  const avanzoVerso = document.getElementById('avanzo-a-savings').value === 'si';
  apriModal(
    'Chiudere il mese?',
    `Stai chiudendo ${stato.meseCorrente} e aprendo ${nuovoMese}.`,
    () => chiudiMese(nuovoMese, avanzoVerso)
  );
});

function chiudiMese(nuovoMese, avanzoVerso) {
  const sN = spesoMacro('needs');
  const sW = spesoMacro('wants');
  const sS = spesoMacro('savings');
  const budW = stato.macros.wants.budget + (stato.saldoRiportato.wants||0);
  const budN = stato.macros.needs.budget + (stato.saldoRiportato.needs||0);
  const avanzoW = Math.max(0, budW - sW);
  const avanzoN = Math.max(0, budN - sN);

  stato.archivioMesi.push({
    mese: stato.meseCorrente,
    spesoNeeds: sN,
    spesoWants: sW,
    versatoSavings: sS,
    avanzoVerso: avanzoVerso ? avanzoW : 0,
    movimenti: stato.movimenti.slice(),
    scontrini: stato.scontrini.slice()
  });

  stato.saldoRiportato = {
    needs:   avanzoN,
    wants:   avanzoVerso ? 0 : avanzoW,
    savings: (stato.saldoRiportato.savings||0) + sS + (avanzoVerso ? avanzoW : 0)
  };

  stato.movimenti = [];
  stato.scontrini = [];
  stato.righeProdotto = [];
  stato.meseCorrente = nuovoMese;
  salvaStato();
  toast(`Mese chiuso. Aperto ${nuovoMese}.`, 'success', 4000);
  renderCambioMese();
  renderDashboard();
}

/* ============================================================
   IMPOSTAZIONI
   ============================================================ */
function renderImpostazioni() {
  document.getElementById('reddito-input').value = stato.reddito;
  document.getElementById('mese-input').value = stato.meseCorrente;

  const be = document.getElementById('macro-budget-editor');
  be.innerHTML = ['needs','wants','savings'].map(id => {
    const m = stato.macros[id];
    return `
      <div class="form-row" style="margin-bottom: 8px;">
        <div class="form-group">
          <label class="form-label">${escapeHtml(m.nome)} — budget €</label>
          <input type="number" step="1" min="0" data-mid="${id}" class="macro-budget-input" value="${m.budget}" />
        </div>
        <div class="form-group">
          <label class="form-label">Saldo riportato €</label>
          <input type="number" step="0.01" data-mid="${id}" class="macro-riporto-input" value="${(stato.saldoRiportato[id]||0).toFixed(2)}" />
        </div>
      </div>
    `;
  }).join('');

  const ve = document.getElementById('voci-editor');
  ve.innerHTML = ['needs','wants','savings'].map(id => {
    const m = stato.macros[id];
    return `
      <div style="margin-bottom: 20px;">
        <div style="font-family: var(--font-display); font-size: 18px; margin-bottom: 8px; display:flex; align-items:center; gap:10px;">
          <span style="width:10px; height:10px; border-radius:50%; background:${MACRO_COLOR[id]};"></span>
          ${escapeHtml(m.nome)}
          <span style="color:var(--text-dim); font-size:10px; letter-spacing:0.1em; text-transform:uppercase;">${m.voci.length} voci</span>
        </div>
        <div class="voci-list" data-mid="${id}">
          ${m.voci.map((v, idx) => `
            <div class="form-row" style="margin-bottom: 6px; grid-template-columns: 2fr 1fr 40px;">
              <input type="text" class="voce-nome" data-mid="${id}" data-idx="${idx}" value="${escapeHtml(v.nome)}" placeholder="Nome voce" />
              <input type="number" class="voce-budget" data-mid="${id}" data-idx="${idx}" step="1" min="0" value="${v.budget}" placeholder="Budget" />
              <button class="btn-icon-danger voce-del" data-mid="${id}" data-idx="${idx}" title="Elimina">×</button>
            </div>
          `).join('')}
        </div>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-ghost voce-add" data-mid="${id}">+ Aggiungi voce</button>
          <button class="btn btn-secondary voce-save" data-mid="${id}">Salva voci ${escapeHtml(m.nome)}</button>
        </div>
      </div>
    `;
  }).join('');

  ve.querySelectorAll('.voce-add').forEach(btn => btn.addEventListener('click', () => {
    const mid = btn.dataset.mid;
    stato.macros[mid].voci.push({ id: 'voce-' + uid(), nome: 'Nuova voce', budget: 0 });
    salvaStato();
    renderImpostazioni();
  }));
  ve.querySelectorAll('.voce-del').forEach(btn => btn.addEventListener('click', () => {
    const mid = btn.dataset.mid;
    const idx = parseInt(btn.dataset.idx);
    apriModal('Eliminare la voce?', 'I movimenti che la usavano resteranno ma punteranno a una voce inesistente.', () => {
      stato.macros[mid].voci.splice(idx, 1);
      salvaStato();
      renderImpostazioni();
    });
  }));
  ve.querySelectorAll('.voce-save').forEach(btn => btn.addEventListener('click', () => {
    const mid = btn.dataset.mid;
    ve.querySelectorAll(`.voce-nome[data-mid="${mid}"]`).forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (stato.macros[mid].voci[idx]) stato.macros[mid].voci[idx].nome = inp.value.trim() || 'Voce';
    });
    ve.querySelectorAll(`.voce-budget[data-mid="${mid}"]`).forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      if (stato.macros[mid].voci[idx]) stato.macros[mid].voci[idx].budget = parseFloat(inp.value) || 0;
    });
    salvaStato();
    toast('Voci salvate.', 'success');
  }));
}

document.getElementById('btn-salva-generali').addEventListener('click', () => {
  const r = parseFloat(document.getElementById('reddito-input').value);
  const m = document.getElementById('mese-input').value.trim();
  if (!isNaN(r) && r >= 0) stato.reddito = r;
  if (m) stato.meseCorrente = m;
  salvaStato();
  toast('Impostazioni salvate.', 'success');
  renderDashboard();
});

document.getElementById('btn-salva-macro').addEventListener('click', () => {
  document.querySelectorAll('.macro-budget-input').forEach(inp => {
    const mid = inp.dataset.mid;
    stato.macros[mid].budget = parseFloat(inp.value) || 0;
  });
  document.querySelectorAll('.macro-riporto-input').forEach(inp => {
    const mid = inp.dataset.mid;
    stato.saldoRiportato[mid] = parseFloat(inp.value) || 0;
  });
  salvaStato();
  toast('Budget aggiornati.', 'success');
  renderDashboard();
});

document.getElementById('btn-preset-503020').addEventListener('click', () => {
  const r = stato.reddito;
  apriModal(
    'Applicare preset 50/30/20?',
    `Imposterà: Needs ${fmt(r*0.5)}, Wants ${fmt(r*0.3)}, Savings ${fmt(r*0.2)}. I budget di voce restano invariati.`,
    () => {
      stato.macros.needs.budget   = Math.round(r * 0.5);
      stato.macros.wants.budget   = Math.round(r * 0.3);
      stato.macros.savings.budget = Math.round(r * 0.2);
      salvaStato();
      toast('Preset 50/30/20 applicato.', 'success');
      renderImpostazioni();
      renderDashboard();
    }
  );
});

document.getElementById('btn-backup').addEventListener('click', () => exportaJSON('backup'));

document.getElementById('file-import').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const dati = JSON.parse(ev.target.result);
      apriModal(
        'Importare il backup?',
        'I dati attuali verranno sostituiti. Se è un backup nel vecchio formato (5 contenitori), verrà migrato automaticamente.',
        () => {
          let nuovo;
          if (rilevaVecchioSchema(dati)) {
            nuovo = migraDaVecchioSchema(dati);
            toast('Backup migrato dal vecchio formato.', 'info', 4000);
          } else {
            nuovo = Object.assign({}, JSON.parse(JSON.stringify(STATO_DEFAULT)), dati);
          }
          stato = nuovo;
          salvaStato();
          renderImpostazioni();
          renderDashboard();
          toast('Backup importato.', 'success');
        }
      );
    } catch(err) {
      toast('File non valido: ' + err.message, 'danger', 5000);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('btn-reset-tutto').addEventListener('click', () => {
  apriModal(
    'Reset totale?',
    'Cancella tutti i dati e riporta lo stato iniziale. Esporta un backup prima di procedere.',
    () => {
      stato = JSON.parse(JSON.stringify(STATO_DEFAULT));
      salvaStato();
      renderImpostazioni();
      renderDashboard();
      toast('Reset eseguito.', 'info');
    }
  );
});

/* ============================================================
   EXPORT
   ============================================================ */
function exportaJSON(prefisso) {
  const blob = JSON.stringify(stato, null, 2);
  const nome = `${prefisso}_${stato.meseCorrente.replace(' ','_')}_${oggi()}.json`;
  scaricaFile(nome, blob, 'application/json');
}
function scaricaFile(nome, contenuto, mime) {
  const blob = new Blob([contenuto], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   SYNC UI (GitHub)
   ============================================================ */
function aggiornaStatoSync(stato) {
  const map = {
    local:   ['#6a6862', 'Solo locale'],
    ready:   ['#6c8eb0', 'Pronto'],
    syncing: ['#c98a2e', 'Sincronizzo…'],
    synced:  ['#6b8e5a', 'Sincronizzato'],
    offline: ['#c98a2e', 'Offline (in coda)'],
    error:   ['#c14a4a', 'Errore sync']
  };
  const [c, t] = map[stato] || map.local;
  document.querySelectorAll('.sync-dot').forEach(d => { d.style.background = c; });
  const lbl = document.getElementById('sync-label');
  if (lbl) lbl.textContent = t;
}

// Impostazioni → Sincronizzazione (GitHub)
function popolaConfigSync() {
  const { repo, token } = store.getConfig();
  const r = document.getElementById('sync-repo');
  const t = document.getElementById('sync-token');
  if (r) r.value = repo || '';
  if (t) t.value = token || '';
}
document.getElementById('btn-sync-save')?.addEventListener('click', () => {
  const repo  = document.getElementById('sync-repo')?.value.trim() || '';
  const token = document.getElementById('sync-token')?.value.trim() || '';
  if (!repo || !token) { toast('Inserisci repository (owner/repo) e token.', 'warning'); return; }
  store.setConfig({ repo, token });
  popolaConfigSync();
  toast('Configurazione salvata. Sincronizzazione avviata.', 'success');
});
document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
  const r = await store.testConnection();
  if (r.ok) toast('Sincronizzazione completata.', 'success');
  else toast('Sync fallita: ' + (r.error || 'errore sconosciuto'), 'danger', 5000);
});

/* ============================================================
   INIT
   ============================================================ */
store.onStatus(aggiornaStatoSync);
store.onRemote((s) => applyRemoteState(s));

renderInserimento();
renderScontrino();
renderDashboard();
popolaConfigSync();

// avvia la sync GitHub (no-op se non configurata)
store.init();