'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../logic.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stato = (extra = {}) => ({ ...L.copiaProfonda(L.STATO_DEFAULT), ...extra });

test('oggi() usa la data locale, non UTC', () => {
  // 00:30 locale del 5 gennaio: toISOString() in Italia darebbe il 4.
  assert.equal(L.oggi(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
  assert.equal(L.oggi(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('round2 elimina la deriva dei float', () => {
  assert.equal(L.round2(0.1 + 0.2), 0.3);
  assert.equal(L.round2(1.005), 1.01);
});

test('spesoMacro somma al centesimo, include scontrini solo in needs, esclude gli orfani', () => {
  const st = stato({
    movimenti: [
      { id: 'a', macro: 'needs', voce: 'utenze', importo: 0.1 },
      { id: 'b', macro: 'needs', voce: 'utenze', importo: 0.2 },
      { id: 'c', macro: 'needs', voce: 'non-esiste', importo: 99 },
      { id: 'd', macro: 'wants', voce: 'bar', importo: 5 }
    ],
    scontrini: [{ id: 's', totale: 10.05 }]
  });
  assert.equal(L.stSpesoMacro(st, 'needs'), 10.35);
  assert.equal(L.stSpesoMacro(st, 'wants'), 5);
  assert.equal(L.stSpesoVoce(st, 'needs', 'alimentari'), 10.05);
});

test('validaStato: rifiuta input non validi', () => {
  assert.throws(() => L.validaStato(null));
  assert.throws(() => L.validaStato([]));
  assert.throws(() => L.validaStato({}), /macros/);
  assert.throws(() => L.validaStato({ macros: { needs: { voci: [] } } }), /wants/);
});

test('validaStato: normalizza tipi, scarta voci duplicate e movimenti non-oggetto', () => {
  const grezzo = L.copiaProfonda(L.STATO_DEFAULT);
  grezzo.macros.needs.voci.push({ id: 'alimentari', nome: 'Doppione', budget: 1 });
  grezzo.macros.needs.nome = '<img src=x onerror=alert(1)>';
  grezzo.movimenti = [{ id: 1, macro: 'needs', voce: 'utenze', importo: '12,5x' }, 'spazzatura', null, { importo: '7.256' }];
  const ok = L.validaStato(grezzo);
  assert.equal(ok.macros.needs.voci.filter(v => v.id === 'alimentari').length, 1);
  assert.equal(ok.movimenti.length, 2);
  assert.equal(ok.movimenti[0].importo, 0);          // NaN -> 0, mai stringa
  assert.equal(ok.movimenti[1].importo, 7.26);
  assert.equal(typeof ok.movimenti[0].id, 'string');
  assert.equal(ok.schemaVersion, L.SCHEMA_VERSION);
  // il nome ostile resta testo: sarà escapato al render
  assert.equal(ok.macros.needs.nome, '<img src=x onerror=alert(1)>');
});

test('validaStato non muta l\'input', () => {
  const grezzo = L.copiaProfonda(L.STATO_DEFAULT);
  grezzo.movimenti = [{ id: 'x', macro: 'needs', voce: 'utenze', importo: '3' }];
  const prima = JSON.stringify(grezzo);
  L.validaStato(grezzo);
  assert.equal(JSON.stringify(grezzo), prima);
});

test('importaStato migra il vecchio schema a 5 contenitori', () => {
  const vecchio = {
    meseCorrente: 'Apr 2026', reddito: 1000,
    contenitori: {
      'needs-correnti': { id: 'needs-correnti', budget: 500, voci: [{ id: 'alimentari', nome: 'Alimentari', budget: 500 }] },
      'carta-wants': { id: 'carta-wants', budget: 300, voci: [{ id: 'bar', nome: 'Bar', budget: 300 }] },
      'trade-republic': { id: 'trade-republic', budget: 200, voci: [] }
    },
    movimenti: [{ id: 'm1', data: '2026-04-02', contenitore: 'carta-wants', voce: 'bar', importo: 3.5 }]
  };
  const n = L.importaStato(vecchio);
  assert.equal(n.meseCorrente, 'Apr 2026');
  assert.equal(n.movimenti[0].macro, 'wants');
  assert.equal(L.stSpesoMacro(n, 'wants'), 3.5);
});

test('csvCell neutralizza le formule e raddoppia le virgolette', () => {
  assert.equal(L.csvCell('=SOMMA(A1)'), '"\'=SOMMA(A1)"');
  assert.equal(L.csvCell('+39 333'), '"\'+39 333"');
  assert.equal(L.csvCell('di "marca"'), '"di ""marca"""');
  assert.equal(L.csvCell(null), '""');
});

test('escapeHtml', () => {
  assert.equal(L.escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('sw.js CACHE_VERSION coincide con APP_VERSION', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const a = html.match(/const APP_VERSION = '([^']+)'/)[1];
  const c = sw.match(/const CACHE_VERSION = '([^']+)'/)[1];
  assert.equal(c, a);
});

test('gli script inline di index.html sono sintatticamente validi', () => {
  const blocchi = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocchi.length >= 2);
  blocchi.forEach((b, i) => assert.doesNotThrow(() => new vm.Script(b), 'script inline #' + i));
});

test('nessun nome/id utente interpolato in HTML senza escapeHtml', () => {
  // ${x.nome}, ${x.id}, ${x.tipo} nudi dentro template HTML = potenziale XSS da JSON importato.
  const peggio = [...html.matchAll(/\$\{\s*[A-Za-z_.]*\.(nome|id|tipo|descrizione|negozio|mese)\s*\}/g)].map(m => m[0]);
  assert.deepEqual(peggio, []);
});

test('le librerie CDN hanno SRI', () => {
  const tag = [...html.matchAll(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*>/g)].map(m => m[0]);
  assert.equal(tag.length, 4);
  tag.forEach(t => assert.match(t, /integrity="sha384-/));
});

test('separaArchivio / ricomponiArchivio: roundtrip senza perdite', () => {
  const st = stato({ archivioMesi: [
    { id: 'm1', mese: 'Gen 2026', reddito: 1000, spesoNeeds: 500, spesoWants: 200, versatoSavings: 100, avanzoTotale: 50,
      movimenti: [{ id: 'a', importo: 5 }], scontrini: [{ id: 's', totale: 7 }] },
    { id: 'm2', mese: 'Feb 2026', movimenti: [], scontrini: [] }
  ] });
  const { leggero, dettagli } = L.separaArchivio(st);
  assert.equal(dettagli.length, 1);                       // solo il mese con dettaglio
  assert.equal(leggero.archivioMesi[0].movimenti, undefined);
  assert.equal(leggero.archivioMesi[0].nMovimenti, 1);
  assert.equal(leggero.archivioMesi[0].nScontrini, 1);
  assert.equal(JSON.stringify(leggero).includes('"importo":5'), false);
  const completo = L.ricomponiArchivio(leggero, dettagli);
  assert.deepEqual(completo.archivioMesi[0].movimenti, [{ id: 'a', importo: 5 }]);
  assert.deepEqual(completo.archivioMesi[0].scontrini, [{ id: 's', totale: 7 }]);
  assert.equal(completo.archivioMesi[0].nMovimenti, undefined);
});

test('separaArchivio è idempotente e non perde i conteggi su stato già leggero', () => {
  const st = stato({ archivioMesi: [{ id: 'm1', mese: 'Gen', movimenti: [{ id: 'a', importo: 1 }], scontrini: [] }] });
  const una = L.separaArchivio(st).leggero;
  const due = L.separaArchivio(L.validaStato(una)).leggero;  // validaStato rimette array vuoti
  assert.equal(due.archivioMesi[0].nMovimenti, 1);
  assert.equal(L.separaArchivio(L.validaStato(una)).dettagli.length, 0); // nulla da riscrivere
});

test('validaStato assegna id univoci ai mesi archiviati e li conserva', () => {
  const g = L.copiaProfonda(L.STATO_DEFAULT);
  g.archivioMesi = [{ mese: 'A' }, { id: 'x', mese: 'B' }, { id: 'x', mese: 'C' }];
  const ok = L.validaStato(g);
  const ids = ok.archivioMesi.map(a => a.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(ids[1], 'x');
  assert.equal(L.validaStato(ok).archivioMesi[1].id, 'x');
});

test('confrontaMesi', () => {
  const r = L.confrontaMesi({ spesoNeeds: 100, reddito: 1000 }, { spesoNeeds: 125.5, reddito: 1000 });
  const needs = r.find(x => x.nome === 'Needs');
  assert.equal(needs.delta, 25.5);
  assert.equal(needs.pct, 26);
  assert.equal(r.find(x => x.nome === 'Wants').pct, null); // divisione per zero evitata
});

test('archivio.js è precaricato dal service worker e copiato nel deploy', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const wf = fs.readFileSync(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
  assert.match(sw, /'\.\/archivio\.js'/);
  assert.match(sw, /'\.\/logic\.js'/);
  assert.match(wf, /archivio\.js/);
});

test('entrate extra: totali, reddito totale, da assegnare', () => {
  const st = stato({ reddito: 1000, entrateExtra: [
    { id: 'e1', importo: 100.10, alloc: { needs: 50, wants: 30.05, savings: 0 } },
    { id: 'e2', importo: 50, alloc: { needs: 0, wants: 0, savings: 0 } }
  ] });
  assert.equal(L.totaleEntrateExtra(st), 150.1);
  assert.equal(L.redditoTotale(st), 1150.1);
  assert.equal(L.extraAssegnata(st.entrateExtra[0]), 80.05);
  assert.equal(L.extraDaAssegnare(st), 70.05);
});

test('calcolaAllocazione: delta rispetto alla ripartizione precedente e validazioni', () => {
  const e = { importo: 100, alloc: { needs: 20, wants: 0, savings: 0 } };
  const r = L.calcolaAllocazione(e, { needs: 50, wants: 30, savings: 20 });
  assert.deepEqual(r.delta, { needs: 30, wants: 30, savings: 20 });
  assert.deepEqual(r.alloc, { needs: 50, wants: 30, savings: 20 });
  assert.throws(() => L.calcolaAllocazione(e, { needs: 60, wants: 50, savings: 0 }), /supera/);
  assert.throws(() => L.calcolaAllocazione(e, { needs: -1, wants: 0, savings: 0 }), /negative/);
  // quote parziali ammesse (il resto resta da assegnare); testo non numerico = 0
  assert.deepEqual(L.calcolaAllocazione(e, { needs: '10', wants: 'x' }).alloc, { needs: 10, wants: 0, savings: 0 });
});

test('validaStato normalizza le entrate extra', () => {
  const g = L.copiaProfonda(L.STATO_DEFAULT);
  g.entrateExtra = [
    { id: 'a', importo: '25,5', alloc: { needs: 10 } },        // importo non numerico valido -> 0 -> scartata
    { id: 'b', importo: 40, alloc: { needs: 30, wants: 30 } }, // alloc > importo -> azzerata
    { importo: 10.005, descrizione: 'Regalo', alloc: { savings: 10 } },
    'spazzatura'
  ];
  const ok = L.validaStato(g);
  assert.equal(ok.entrateExtra.length, 2);
  assert.deepEqual(ok.entrateExtra[0].alloc, { needs: 0, wants: 0, savings: 0 });
  assert.equal(ok.entrateExtra[1].importo, 10.01);
  assert.equal(typeof ok.entrateExtra[1].id, 'string');
  assert.equal(L.validaStato({ ...L.copiaProfonda(L.STATO_DEFAULT) }).entrateExtra.length, 0); // backup vecchio: campo assente
});

test('redditoMese e confrontaMesi includono le entrate extra', () => {
  assert.equal(L.redditoMese({ reddito: 1000, extraTot: 50.5 }), 1050.5);
  assert.equal(L.redditoMese({ reddito: 1000 }), 1000);   // mesi archiviati prima della funzione
  const r = L.confrontaMesi({ reddito: 1000 }, { reddito: 1000, extraTot: 100 }).find(x => x.nome === 'Reddito');
  assert.equal(r.delta, 100);
});
