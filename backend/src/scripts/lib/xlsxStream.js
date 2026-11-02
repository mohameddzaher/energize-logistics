/** Dependency-free xlsx reader that streams one sheet row by row. The xlsx library builds the whole workbook in memory, which runs out of heap on this 35 MB sheet. */
const { execSync } = require('child_process');

const MAXBUF = 2000 * 1024 * 1024;

function unesc(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&');
}

function textOf(si) {
  let out = ''; const re = /<t[^>]*>([\s\S]*?)<\/t>/g; let n;
  while ((n = re.exec(si))) out += n[1];
  return unesc(out);
}

/** Reads the shared strings table once. */
function sharedStrings(file) {
  let xml;
  try { xml = execSync(`unzip -p ${JSON.stringify(file)} xl/sharedStrings.xml`, { maxBuffer: MAXBUF }).toString('utf8'); }
  catch (e) { return []; }
  const out = []; const re = /<si>([\s\S]*?)<\/si>/g; let mt;
  while ((mt = re.exec(xml))) out.push(textOf(mt[1]));
  return out;
}

/** Returns [{ r, cells: { A: 'value', ... } }]; empty cells are omitted. */
function readSheet(file, sheetXmlPath) {
  const SS = sharedStrings(file);
  const xml = execSync(`unzip -p ${JSON.stringify(file)} ${sheetXmlPath}`, { maxBuffer: MAXBUF }).toString('utf8');
  const rows = [];
  const rre = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let r;
  while ((r = rre.exec(xml))) {
    const cells = {};
    // An empty cell is self-closed (<c r="I2" s="212"/>). Treating the closing as optional in one pattern let an empty cell swallow the next cell's value and shift columns silently. So either `/>` ends it, or `>` then content then `</c>`.
    const cre = /<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c;
    while ((c = cre.exec(r[2]))) {
      const col = c[1]; const attrs = c[2] || ''; const inner = c[3] || '';
      const t = (attrs.match(/t="([^"]+)"/) || [])[1];
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      const im = inner.match(/<is>([\s\S]*?)<\/is>/);
      let v = null;
      if (t === 's' && vm) v = SS[+vm[1]];
      else if (t === 'inlineStr' && im) v = textOf(im[1]);
      else if (vm) v = t === 'str' ? unesc(vm[1]) : vm[1];
      if (v !== null && String(v).trim() !== '') cells[col] = v;
    }
    rows.push({ r: +r[1], cells });
  }
  return rows;
}

/**
 * Excel serial number to date. Epoch is 1899-12-30, built in UTC so the UI's ISO slice(0,10) does not show the previous day.
 * Not rounded: many cells carry a time fraction and rounding would jump a day after noon.
 * Values outside 1971-2064 are rejected, since a shifted column would turn an amount into a date.
 */
const DATE_MIN = 26000;   // Lower bound year 1971.
const DATE_MAX = 60000;   // Upper bound year 2064.
function excelDate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < DATE_MIN || n > DATE_MAX) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { readSheet, excelDate, unesc };
