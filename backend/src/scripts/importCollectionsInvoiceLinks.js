/**
 * أيُّ فاتورةٍ تشمل أيَّ كشف — من دفتر قسم التحصيل إلى كشوف التشغيل.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * دفترُ الفواتير يعرف أنّ الفاتورة موجودةٌ وبكم؛ ولا يعرف أيَّ حمولاتٍ تشملها.
 * والكشفُ يعرف حمولتَه؛ ولا يعرف أنّه فُوتِر. فيُسأل «الفاتورة دي شاملة إيه؟»
 * فلا جواب — ويُفتَح ملفُّ إكسل جانبيّ.
 *
 * والربطُ لا يحتاج جدولًا ثالثًا: الفاتورةُ مكتوبةٌ على الكشف (`invoiceNumber`)،
 * وصفحةُ الفاتورة تقرأ كشوفَها بها (collectionsDeptController). فيكفي أن يُكتب
 * الرقمُ على كشوفه — فتُقرأ الصلةُ من الطرفين بلا مزامنةٍ ولا نسخة ثانية.
 *
 * ── وما يُكتب ───────────────────────────────────────────────────────────────
 *   رقمُ الفاتورة وتاريخُها، وصافيها من عمود «المبيعات» (لكلّ كشفٍ نصيبُه).
 *   والضريبةُ والإجماليّ لا يُكتبان من الملفّ: يُشتقّان كما في النظام —
 *   ضريبةٌ ١٥٪ وإجماليٌّ مجموعُهما (راجع deriveInvoiceTotals). وقد طوبق:
 *   إجماليُّ الدفتر = صافي الملفّ × ١٫١٥ بالضبط.
 *
 * ── ونوعُ الدفع يتبع الفاتورة ───────────────────────────────────────────────
 * فاتورةٌ ضريبيّةٌ صادرةٌ تعني كشفًا ضريبيًّا (راجع hasTaxInvoice). فما كُتب له
 * رقمٌ يصير ضريبيًّا — إلّا ما اختاره موظّفٌ بيده (`paymentTypeSource: manual`)
 * فلا يُدهَس اختيارُه، ويُقال في التقرير.
 *
 * تجربةٌ افتراضًا؛ `--apply` للكتابة.
 *   node src/scripts/importCollectionsInvoiceLinks.js [path.xlsx] [--apply]
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DEFAULT_FILE = path.join(__dirname, '../../../collection files/1-1-2026 to 19-9-2026.xlsx');
const VAT_RATE = 0.15;
const S = (v) => String(v ?? '').trim();
const NO_INVOICE_RX = /^\s*(0|no\s*inv|بدون|لا\s*يوجد|-|—|ىى)\s*$/i;

// التواريخُ تُقرأ بالرقم التسلسليّ لا بـ`cellDates` — تلك تُسقط يومًا على هذا
// الجهاز. راجع xlsx-date-epoch-trap.
const serialToDate = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(Date.UTC(1899, 11, 30) + num * 86400000);
};

(async () => {
  const file = process.argv.find((a) => a.endsWith('.xlsx')) || DEFAULT_FILE;
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);

  const wb = XLSX.readFile(file, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false, raw: true }).slice(1);

  // صفٌّ لكلّ كشف: العميل، المبيعات (صافي نصيب الكشف)، تاريخ الفاتورة، رقمها، رقم الكشف.
  const bySheet = new Map();
  const byInvoice = new Map();
  for (const [cust, sales, date, inv, sheet] of rows) {
    const invNo = S(inv); const sh = S(sheet);
    if (!invNo || !sh || NO_INVOICE_RX.test(invNo)) continue;
    const net = Math.round((Number(sales) || 0) * 100) / 100;
    bySheet.set(sh, { invNo, net, date: serialToDate(date), cust: S(cust) });
    if (!byInvoice.has(invNo)) byInvoice.set(invNo, { net: 0, sheets: 0, date: serialToDate(date), cust: S(cust) });
    const g = byInvoice.get(invNo);
    g.net = Math.round((g.net + net) * 100) / 100;
    g.sheets += 1;
  }

  const W = mongoose.connection.collection('operationsworkflows');
  const I = mongoose.connection.collection('collectioninvoices');
  const numbers = [...bySheet.keys()];
  const found = await W.find({ reportNumber: { $in: numbers } })
    .project({ reportNumber: 1, invoiceNumber: 1, invoiceDate: 1, netInvoice: 1, tax: 1, totalInvoice: 1, paymentType: 1, paymentTypeSource: 1 })
    .toArray();
  const byNo = new Map(found.map((w) => [S(w.reportNumber), w]));

  const ops = [];
  const out = { updated: 0, unchanged: 0, conflicts: [], missing: [], keptManual: [], flippedToTax: 0 };
  for (const [sh, x] of bySheet) {
    const w = byNo.get(sh);
    if (!w) { out.missing.push(sh); continue; }

    const cur = S(w.invoiceNumber);
    if (cur && !NO_INVOICE_RX.test(cur) && cur !== x.invNo) {
      out.conflicts.push({ sheet: sh, system: cur, file: x.invNo });
    }

    const tax = Math.round(x.net * VAT_RATE * 100) / 100;
    const total = Math.round((x.net + tax) * 100) / 100;
    const set = {
      invoiceNumber: x.invNo,
      netInvoice: x.net,
      tax,
      totalInvoice: total,
    };
    if (x.date) set.invoiceDate = x.date;

    // اختيارُ اليد لا يُدهَس؛ وما سواه يتبع الفاتورة.
    const manual = S(w.paymentTypeSource) === 'manual';
    if (manual && w.paymentType !== 'tax') out.keptManual.push(sh);
    else if (w.paymentType !== 'tax') { set.paymentType = 'tax'; set.paymentTypeSource = 'auto'; out.flippedToTax += 1; }

    const same = S(w.invoiceNumber) === set.invoiceNumber
      && Math.abs((Number(w.netInvoice) || 0) - set.netInvoice) < 0.01
      && Math.abs((Number(w.totalInvoice) || 0) - set.totalInvoice) < 0.01
      && (!set.paymentType || w.paymentType === 'tax');
    if (same) { out.unchanged += 1; continue; }
    out.updated += 1;
    ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: set } } });
  }

  // ── والدفترُ يُكمَّل لا يُبدَّل ─────────────────────────────────────────────
  // إجماليُّ الفاتورة في الدفتر صحيحٌ (طوبق)، أمّا صافيها وضريبتُها فلم تُخزَّن.
  // فتُكتبان من مجموع كشوفها — فيُقرأ في الفاتورة ما يُقرأ في كشوفها.
  const invOps = [];
  const ledger = await I.find({ invoiceNumber: { $in: [...byInvoice.keys()] } })
    .project({ invoiceNumber: 1, net: 1, vat: 1, total: 1 }).toArray();
  let invFilled = 0; let invMismatch = 0;
  for (const inv of ledger) {
    const g = byInvoice.get(S(inv.invoiceNumber));
    if (!g) continue;
    const vat = Math.round(g.net * VAT_RATE * 100) / 100;
    const total = Math.round((g.net + vat) * 100) / 100;
    // إجماليٌّ لا يساوي مجموعَ كشوفِ الملفّ = فاتورةٌ تشمل كشوفًا خارج مدّته
    // (الملفُّ من ١ يناير). فلا يُكتب لها صافٍ ناقص — يُقال ولا يُخمَّن.
    if (Math.abs((Number(inv.total) || 0) - total) > 1) { invMismatch += 1; continue; }
    if (Math.abs((Number(inv.net) || 0) - g.net) < 0.01 && Math.abs((Number(inv.vat) || 0) - vat) < 0.01) continue;
    invFilled += 1;
    invOps.push({ updateOne: { filter: { _id: inv._id }, update: { $set: { net: g.net, vat } } } });
  }

  console.log({
    file: path.basename(file),
    fileRows: rows.length,
    sheetsInFile: bySheet.size,
    invoicesInFile: byInvoice.size,
    matchedSheets: bySheet.size - out.missing.length,
    willUpdate: out.updated,
    alreadyCorrect: out.unchanged,
    flippedToTax: out.flippedToTax,
    conflicts: out.conflicts.length,
    missingSheets: out.missing.length,
    keptManual: out.keptManual.length,
    ledgerInvoicesFilled: invFilled,
    ledgerTotalMismatch: invMismatch,
    applied: apply,
  });
  if (out.conflicts.length) {
    console.log('\nأرقامٌ في النظام تخالف الملفّ (الملفُّ هو المُعتمَد):');
    out.conflicts.slice(0, 20).forEach((c) => console.log(`  كشف ${c.sheet}: نظام ${c.system} ← ملف ${c.file}`));
    if (out.conflicts.length > 20) console.log(`  … و${out.conflicts.length - 20}`);
  }
  if (out.missing.length) console.log(`\nكشوفٌ في الملفّ ولا وجودَ لها في النظام (${out.missing.length}): ${out.missing.slice(0, 15).join('، ')}${out.missing.length > 15 ? ' …' : ''}`);
  if (out.keptManual.length) console.log(`\nنوعُ دفعها مكتوبٌ بيدٍ فلم يُمسّ (${out.keptManual.length}): ${out.keptManual.join('، ')}`);

  if (!apply) { console.log('\n— تجربةٌ فقط —'); process.exit(0); }

  const CHUNK = 1000;
  for (let i = 0; i < ops.length; i += CHUNK) await W.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
  for (let i = 0; i < invOps.length; i += CHUNK) await I.bulkWrite(invOps.slice(i, i + CHUNK), { ordered: false });
  console.log(`\n✓ كُتب على ${ops.length} كشفًا، و${invOps.length} فاتورةً في الدفتر.`);
  process.exit(0);
})();
