/**
 * importFollowUpSheet: loads the follow-up sheet into the manifests, not beside them.
 * Source is the 2026 sheet (about 29k rows, 30 columns) with fields the system never received: collection dates, invoice notes, nets and taxes, send and delivery dates.
 * Matching is by manifest number, the unique identity; no manifest is invented, existing ones are filled and missing ones counted.
 * Fill empty fields only: the system holds staff edits and the sheet is a snapshot from 30 Aug; differences are counted and shown, not applied. Dates are read as raw serials and converted in UTC. The reader library builds a local-time Date from the 1899 epoch, whose Riyadh offset (+3:00:52) loses a day on every date.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
// The file path is passed as an argument: a newer copy arrives every few weeks, and a hardcoded name would need editing each time or silently import a stale copy.
const FILE = process.argv.find((a) => a.endsWith('.xlsx'))
  || path.join(__dirname, '..', '..', '..', 'operation files', 'شيت المتابعه 2026 بتاريخ 3 سبتمبر 2026.xlsx');
const SHEET = '2026';
const HEADER_ROW = 4;

// Sheet column to our field, in sheet order.
const COLUMNS = [
  ['reportNumber', 'text'], ['reportDate', 'date'], ['fromLocation', 'text'], ['toLocation', 'text'],
  ['branch', 'text'], ['carOwner', 'text'], ['carNumber', 'text'], ['ownerType', 'text'],
  ['executionStatus', 'text'], ['applicationStatus', 'text'], ['paymentMethod', 'text'], ['username', 'text'],
  ['taxIndicator', 'text'], ['purchaseValue', 'num'], ['sellingValue', 'num'], ['operationsReview', 'text'],
  ['paymentDate', 'date'], ['payingBranch', 'text'], ['finalReportDestination', 'text'], ['documentNumber', 'text'],
  // The sheet's delivery date is the branch delivery (operations work), placed before the invoice columns. Delivery of the invoice to the customer, which starts the payment term, is written by collections into deliveryDate and does not come from this file.
  ['sendingDate', 'date'], ['branchDeliveryDate', 'date'], ['accountingReview', 'text'], ['invoiceNumber', 'text'],
  ['netInvoice', 'num'], ['tax', 'num'], ['totalInvoice', 'num'], ['invoiceDate', 'date'],
  ['invoiceNotes', 'text'], ['collectionDate', 'date'],
];

// Not imported: platform columns are pulled live every minute and the sheet copy is an old snapshot. Filling gaps from it would mix two sources in one row with no way to tell which to trust.
const SKIP = new Set(['reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod', 'username']);

/** Excel date epoch: 1899-12-30 UTC. */
const XLS_EPOCH = Date.UTC(1899, 11, 30);
/** The day as Excel wrote it, at UTC midnight, without going through device time. */
const readDate = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return null;
    const dt = new Date(XLS_EPOCH + Math.round(v * 86400000));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const s = String(v).trim();
  if (!s) return null;
  // Day-first formats as written on the sheet, e.g. 18/01/2026 and 1/1/26.
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
};
const readNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const readText = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return null;               // Date in a text cell: skipped
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (s === '') return null;
  // A placeholder for blank is not copied from sheet to database. The no-invoice placeholder means no invoice; since it now reads as blank here, the sheet would have overwritten it on about 1,900 manifests, a no-op counted as 1,900 edits.
  return PLACEHOLDER.test(s) ? null : s;
};
const READ = { text: readText, num: readNum, date: readDate };

// A blank placeholder is blank. Values such as no-invoice, none or a dash are the employee's way of saying there is no invoice, not invoice numbers. Counting them as written would stop the sheet from writing the real number over them.
// So placeholders are treated as blank: filled, and not counted as a difference.
const PLACEHOLDER = /^\s*(?:no\s*inv(?:oice)?|noinv|no-inv|none|n\/a|na|-|—|بدون(?:\s*فاتورة)?|لا\s*يوجد|لا\s*توجد|غير\s*مفوتر(?:ة)?)\s*$/i;
const isEmpty = (v) => v == null || v === ''
  || (typeof v === 'string' && (v.trim() === '' || PLACEHOLDER.test(v)));

// The tax column feeds the payment type but does not decide it. It is the best source for about 30k manifests that have no type, but a customer may pay some loads cash and others tax, so the type is a per-manifest decision with its own history.
// Same rule as this file: fill empty, never overwrite. Staff choices stay and unset ones take the sheet's answer.
const readPaymentType = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (/^(cash|كاش|نقد|غ\s*ض|غير\s*ضريب)/.test(s)) return 'cash';
  if (/^(tax|ضريب|ض)$|ضريب/.test(s)) return 'tax';
  return null;      // Unrecognised wording: skipped, not guessed.
};
const sameDay = (a, b) => a && b && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const OW = require('../models/OperationsWorkflow');

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');
  // cellDates is false so dates stay serial numbers and are read in UTC.
  const wb = XLSX.readFile(FILE, { cellDates: false, raw: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: null, blankrows: false, raw: true });
  const rows = raw.slice(HEADER_ROW + 1);
  console.log(`صفوفُ الورقة «${SHEET}»: ${rows.length}`);

  // Read the sheet first and fold it by manifest number.
  const bySheet = new Map();
  let noNumber = 0; let dupes = 0;
  for (const r of rows) {
    const no = readText(r[0]) || (r[0] != null ? String(r[0]).trim() : '');
    if (!no || !/^\d+$/.test(no)) { noNumber += 1; continue; }
    const vals = {};
    COLUMNS.forEach(([field, kind], i) => {
      if (SKIP.has(field)) return;
      const v = READ[kind](r[i]);
      if (v !== null) vals[field] = v;
      // Payment type is derived from the same column and fills manifests that have none.
      if (field === 'taxIndicator') {
        const pt = readPaymentType(r[i]);
        if (pt) vals.paymentType = pt;
      }
    });
    if (bySheet.has(no)) dupes += 1;
    bySheet.set(no, vals);               // Latest row in the sheet wins
  }
  console.log(`  بلا رقم كشفٍ صالح: ${noNumber}`);
  console.log(`  أرقامٌ مكرّرة (يُؤخذ آخرُها): ${dupes}`);
  console.log(`  أرقامٌ فريدة: ${bySheet.size}\n`);

  // Then our manifests, in batches: tens of thousands of numbers in one $in drop the connection to the shared cluster, so query small batches that use the manifest number index.
  const FIELDS = [...COLUMNS.map(([f]) => f).filter((f) => !SKIP.has(f)), 'paymentType'];
  const SELECT = ['reportNumber', ...FIELDS].join(' ');
  const keys = [...bySheet.keys()];
  const ours = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const part = await OW.find({ reportNumber: { $in: keys.slice(i, i + 1000) } })
      .select(SELECT).lean();
    ours.push(...part);
    process.stdout.write(`\r  قُرئ ${Math.min(i + 1000, keys.length)}/${keys.length}…`);
  }
  console.log(`\nمنها في نظامنا: ${ours.length}`);
  console.log(`لا وجودَ لها عندنا (تُترك، لا تُنشأ): ${bySheet.size - ours.length}\n`);

  const filled = {}; const conflict = {}; const same = {};
  for (const f of FIELDS) { filled[f] = 0; conflict[f] = 0; same[f] = 0; }
  const ops = [];
  let rowsTouched = 0;

  for (const doc of ours) {
    const v = bySheet.get(doc.reportNumber);
    if (!v) continue;
    const patch = {};
    for (const f of FIELDS) {
      if (!(f in v)) continue;
      const mine = doc[f];
      if (isEmpty(mine) || mine === 0) { patch[f] = v[f]; filled[f] += 1; continue; }
      const equal = v[f] instanceof Date ? sameDay(mine, v[f]) : String(mine).trim() === String(v[f]).trim();
      if (equal) same[f] += 1; else conflict[f] += 1;
    }
    if (Object.keys(patch).length) {
      rowsTouched += 1;
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: patch } } });
    }
  }

  console.log('العمود                        يُملأ   مطابق   مختلف (يُترك)');
  console.log('─'.repeat(62));
  for (const f of FIELDS) {
    if (!filled[f] && !conflict[f] && !same[f]) continue;
    console.log(`  ${f.padEnd(26)} ${String(filled[f]).padStart(6)} ${String(same[f]).padStart(7)} ${String(conflict[f]).padStart(8)}`);
  }
  console.log('─'.repeat(62));
  console.log(`\nكشوفٌ ستتغيّر: ${rowsTouched}`);

  if (!DRY && ops.length) {
    let done = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OW.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      done += r.modifiedCount || 0;
      process.stdout.write(`\r  كُتب ${done}/${ops.length}…`);
    }
    console.log(`\n✓ عُدِّل ${done} كشفًا`);
  }

  const after = await OW.countDocuments({ collectionDate: { $ne: null } });
  console.log(`\nكشوفٌ لها تاريخُ تحصيلٍ الآن: ${after}`);
  const pt = await OW.aggregate([{ $group: { _id: '$paymentType', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('نوعُ الدفع في السجلّ الآن:');
  for (const x of pt) console.log(`  ${String(x.n).padStart(6)}  ${x._id || '(بلا نوع)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
