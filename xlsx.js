/* ============================================================
   LETTORE XLSX MINIMALE (nessuna libreria)
   Un .xlsx è uno ZIP di file XML: si leggono solo il primo foglio e le
   stringhe condivise. Usa DecompressionStream (Safari 16.4+, Chrome, Firefox).
   Restituisce righe di stringhe: [[cella, cella, ...], ...].
   I file .xls (vecchio formato binario) NON sono supportati: salvare come .xlsx o .csv.
   ============================================================ */
const LettoreXlsx = (() => {
  const dec = new TextDecoder('utf-8');

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  /** Elenca le voci dello ZIP leggendo la directory centrale. */
  function vociZip(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('non sembra un file .xlsx (ZIP non valido)');
    const n = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const voci = {};
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const metodo = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
      const off = v.getUint32(p + 42, true);
      const nome = dec.decode(buf.subarray(p + 46, p + 46 + nl));
      voci[nome] = { metodo, csize, off };
      p += 46 + nl + el + cl;
    }
    return voci;
  }

  async function leggiVoce(buf, voci, nome) {
    const e = voci[nome];
    if (!e) return null;
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dati = e.off + 30 + v.getUint16(e.off + 26, true) + v.getUint16(e.off + 28, true);
    const grezzi = buf.subarray(dati, dati + e.csize);
    const out = e.metodo === 0 ? grezzi : e.metodo === 8 ? await inflateRaw(grezzi) : null;
    if (!out) throw new Error('compressione ZIP non supportata');
    return dec.decode(out);
  }

  const entita = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, g) =>
    ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[g] ||
      String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10))));

  function stringheCondivise(xml) {
    if (!xml) return [];
    return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m =>
      entita([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  }

  const colonna = ref => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

  function righeFoglio(xml, cond) {
    const righe = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const riga = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = cm[1], corpo = cm[2] || '';
        const ref = (attr.match(/\br="([A-Z]+\d+)"/) || [])[1];
        if (!ref) continue;
        const tipo = (attr.match(/\bt="(\w+)"/) || [])[1];
        let val = '';
        if (tipo === 'inlineStr') val = entita([...corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
        else {
          const vv = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (vv !== undefined) val = tipo === 's' ? (cond[Number(vv)] ?? '') : entita(vv);
        }
        riga[colonna(ref)] = val;
      }
      for (let i = 0; i < riga.length; i++) if (riga[i] === undefined) riga[i] = '';
      if (riga.some(x => String(x).trim() !== '')) righe.push(riga.map(x => String(x).trim()));
    }
    return righe;
  }

  async function leggi(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const voci = vociZip(buf);
    if (!voci['xl/workbook.xml']) throw new Error('non sembra un file Excel .xlsx');
    // Primo foglio: workbook.xml -> rId -> workbook.xml.rels -> percorso
    const wb = await leggiVoce(buf, voci, 'xl/workbook.xml');
    const rels = await leggiVoce(buf, voci, 'xl/_rels/workbook.xml.rels');
    const rid = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
    let percorso = 'xl/worksheets/sheet1.xml';
    if (rid && rels) {
      const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(x => new RegExp('\\bId="' + rid + '"').test(x));
      const target = rel && (rel.match(/\bTarget="([^"]+)"/) || [])[1];
      if (target) percorso = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    }
    const foglio = await leggiVoce(buf, voci, percorso);
    if (!foglio) throw new Error('foglio non trovato nel file');
    const cond = stringheCondivise(await leggiVoce(buf, voci, 'xl/sharedStrings.xml'));
    return righeFoglio(foglio, cond);
  }
  return { leggi };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LettoreXlsx;
