/**
 * إصلاحُ ما كتبه استيرادُ شيت المتابعة ٢٠٢٦ بقارئٍ معطوب.
 *
 *   node src/scripts/fixFollowup2026Slippage.js --dry
 *   node src/scripts/fixFollowup2026Slippage.js --yes
 *
 * ── ما الذي حدث ─────────────────────────────────────────────────────────────
 * قارئُ xlsx كان يطابق الخليّةَ بنمطٍ إغلاقُه اختياريّ. والخليّةُ الفارغة في
 * إكسل تُكتب مغلقةً على نفسها (<c r="I2" s="212"/>)، فكان النمطُ اللاهثُ
 * يتجاوزها ويلتقط قيمةَ الخليّة التي بعدها وينسبُها إليها — ثمّ يبتلع تلك
 * الخليّة فلا تُقرأ. أي أنّ كلَّ فراغٍ في الصفّ يزحف بما بعده عمودًا واحدًا.
 *
 * فدخلت في القاعدة قيمٌ في خاناتٍ ليست لها: تاريخٌ في خانة مال، رقمٌ في خانة
 * فرع. والحرّاس التي كُتبت وقتَها لصدّ «انزلاق أعمدة الشيت» كانت في الحقيقة
 * تصدُّ عطبَ القارئ.
 *
 * ── كيف يُصلَح ──────────────────────────────────────────────────────────────
 * لا يُعاد الاستيرادُ فوق القديم: المستورِد يملأ الفارغَ وحدَه، والخاناتُ لم
 * تعد فارغة. ولا يُتراجَع تراجعًا أعمى: بعضُ ما كُتب كان صحيحًا.
 *
 * فيُقرأ الملفُّ مرّتين — بالقارئ المعطوب وبالسليم — ويُقارَن:
 *   • القيمةُ في القاعدة ≠ ما كتبه المعطوب  → عدّلها إنسانٌ بعدها، تُترك.
 *   • السليمُ يعطي قيمةً مختلفة              → تُصحَّح.
 *   • السليمُ لا يعطي شيئًا                  → تُعاد إلى ما قبل الاستيراد.
 *
 * ولا يُمسّ إلّا ما ورد في ملفّ التراجع، أي ما كتبه ذلك الاستيراد بعينه.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const WorkflowReport = require('../models/OperationsWorkflow');
const { readSheet, excelDate, unesc } = require('./lib/xlsxStream');

const DRY = !process.argv.includes('--yes');
const FILE = path.join(__dirname, '../seeds/data/ops-2026-08/followup-2026-final.xlsx');
const SHEET = 'xl/worksheets/sheet2.xml';
const HEADER_ROW = 5;
const MAXBUF = 1024 * 1024 * 1024;

const undoArg = process.argv.find((a) => a.startsWith('--undo='));
const UNDO = undoArg
  ? path.resolve(undoArg.slice(7))
  : (fs.readdirSync(path.join(__dirname, '../../backups'))
      .filter((f) => f.startsWith('followup2026-undo-'))
      .sort()
      .map((f) => path.join(__dirname, '../../backups', f))
      .pop());

// ── القارئ المعطوب، محفوظًا هنا حرفًا بحرف كي يُعاد إنتاج ما كُتب بالضبط ────
function sharedStringsRaw(file) {
  let xml = '';
  try { xml = execSync(`unzip -p ${JSON.stringify(file)} xl/sharedStrings.xml`, { maxBuffer: MAXBUF }).toString('utf8'); }
  catch (e) { return []; }
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g; let m;
  while ((m = re.exec(xml))) {
    let s = '';
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g; let t;
    while ((t = tre.exec(m[1]))) s += unesc(t[1]);
    out.push(s);
  }
  return out;
}

function readSheetBuggy(file, sheetXmlPath) {
  const SS = sharedStringsRaw(file);
  const xml = execSync(`unzip -p ${JSON.stringify(file)} ${sheetXmlPath}`, { maxBuffer: MAXBUF }).toString('utf8');
  const rows = [];
  const rre = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let r;
  while ((r = rre.exec(xml))) {
    const cells = {};
    const cre = /<c r="([A-Z]+)\d+"([^>]*)\/?>(?:([\s\S]*?)<\/c>)?/g; let c;   // ← النمط المعطوب
    while ((c = cre.exec(r[2]))) {
      const col = c[1]; const attrs = c[2] || ''; const inner = c[3] || '';
      const t = (attrs.match(/t="([^"]+)"/) || [])[1];
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      let v = null;
      if (t === 's' && vm) v = SS[+vm[1]];
      else if (vm) v = t === 'str' ? unesc(vm[1]) : vm[1];
      if (v !== null && String(v).trim() !== '') cells[col] = v;
    }
    rows.push({ r: +r[1], cells });
  }
  return rows;
}

// ── نفسُ خريطة المستورِد وقواعدِه ────────────────────────────────────────────
const COL = {
  B: 'reportNumber', C: 'reportDate', D: 'fromLocation', E: 'toLocation', F: 'branch',
  G: 'carOwner', H: 'carNumber', I: 'ownerType', J: 'executionStatus', K: 'applicationStatus',
  L: 'paymentMethod', M: 'username', N: 'taxIndicator', O: 'purchaseValue', P: 'sellingValue',
  Q: 'operationsReview', R: 'paymentDate', S: 'payingBranch', T: 'finalReportDestination',
  U: 'documentNumber', V: 'sendingDate', W: 'deliveryDate', X: 'accountingReview',
  Y: 'invoiceNumber', Z: 'netInvoice', AA: 'tax', AB: 'totalInvoice', AC: 'invoiceDate',
  AD: 'invoiceNotes', AE: 'collectionDate',
};
const DATES = new Set(['reportDate', 'paymentDate', 'sendingDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);
const NUMS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice']);
const BAD = /^(#N\/A|#REF!|#VALUE!|#DIV\/0!|#NAME\?|#NULL!|#NUM!|-|\.|_+)$/;
const INVOICE_MONEY = new Set(['netInvoice', 'tax', 'totalInvoice']);
const BRANCHY = new Set(['payingBranch', 'finalReportDestination', 'branch']);
const looksLikeDate = (n) => n >= 44000 && n <= 48000;

/** الحرّاسُ كما كانت وقتَ ذلك الاستيراد — لإعادة إنتاج ما كُتب بالضبط. */
function normalizeOld(key, v) {
  if (key === 'accountingReview') return undefined;
  if (key === 'operationsReview') {
    if (/^(ok)$/i.test(v)) return 'تم';
    if (/^\d+(\.\d+)?$/.test(v)) return undefined;
    return v;
  }
  if (key === 'taxIndicator') return /^cash$/i.test(v) ? 'cash' : v;
  if (BRANCHY.has(key) && /^\d+(\.\d+)?$/.test(v)) return undefined;
  return v;
}

/** الحرّاسُ الحاليّة. */
function normalizeNew(key, v) {
  if (key === 'accountingReview' && /^\d+(\.\d+)?$/.test(v)) return undefined;
  if (key === 'operationsReview') {
    if (/^(ok)$/i.test(v)) return 'تم';
    if (/^\d+(\.\d+)?$/.test(v)) return undefined;
    return v;
  }
  if (key === 'taxIndicator') return /^cash$/i.test(v) ? 'cash' : v;
  if (BRANCHY.has(key) && /^\d+(\.\d+)?$/.test(v)) return undefined;
  return v;
}

function build(rows, normalize) {
  const out = new Map();
  for (const { cells } of rows) {
    if (!cells) continue;
    const rn = String(cells.B ?? '').trim();
    if (!rn || BAD.test(rn)) continue;
    const rec = {};
    for (const [col, key] of Object.entries(COL)) {
      if (key === 'reportNumber') continue;
      let v = cells[col];
      if (v == null) continue;
      v = String(v).trim();
      if (!v || BAD.test(v)) continue;
      if (DATES.has(key)) { const d = excelDate(v); if (d) rec[key] = d; }
      else if (NUMS.has(key)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n === 0) continue;
        if (INVOICE_MONEY.has(key) && looksLikeDate(n)) continue;
        rec[key] = n;
      } else { const nv = normalize(key, v); if (nv !== undefined) rec[key] = nv; }
    }
    out.set(rn, rec);
  }
  return out;
}

const same = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    return da.getTime() === db.getTime();
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
};

const show = (v) => (v == null ? '∅' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 24));

(async () => {
  console.log('\n' + '='.repeat(72));
  console.log(DRY ? '  إصلاح انزلاق شيت المتابعة — تجربةٌ فقط (لا كتابة)' : '  إصلاح انزلاق شيت المتابعة — تنفيذ');
  console.log('='.repeat(72));
  if (!UNDO || !fs.existsSync(UNDO)) { console.error('  ✗ لا ملفّ تراجع في backups/'); process.exit(1); }
  console.log('  ملفّ التراجع: ' + path.basename(UNDO));

  const undo = JSON.parse(fs.readFileSync(UNDO, 'utf8'));
  console.log(`  سجلّاتٌ كتبها ذلك الاستيراد: ${undo.length}`);

  const buggy = build(readSheetBuggy(FILE, SHEET).filter((r) => r.r > HEADER_ROW), normalizeOld);
  const fixed = build(readSheet(FILE, SHEET).filter((r) => r.r > HEADER_ROW), normalizeNew);
  console.log(`  قُرئ الشيت بالقارئين: ${buggy.size} / ${fixed.size} رقمَ كشف\n`);

  const ids = undo.map((u) => new mongoose.Types.ObjectId(u._id));
  await mongoose.connect(process.env.MONGODB_URI);
  const docs = new Map();
  for (let i = 0; i < ids.length; i += 2000) {
    // eslint-disable-next-line no-await-in-loop
    const chunk = await WorkflowReport.find({ _id: { $in: ids.slice(i, i + 2000) } }).lean();
    chunk.forEach((d) => docs.set(String(d._id), d));
  }
  console.log(`  وُجد في القاعدة: ${docs.size}\n`);

  const plan = [];
  const stats = { correct: 0, revert: 0, alreadyRight: 0, humanEdited: 0, missing: 0 };
  const byField = {};
  const samples = [];

  for (const u of undo) {
    const doc = docs.get(u._id);
    if (!doc) { stats.missing += 1; continue; }
    const rn = u.reportNumber;
    const b = buggy.get(rn) || {};
    const f = fixed.get(rn) || {};
    const set = {};
    for (const field of Object.keys(u.before)) {
      const cur = doc[field];
      const wrote = b[field];
      const right = f[field];
      if (!same(cur, wrote)) { stats.humanEdited += 1; continue; }   // مسَّها إنسانٌ بعدها
      if (same(cur, right)) { stats.alreadyRight += 1; continue; }   // المعطوب صادف الصواب
      if (right === undefined) { set[field] = u.before[field] ?? null; stats.revert += 1; }
      else { set[field] = right; stats.correct += 1; }
      byField[field] = (byField[field] || 0) + 1;
      if (samples.length < 12) samples.push(`${rn} · ${field}: ${show(cur)} → ${show(set[field])}`);
    }
    if (Object.keys(set).length) plan.push({ _id: u._id, set });
  }

  console.log('  ما سيحدث:');
  console.log(`    تُصحَّح إلى قيمة الشيت الصحيحة : ${stats.correct}`);
  console.log(`    تُعاد إلى ما قبل الاستيراد     : ${stats.revert}`);
  console.log(`    كانت صحيحةً أصلًا (لا شيء)     : ${stats.alreadyRight}`);
  console.log(`    عدَّلها إنسانٌ بعدها (تُترك)     : ${stats.humanEdited}`);
  if (stats.missing) console.log(`    سجلّاتٌ لم تعد موجودة           : ${stats.missing}`);
  console.log(`\n  السجلّات المتأثّرة: ${plan.length}`);

  const cols = Object.entries(byField).sort((a, b2) => b2[1] - a[1]);
  if (cols.length) {
    console.log('\n  بالحقل:');
    cols.forEach(([k, n]) => console.log(`    ${k.padEnd(26)} ${n}`));
  }
  if (samples.length) {
    console.log('\n  عيّنة:');
    samples.forEach((s) => console.log('    ' + s));
  }

  if (DRY) { console.log('\n  — تجربةٌ فقط، لم يُكتب شيء. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  let done = 0;
  for (let i = 0; i < plan.length; i += 500) {
    const ops = plan.slice(i, i + 500).map((p) => {
      const set = {}; const unset = {};
      for (const [k, v] of Object.entries(p.set)) { if (v === null) unset[k] = ''; else set[k] = v; }
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      return { updateOne: { filter: { _id: new mongoose.Types.ObjectId(p._id) }, update } };
    });
    // eslint-disable-next-line no-await-in-loop
    const r = await WorkflowReport.bulkWrite(ops, { ordered: false });
    done += r.modifiedCount;
  }
  console.log(`\n  ✓ عُدِّل ${done} سجلًّا.\n`);
  await mongoose.disconnect();
})().catch(async (e) => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
