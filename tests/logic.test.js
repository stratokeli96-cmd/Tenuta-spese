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
