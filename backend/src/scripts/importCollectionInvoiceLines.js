/**
 * سطورُ الفواتير — ماذا تشمل كلُّ فاتورةٍ وبكم، وأيُّ الكشوف «مردود».
 *
 *   node --max-old-space-size=8192 src/scripts/importCollectionInvoiceLines.js --dry
 *   node --max-old-space-size=8192 src/scripts/importCollectionInvoiceLines.js --apply
 *   … --file "1-1-2026 to 28-9-2026  F.xlsx"
 *
 * المصدر: ملفٌّ صفُّه (العميل · المبيعات · تاريخ الفاتورة · رقمها · رقم كشف
 * التخريج · الحالة). راجع models/CollectionInvoiceLine لمعنى «مردود» ولماذا
 * هي صفةُ السطر لا الفاتورة.
 *
 * ── والأعمدةُ تُقرأ بأسمائها لا بمواضعها ───────────────────────────────────
 * في هذا الملفّ عمودٌ أوّلُ فارغٌ تمامًا، ومفتاحُ المبلغ «‎ المبيعات ‎» بمسافتين
 * حوله. فالقراءةُ بالموضع تُزيح كلَّ حقلٍ خانةً — ويُقرأ اسمُ العميل مبلغًا.
 *
 * ── وما يُقال ولا يُخمَّن ──────────────────────────────────────────────────
 * في الملفّ ٤٣ فاتورةً لا يساوي إجماليُّها مجموعَ سطورها، واثنتان لا تساويانه
 * إلّا بإسقاط المردود. تُسمَّى في آخر التشغيل ولا يُصلَّح لها شيء: الفرقُ قد
 * يكون كشفًا خارجَ مدّة الملفّ، وقد يكون خطأً في الورقة — وقرارُه لصاحبها.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const BOOK = arg('file', '1-1-2026 to 28-9-2026  F.xlsx');
const FILE = path.join(__dirname, '../../..', 'collection files', BOOK);
const VAT = 0.15;

const S = (v) => (v == null ? '' : String(v).trim());
// التواريخُ بالرقم التسلسليّ لا بـ`cellDates` — تلك تُسقط يومًا على هذا الجهاز.
// راجع xlsx-date-epoch-trap.
const D = (n) => {
  const num = Number(n);
  return Number.isFinite(num) && num > 1 ? new Date(Date.UTC(1899, 11, 30) + num * 86400000) : null;
};

// مفتاحُ العمود قد يحمل مسافاتٍ حوله — تُطوى عند القراءة.
const pick = (row, name) => {
  const k = Object.keys(row).find((x) => x.trim() === name);
  return k ? row[k] : null;
};

(async () => {
  if (!fs.existsSync(FILE)) { console.error(`لا ملفَّ باسم «${BOOK}» في مجلّد collection files`); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  const CollectionInvoiceLine = require('../models/CollectionInvoiceLine');
  const CollectionInvoice = require('../models/CollectionInvoice');

  console.log(`\n  الملفّ: ${BOOK}\n  ${APPLY ? '— تنفيذ —' : '— تجربة، بلا كتابة —'}\n`);
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });

  const lines = [];
  let skipped = 0;
  for (const r of raw) {
    const invoiceNumber = S(pick(r, 'رقم الفاتوره'));
    const reportNumber = S(pick(r, 'رقم كشف التخريج'));
    if (!invoiceNumber || !reportNumber) { skipped += 1; continue; }
    const status = S(pick(r, 'Status'));
    lines.push({
      invoiceNumber,
      reportNumber,
      partyName: S(pick(r, 'العميل')),
      net: Math.round((Number(pick(r, 'المبيعات')) || 0) * 100) / 100,
      invoiceDate: D(pick(r, 'تاريخ الفاتوره')),
      status,
      returned: status === 'مردود',
      source: BOOK,
    });
  }

  // ── وترتيبُ المحاولات يُحسب هنا مرّةً ───────────────────────────────────
  // الكشفُ الواحدُ قد يظهر على أربع فواتير. فيُرقَّم ظهورُه بتاريخ الفاتورة
  // (ثمّ برقمها عند تساوي التاريخ) — فتقرأ الشاشةُ «المحاولة ٢ من ٣» بلا حساب.
  const byReport = new Map();
  for (const l of lines) {
    if (!byReport.has(l.reportNumber)) byReport.set(l.reportNumber, []);
    byReport.get(l.reportNumber).push(l);
  }
  let repeated = 0;
  for (const [, list] of byReport) {
    const seen = new Map();
    list.forEach((l) => seen.set(l.invoiceNumber, l));
    const order = [...seen.values()].sort((a, b) => (a.invoiceDate - b.invoiceDate)
      || Number(a.invoiceNumber) - Number(b.invoiceNumber));
    if (order.length > 1) repeated += 1;
    order.forEach((l, i) => { l.attempt = i + 1; l.attempts = order.length; });
    // سطورٌ تحت نفس الفاتورة والكشف (تكرارٌ في الورقة) تأخذ ترتيبَ فاتورتها.
    list.forEach((l) => {
      const ref = seen.get(l.invoiceNumber);
      l.attempt = ref.attempt; l.attempts = ref.attempts;
    });
  }

  // نوعُ الفاتورة وصاحبُها من الدفتر — لا يُخمَّنان من الورقة.
  const invNums = [...new Set(lines.map((l) => l.invoiceNumber))];
  const ledger = await CollectionInvoice.find({ invoiceNumber: { $in: invNums } })
    .select('invoiceNumber kind total party partyName').lean();
  const byInv = new Map();
  for (const i of ledger) {
    // رقمٌ واحدٌ قد يكون لحسابين (ضريبيٍّ ونقديّ) — يُقدَّم الضريبيُّ لأنّ هذا
    // الملفَّ دفترُ الفواتير الضريبيّة.
    const prev = byInv.get(i.invoiceNumber);
    if (!prev || (prev.kind !== 'tax' && i.kind === 'tax')) byInv.set(i.invoiceNumber, i);
  }
  for (const l of lines) {
    const inv = byInv.get(l.invoiceNumber);
    if (!inv) continue;
    l.kind = inv.kind;
    l.party = inv.party || null;
    if (!l.partyName) l.partyName = inv.partyName || '';
  }

  // ── التحقّق: أيساوي إجماليُّ الفاتورة مجموعَ سطورها؟ ────────────────────
  const sums = new Map();
  for (const l of lines) sums.set(l.invoiceNumber, (sums.get(l.invoiceNumber) || 0) + l.net);
  const mismatch = []; let matched = 0; let noLedger = 0;
  for (const [num, net] of sums) {
    const inv = byInv.get(num);
    if (!inv) { noLedger += 1; continue; }
    const expect = Math.round(net * (1 + VAT) * 100) / 100;
    if (Math.abs((Number(inv.total) || 0) - expect) <= 1.5) { matched += 1; continue; }
    mismatch.push({ num, ledger: Math.round(inv.total), lines: Math.round(expect), n: lines.filter((l) => l.invoiceNumber === num).length });
  }

  const returned = lines.filter((l) => l.returned);
  console.log(`  سطور: ${lines.length}  (تُخطّى ${skipped} صفًّا بلا رقمٍ)`);
  console.log(`  فواتير: ${invNums.length} · كشوف: ${byReport.size} · كشوفٌ على أكثرَ من فاتورة: ${repeated}`);
  console.log(`  سطورٌ مردودة: ${returned.length} بقيمة ${Math.round(returned.reduce((s, l) => s + l.net, 0)).toLocaleString('en-US')} (صافي)`);
  console.log(`  مطابقةُ الإجماليّ: ${matched} فاتورةً ✔ · لا تطابق ${mismatch.length} · ليست في الدفتر ${noLedger}`);

  if (!APPLY) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.\n');
    await mongoose.disconnect(); process.exit(0);
  }

  // المصدرُ واحدٌ، فيُستبدَل كاملًا — السطورُ لا يصنعها النظامُ ولا يعدّلها.
  const del = await CollectionInvoiceLine.deleteMany({});
  const CHUNK = 2000;
  let wrote = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const r = await CollectionInvoiceLine.insertMany(lines.slice(i, i + CHUNK), { ordered: false })
      .catch((e) => { console.log(`  ⚠ ${e.writeErrors?.length || 0} سطرًا لم يُكتب (تكرارٌ في الورقة)`); return e.insertedDocs || []; });
    wrote += Array.isArray(r) ? r.length : 0;
  }
  console.log(`\n  ✔ مُسح ${del.deletedCount} · كُتب ${wrote} سطرًا`);

  if (mismatch.length) {
    console.log(`\n  ⚠ فواتيرُ لا يساوي إجماليُّها مجموعَ سطورها (${mismatch.length}) — تُقال ولا تُصلَّح:`);
    mismatch.sort((a, b) => Math.abs(b.ledger - b.lines) - Math.abs(a.ledger - a.lines)).slice(0, 25)
      .forEach((x) => console.log(`      فاتورة ${x.num}: الدفتر ${x.ledger.toLocaleString('en-US')} · السطور ${x.lines.toLocaleString('en-US')} · فرق ${(x.ledger - x.lines).toLocaleString('en-US')} (${x.n} سطرًا)`));
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
