/**
 * قارئ xlsx بلا مكتبة — يفكّ الأرشيف ويقرأ ورقةً واحدة سطرًا سطرًا.
 *
 * مكتبة `xlsx` تبني الدفتر كلّه في الذاكرة، وهذا الملفّ ورقتُه الكبرى ٣٥ ميغا
 * من XML فينفد الكوم قبل أن يقرأ صفًّا واحدًا. وما نحتاجه أبسط: نصوصٌ وأرقام.
 */
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

/** يقرأ جدول النصوص المشتركة مرّةً واحدة. */
function sharedStrings(file) {
  let xml;
  try { xml = execSync(`unzip -p ${JSON.stringify(file)} xl/sharedStrings.xml`, { maxBuffer: MAXBUF }).toString('utf8'); }
  catch (e) { return []; }
  const out = []; const re = /<si>([\s\S]*?)<\/si>/g; let mt;
  while ((mt = re.exec(xml))) out.push(textOf(mt[1]));
  return out;
}

/** يعيد [{ r, cells: { A: 'قيمة', … } }] — الخلايا الفارغة محذوفة. */
function readSheet(file, sheetXmlPath) {
  const SS = sharedStrings(file);
  const xml = execSync(`unzip -p ${JSON.stringify(file)} ${sheetXmlPath}`, { maxBuffer: MAXBUF }).toString('utf8');
  const rows = [];
  const rre = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let r;
  while ((r = rre.exec(xml))) {
    const cells = {};
    const cre = /<c r="([A-Z]+)\d+"([^>]*)\/?>(?:([\s\S]*?)<\/c>)?/g; let c;
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
 * رقم إكسل التسلسلي ← تاريخ. المرجع 1899-12-30، ويُبنى بـUTC كي لا يزحف يومًا:
 * الواجهة تعرض التاريخ بـ`slice(0,10)` على ISO، فمنتصفُ ليلٍ محليّ يظهر أمسِ.
 *
 * ولا يُقرَّب: ٣٤٨١ خليّةً في هذا الملفّ تحمل كسرًا (وقتًا)، والتقريب يقفز بها
 * يومًا كاملًا حين يتجاوز الوقتُ الظهر.
 *
 * ويُرفض ما خرج عن ١٩٧١–٢٠٦٤: عمودٌ انزلق يضع مبلغًا في خانة تاريخ، فيصير
 * ٢٧٠٠ ريالٍ تاريخًا في ١٩٠٧.
 */
const DATE_MIN = 26000;   // ١٩٧١
const DATE_MAX = 60000;   // ٢٠٦٤
function excelDate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < DATE_MIN || n > DATE_MAX) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { readSheet, excelDate, unesc };
