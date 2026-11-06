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

/* ---------------- Import estratti conto ---------------- */
const X = require('../xlsx.js');

test('parseImportoBanca: formati italiani e segni', () => {
  const p = L.parseImportoBanca;
  assert.equal(p('1.234,56'), 1234.56);
  assert.equal(p('-12,30'), -12.3);
  assert.equal(p('(5,00)'), -5);
  assert.equal(p('12,30-'), -12.3);
  assert.equal(p('€ 7.5'), 7.5);
  assert.equal(p('1.234'), 1234);        // punto come separatore migliaia
  assert.equal(p('1,234.56'), 1234.56);  // formato inglese
  assert.ok(Number.isNaN(p('abc')));
  assert.ok(Number.isNaN(p('')));
});

test('parseDataBanca: formati e date impossibili', () => {
  const d = L.parseDataBanca;
  assert.equal(d('03/11/2026'), '2026-11-03');
  assert.equal(d('3-11-26'), '2026-11-03');
  assert.equal(d('03.11.2026'), '2026-11-03');
  assert.equal(d('2026-11-03T10:00:00'), '2026-11-03');
  assert.equal(d('46000'), '2025-12-09');   // seriale Excel
  assert.equal(d('31/02/2026'), '');
  assert.equal(d('abc'), '');
});

test('parseCSV: delimitatore automatico, virgolette, BOM', () => {
  const r = L.parseCSV('﻿a;b;c\n"x;y";"he said ""hi""";3\n\n');
  assert.deepEqual(r, [['a', 'b', 'c'], ['x;y', 'he said "hi"', '3']]);
  assert.deepEqual(L.parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('CSV bancario con preambolo: colonne e movimenti', () => {
  const testo = new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(root, 'tests/fixtures/banca.csv')));
  const righe = L.parseCSV(testo);
  const m = L.rilevaColonne(righe);
  assert.equal(m.header, 1);
  assert.deepEqual([m.colonne.data, m.colonne.descrizione, m.colonne.importo], [0, 1, 2]);
  const mov = L.estraiMovimentiBanca(righe, m);
  assert.equal(mov.length, 3);
  assert.deepEqual(mov.map(x => x.importo), [-27.4, 1250, -1.3]);
  assert.equal(mov[0].data, '2026-11-03');
  assert.equal(mov[2].descrizione, 'Caffè Roma');
  assert.equal(L.estraiMovimentiBanca(righe, m, { invertiSegno: true })[0].importo, 27.4);
});

test('XLSX: lettura senza librerie, colonne Dare/Avere, entità XML', async () => {
  const buf = fs.readFileSync(path.join(root, 'tests/fixtures/banca.xlsx'));
  const righe = await X.leggi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(righe[0][0], 'Estratto conto - Conto Esempio');
  const m = L.rilevaColonne(righe);
  assert.equal(m.header, 1);
  assert.ok(m.colonne.uscite >= 0 && m.colonne.entrate >= 0 && m.colonne.importo === -1);
  const mov = L.estraiMovimentiBanca(righe, m);
  assert.equal(mov.length, 3);
  assert.deepEqual(mov.map(x => x.importo), [-35.2, 100, -12.99]);
  assert.equal(mov[0].data, '2025-12-09');
  assert.equal(mov[1].descrizione, 'Bonifico da MARIO ROSSI Rimborso <spese> & co');
  await assert.rejects(() => X.leggi(new TextEncoder().encode('non sono uno zip, ma abbastanza lungo per il test').buffer), /ZIP|xlsx/);
});

test('trovaDoppione: esatto, possibile, nessuno', () => {
  const st = stato({ movimenti: [{ id: 'a', data: '2026-11-03', importo: 27.4, rif: '2026-11-03|-27.40|conad' }, { id: 'b', data: '2026-11-04', importo: 10 }] });
  assert.equal(L.trovaDoppione({ data: '2026-11-03', importo: -27.4, rif: '2026-11-03|-27.40|conad' }, st), 'esatto');
  assert.equal(L.trovaDoppione({ data: '2026-11-04', importo: -10, rif: 'x' }, st), 'possibile');
  assert.equal(L.trovaDoppione({ data: '2026-11-05', importo: -10, rif: 'y' }, st), null);
  assert.equal(L.trovaDoppione({ data: '2026-11-04', importo: 10, rif: 'z' }, st), null); // entrata: non confrontata con le uscite
});

test('indovinaVoce: regole imparate prima di quelle di base, solo su voci esistenti', () => {
  const st = stato();
  assert.equal(L.chiaveRegola('PAGAMENTO POS ESSELUNGA VIAREGGIO 12/03'), 'esselunga');
  assert.deepEqual(L.indovinaVoce('PAGAMENTO POS ESSELUNGA VIAREGGIO', st), { macro: 'needs', voce: 'alimentari' });
  assert.deepEqual(L.indovinaVoce('Bonifico Trade Republic', st), { macro: 'savings', voce: 'tr-fisso' });
  assert.equal(L.indovinaVoce('NEGOZIO SCONOSCIUTO', st), null);
  st.regoleBanca = { esselunga: { macro: 'wants', voce: 'altro-wants' } };
  assert.deepEqual(L.indovinaVoce('POS ESSELUNGA', st), { macro: 'wants', voce: 'altro-wants' });
  st.regoleBanca = { esselunga: { macro: 'wants', voce: 'voce-cancellata' } };      // regola obsoleta: ripiega sulla base
  assert.deepEqual(L.indovinaVoce('POS ESSELUNGA', st), { macro: 'needs', voce: 'alimentari' });
});

test('validaStato: regoleBanca ripulite (niente __proto__), origine banca e rif conservati', () => {
  const g = JSON.parse('{"regoleBanca":{"__proto__":{"macro":"needs","voce":"x"},"ok":{"macro":"wants","voce":"bar"},"brutta":{"macro":"altro","voce":"y"}}}');
  const base = L.copiaProfonda(L.STATO_DEFAULT); base.regoleBanca = g.regoleBanca;
  base.movimenti = [{ id: 'm', macro: 'wants', voce: 'bar', importo: 3, origine: 'banca', rif: 'r1' }];
  const ok = L.validaStato(base);
  assert.deepEqual(Object.keys(ok.regoleBanca), ['ok']);
  assert.equal(Object.getPrototypeOf(ok.regoleBanca), Object.prototype);
  assert.equal(ok.movimenti[0].origine, 'banca');
  assert.equal(ok.movimenti[0].rif, 'r1');
});

/* ---------------- Scontrini: Gemini, confronto OCR, analisi prodotti ---------------- */
const CATS = ['Ortofrutta', 'Latticini e Uova', 'Altro'];

test('costruisciRichiestaGemini: immagini, schema, categorie nel prompt e nell\'enum', () => {
  const r = L.costruisciRichiestaGemini([{ mime: 'image/jpeg', base64: 'AAA' }, { mime: 'image/jpeg', base64: 'BBB' }], CATS);
  const parts = r.contents[0].parts;
  assert.equal(parts.length, 3);
  assert.match(parts[0].text, /Ortofrutta, Latticini e Uova, Altro/);
  assert.deepEqual(parts[1], { inline_data: { mime_type: 'image/jpeg', data: 'AAA' } });
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(r.generationConfig.responseSchema.properties.righe.items.properties.categoria.enum, CATS);
  assert.equal(r.generationConfig.temperature, 0);
});

test('normalizzaRispostaGemini: righe valide, categoria ignota -> Altro, scarti e avvisi', () => {
  const raw = '```json\n' + JSON.stringify({ negozio: 'Penny', data: '03/11/2026', totale: 10.5, righe: [
    { prodotto: ' Mele  Golden ', categoria: 'Ortofrutta', prezzo: 2.5 },
    { prodotto: 'Latte', categoria: 'Boh', prezzo: '1,49' },
    { prodotto: 'Sconto', categoria: 'Altro', prezzo: -0.5 },
    { prodotto: '', prezzo: 3 }, 'x'
  ] }) + '\n```';
  const r = L.normalizzaRispostaGemini(raw, CATS);
  assert.equal(r.data, '2026-11-03');
  assert.deepEqual(r.righe.map(x => [x.prodotto, x.categoria, x.prezzo]), [['Mele Golden', 'Ortofrutta', 2.5], ['Latte', 'Altro', 1.49]]);
  assert.equal(r.totale, 3.99);
  assert.equal(r.totaleRiportato, 10.5);
  assert.equal(r.avvisi.length, 2);                  // 3 scartate + totale che non torna
  assert.equal(r.errori.length, 0);
});

test('normalizzaRispostaGemini: input non valido -> errori, mai eccezioni', () => {
  assert.equal(L.normalizzaRispostaGemini('non json', CATS).errori.length, 1);
  assert.equal(L.normalizzaRispostaGemini(null, CATS).errori.length, 1);
  assert.equal(L.normalizzaRispostaGemini({ righe: [] }, CATS).errori.length, 1);
  assert.equal(L.normalizzaRispostaGemini({ righe: [{ prodotto: 'a', prezzo: 1 }], totale: 1 }, CATS).avvisi.length, 0);
});

test('confrontaLetture: prezzi uguali + nome compatibile, ogni riga usata una sola volta', () => {
  const rif = [{ prodotto: 'Latte parzialmente scremato', prezzo: 1.49 }, { prodotto: 'Mele', prezzo: 2.5 }, { prodotto: 'Pane', prezzo: 1 }];
  const ocr = [{ prodotto: 'LATTE PARZ SCREM', prezzo: 1.49 }, { prodotto: 'MELE GOLD', prezzo: 2.5 }, { prodotto: 'XQZ', prezzo: 1.0 }, { prodotto: 'extra', prezzo: 9 }];
  const r = L.confrontaLetture(ocr, rif);
  assert.equal(r.righeUguali, 2);                    // "XQZ" ha il prezzo giusto ma nome diverso
  assert.equal(r.accuratezza, 0.5);                  // 2 su max(4,3)
  assert.equal(L.confrontaLetture([], []).accuratezza, 1);
  assert.equal(L.confrontaLetture([{ prodotto: 'a', prezzo: 1 }], [{ prodotto: 'a', prezzo: 1 }, { prodotto: 'a', prezzo: 1 }]).righeUguali, 1);
});

test('statisticheOcr: ultimi n casi, totale corretto', () => {
  const casi = [
    { creato: '2026-01-01', ocrRighe: [{ prodotto: 'a', prezzo: 1 }], finaleRighe: [{ prodotto: 'a', prezzo: 1 }], ocrTotale: 1, totaleFinale: 1 },
    { creato: '2026-01-02', ocrRighe: [{ prodotto: 'b', prezzo: 5 }], finaleRighe: [{ prodotto: 'b', prezzo: 2 }], ocrTotale: 5, totaleFinale: 2 },
    { creato: '2026-01-03', ocrRighe: null, finaleRighe: [{ prodotto: 'c', prezzo: 1 }] }   // solo Gemini: non conta
  ];
  const s = L.statisticheOcr(casi);
  assert.equal(s.n, 2); assert.equal(s.accuratezza, 0.5); assert.equal(s.totaleOk, 0.5);
  assert.equal(L.statisticheOcr(casi, 1).n, 1);
  assert.equal(L.statisticheOcr([]).accuratezza, null);
});

test('aggregaProdotti: categorie, negozi, nome pulito, dove costa meno', () => {
  const righe = [
    { prodotto: 'Latte (lordo 1,80 € − sconto 0,31 €)', categoria: 'Latticini e Uova', prezzo: 1.49, negozio: 'Penny', data: '2026-11-01' },
    { prodotto: 'LATTE', categoria: 'Latticini e Uova', prezzo: 1.29, negozio: 'Lidl', data: '2026-11-02' },
    { prodotto: 'Latte', categoria: 'Latticini e Uova', prezzo: 1.59, negozio: 'Penny', data: '2026-11-05' },
    { prodotto: 'Mele', categoria: 'Ortofrutta', prezzo: 2, negozio: 'Penny', data: '2026-11-05' },
    { prodotto: 'x', prezzo: 0, negozio: 'Penny' }
  ];
  const a = L.aggregaProdotti(righe);
  assert.equal(a.totale, 6.37);
  assert.deepEqual(a.perCategoria.map(c => [c.categoria, c.totale, c.n]), [['Latticini e Uova', 4.37, 3], ['Ortofrutta', 2, 1]]);
  assert.deepEqual(a.perNegozio.map(n => [n.negozio, n.totale]), [['Penny', 5.08], ['Lidl', 1.29]]);
  const latte = a.perProdotto.find(p => p.chiave === 'latte');
  assert.equal(latte.n, 3); assert.equal(latte.min, 1.29); assert.equal(latte.ultimo, 1.59); assert.equal(latte.ultimoNegozio, 'Penny');
  assert.deepEqual(a.risparmi.map(r => [r.prodotto, r.negozioMin, r.delta]), [['Latte', 'Lidl', 0.3]]);
  assert.equal(L.nomeProdottoPulito('Pane  (lordo 2,00 € − sconto 0,50 €)'), 'Pane');
});

test('aggregaProdotti non si rompe con negozio "__proto__"', () => {
  const a = L.aggregaProdotti([{ prodotto: 'a', categoria: 'x', prezzo: 1, negozio: '__proto__', data: '2026-01-01' }]);
  assert.equal(a.perProdotto[0].n, 1);
  assert.equal(Object.getPrototypeOf(a.perProdotto[0].negozi), Object.prototype);
});

test('archivio: le righe prodotto del mese seguono il dettaglio (separa/ricompone)', () => {
  const st = stato({ archivioMesi: [{ id: 'm1', mese: 'Gen', movimenti: [], scontrini: [], righeProdotto: [{ id: 'r', prodotto: 'Latte', prezzo: 1 }] }] });
  const { leggero, dettagli } = L.separaArchivio(st);
  assert.equal(dettagli.length, 1);
  assert.equal(leggero.archivioMesi[0].righeProdotto, undefined);
  assert.equal(leggero.archivioMesi[0].nRighe, 1);
  assert.deepEqual(L.ricomponiArchivio(leggero, dettagli).archivioMesi[0].righeProdotto, [{ id: 'r', prodotto: 'Latte', prezzo: 1 }]);
});

test('messaggioErroreGemini: messaggi chiari per i casi comuni', () => {
  assert.match(L.messaggioErroreGemini(400, 'API key not valid. Please pass a valid API key.'), /chiave API non valida/);
  assert.match(L.messaggioErroreGemini(404, ''), /modello non trovato/);
  assert.match(L.messaggioErroreGemini(429, ''), /quota/);
  assert.match(L.messaggioErroreGemini(503, ''), /non disponibile/);
  assert.match(L.messaggioErroreGemini(418, ''), /418/);
});
