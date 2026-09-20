/**
 * ما لم يُحسَم في ربط دفتر التحصيل بكشوف التشغيل — ملفٌّ يُراجَع بالعين.
 *
 * استيرادُ الدفتر (scripts/importCollectionsInvoiceLinks) كتب رقمَ الفاتورة على
 * كشوفها. وبقيت ثلاثُ فئاتٍ لا يصحّ فيها قرارٌ آليّ:
 *
 *   ١. كشوفٌ في الملفّ لا وجودَ لها في النظام — لا صفَّ يُكتب عليه.
 *   ٢. كشوفٌ كان لها في النظام رقمُ فاتورةٍ آخر. والملفُّ هو المُعتمَد فكُتب،
 *      والرقمُ القديم يُستخرَج من `CollectionInvoice.reportNumbers` — وهو
 *      الربطُ الذي كتبه استيرادُ الدفتر السابق، فبقي محفوظًا.
 *   ٣. فواتيرُ إجماليُّها في الدفتر أكبرُ من مجموع كشوفها في هذا الملفّ: تشمل
 *      كشوفًا أقدمَ من أوّل يناير (مدى الملفّ)، فلم يُكتب لها صافٍ ناقص.
 *
 * والأعمدةُ تقول لكلّ رقمٍ من أين جاء: «في الملفّ» و«في النظام» و«الفرق».
 *
 *   node src/scripts/reportCollectionsImportGaps.js [path.xlsx]
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '../../..');
const DEFAULT_FILE = path.join(ROOT, 'collection files/1-1-2026 to 19-9-2026.xlsx');
const OUT = path.join(ROOT, 'مراجعة ربط الفواتير بالكشوف.xlsx');
const VAT_RATE = 0.15;
const S = (v) => String(v ?? '').trim();
const r2 = (n) => Math.round(n * 100) / 100;
const serialToISO = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  return new Date(Date.UTC(1899, 11, 30) + num * 86400000).toISOString().slice(0, 10);
};

(async () => {
  const file = process.argv.find((a) => a.endsWith('.xlsx')) || DEFAULT_FILE;
  await mongoose.connect(process.env.MONGODB_URI);

  const wb = XLSX.readFile(file, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false, raw: true }).slice(1);

  const bySheet = new Map();
  const byInvoice = new Map();
  for (const [cust, sales, date, inv, sheet] of rows) {
    const invNo = S(inv); const sh = S(sheet);
    if (!invNo || !sh) continue;
    const net = r2(Number(sales) || 0);
    bySheet.set(sh, { invNo, net, date: serialToISO(date), cust: S(cust) });
    if (!byInvoice.has(invNo)) byInvoice.set(invNo, { net: 0, sheets: [], date: serialToISO(date), cust: S(cust) });
    const g = byInvoice.get(invNo);
    g.net = r2(g.net + net);
    g.sheets.push(sh);
  }

  const W = mongoose.connection.collection('operationsworkflows');
  const I = mongoose.connection.collection('collectioninvoices');
  const numbers = [...bySheet.keys()];

  const wfs = await W.find({ reportNumber: { $in: numbers } })
    .project({ reportNumber: 1, invoiceNumber: 1, username: 1, reportDate: 1, sellingValue: 1, purchaseValue: 1, paymentType: 1, branch: 1 }).toArray();
  const byNo = new Map(wfs.map((w) => [S(w.reportNumber), w]));

  // الربطُ القديم محفوظٌ في الدفتر نفسِه — فاتورةٌ تحمل أرقامَ كشوفها.
  const linked = await I.find({ 'reportNumbers.0': { $exists: true } })
    .project({ invoiceNumber: 1, reportNumbers: 1, partyName: 1, total: 1, invoiceDate: 1 }).toArray();
  const oldInvoiceOf = new Map();
  for (const inv of linked) for (const rn of inv.reportNumbers || []) oldInvoiceOf.set(S(rn), inv);

  // ── ١ · كشوفٌ في الملفّ لا وجودَ لها في النظام ────────────────────────────
  const missing = [];
  for (const [sh, x] of bySheet) {
    if (byNo.has(sh)) continue;
    missing.push({
      'رقم الكشف (في الملف)': sh,
      'رقم الفاتورة (في الملف)': x.invNo,
      'تاريخ الفاتورة (في الملف)': x.date,
      'العميل (في الملف)': x.cust,
      'صافي نصيب الكشف (في الملف)': x.net,
      'الحالة في النظام': 'لا يوجد كشف بهذا الرقم',
      'المطلوب': 'يُراجَع الرقم في الملف، أو يُدخَل الكشف في التشغيل ثم يُعاد الاستيراد',
    });
  }

  // ── ٢ · كشوفٌ كان لها رقمٌ آخر في النظام ─────────────────────────────────
  const conflicts = [];
  for (const [sh, x] of bySheet) {
    const w = byNo.get(sh);
    if (!w) continue;
    const old = oldInvoiceOf.get(sh);
    if (!old || S(old.invoiceNumber) === x.invNo) continue;
    conflicts.push({
      'رقم الكشف': sh,
      'رقم الفاتورة قبل الاستيراد (دفتر التحصيل السابق)': S(old.invoiceNumber),
      'رقم الفاتورة بعد الاستيراد (الملف الجديد)': x.invNo,
      'المكتوب الآن في النظام': S(w.invoiceNumber),
      'العميل (في الملف)': x.cust,
      'العميل على الفاتورة القديمة': S(old.partyName),
      'صافي نصيب الكشف (في الملف)': x.net,
      'إجمالي الفاتورة القديمة (الدفتر)': Number(old.total) || 0,
      'تاريخ الكشف': w.reportDate ? new Date(w.reportDate).toISOString().slice(0, 10) : '',
      'تاريخ الفاتورة (في الملف)': x.date,
      'المطلوب': 'يُؤكَّد أيُّ الرقمين هو الصحيح لهذا الكشف',
    });
  }

  // ── ٣ · فواتيرُ إجماليُّها أكبرُ من مجموع كشوفها في الملفّ ─────────────────
  const ledger = await I.find({ invoiceNumber: { $in: [...byInvoice.keys()] } })
    .project({ invoiceNumber: 1, partyName: 1, total: 1, net: 1, vat: 1, invoiceDate: 1, reportNumbers: 1 }).toArray();
  const bigger = [];
  for (const inv of ledger) {
    const g = byInvoice.get(S(inv.invoiceNumber));
    if (!g) continue;
    const vat = r2(g.net * VAT_RATE);
    const total = r2(g.net + vat);
    const diff = r2((Number(inv.total) || 0) - total);
    if (Math.abs(diff) <= 1) continue;
    bigger.push({
      'رقم الفاتورة': S(inv.invoiceNumber),
      'العميل (في الدفتر)': S(inv.partyName),
      'إجمالي الفاتورة (في الدفتر)': r2(Number(inv.total) || 0),
      'عدد كشوفها في الملف': g.sheets.length,
      'مجموع صافي كشوفها (في الملف)': g.net,
      'الإجمالي المحسوب من الملف (صافي + ١٥٪)': total,
      'الفرق (دفتر − ملف)': diff,
      'صافٍ غير مفسَّر (الفرق ÷ ١٫١٥)': r2(diff / (1 + VAT_RATE)),
      'التفسير المرجَّح': diff > 0 ? 'تشمل كشوفًا أقدم من ١ يناير ٢٠٢٦ (خارج مدى الملف)' : 'مجموع كشوف الملف أكبر من إجمالي الدفتر — يُراجَع',
      'ما فُعل': 'لم يُكتب لها صافٍ ولا ضريبة في الدفتر — تُركت كما هي',
    });
  }

  // ── ورقةُ الشرح ───────────────────────────────────────────────────────────
  const guide = [
    { 'الورقة': '١ · كشوف غير موجودة', 'ماذا تعني': 'كشوفٌ مكتوبةٌ في ملفّ التحصيل ولا يوجد لها كشفٌ بهذا الرقم في سير عمل التشغيل', 'العدد': missing.length, 'ما فُعل': 'لم يُكتب شيء — لا صفَّ يُكتب عليه' },
    { 'الورقة': '٢ · أرقام فواتير مختلفة', 'ماذا تعني': 'الكشفُ كان مربوطًا في النظام بفاتورةٍ، والملفُّ الجديد يقول فاتورةً أخرى', 'العدد': conflicts.length, 'ما فُعل': 'كُتب رقمُ الملفّ (هو المُعتمَد)، والرقمُ السابق في العمود المجاور' },
    { 'الورقة': '٣ · فواتير إجماليها أكبر', 'ماذا تعني': 'إجماليُّ الفاتورة في الدفتر أكبرُ من مجموع كشوفها في هذا الملفّ — غالبًا تشمل كشوفَ ٢٠٢٥', 'العدد': bigger.length, 'ما فُعل': 'لم يُكتب لها صافٍ في الدفتر بدل كتابة رقمٍ ناقص' },
    { 'الورقة': '—', 'ماذا تعني': 'ما تمّ بنجاح: كُتب رقمُ الفاتورة وتاريخُها وصافيها على ١٨٬١٢٣ كشفًا، وطوبق ٢٠٬٩٠٩ كشفًا من ٢١٬٠١٥', 'العدد': 18123, 'ما فُعل': 'الضريبةُ ١٥٪ والإجماليُّ مجموعُهما — كما في النظام' },
  ];

  const out = XLSX.utils.book_new();
  const add = (name, data, cols) => {
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 'لا صفوف': '' }]);
    ws['!cols'] = cols;
    // الورقةُ تُقرأ من اليمين — وإلّا قُرئت الأعمدةُ معكوسة.
    ws['!sheetViews'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(out, ws, name);
  };
  const w = (n) => Array.from({ length: n }, () => ({ wch: 22 }));
  add('الشرح', guide, [{ wch: 26 }, { wch: 80 }, { wch: 10 }, { wch: 60 }]);
  add('١ كشوف غير موجودة', missing, w(7));
  add('٢ أرقام فواتير مختلفة', conflicts, w(11));
  add('٣ فواتير إجماليها أكبر', bigger, w(10));
  XLSX.writeFile(out, OUT);

  console.log({ missing: missing.length, conflicts: conflicts.length, biggerTotals: bigger.length, out: OUT });
  process.exit(0);
})();
