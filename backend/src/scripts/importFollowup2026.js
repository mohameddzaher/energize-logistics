/* eslint-disable no-console */
/**
 * importFollowup2026: follow-up sheet 2026 final into operations.
 * Fills empty fields only: a populated cell is never touched, since it may be a staff correction made after the sheet was written, and the audited system outranks the manual file.
 * Changes are saved to a rollback file before writing, because a 28k-record import cannot be reviewed by eye afterward.
 * Uses a streaming reader (lib/xlsxStream) because the 35 MB sheet XML exhausts memory when the xlsx library builds the whole workbook.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { readSheet, excelDate } = require('./lib/xlsxStream');

const FILE = path.join(__dirname, '../seeds/data/ops-2026-08/followup-2026-final.xlsx');
const SHEET = 'xl/worksheets/sheet2.xml';          // Sheet 2026, header on row 5
const HEADER_ROW = 5;

const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');
const CREATE_MISSING = process.argv.includes('--create-missing');

/** Excel column to model field, taken from row 5 verbatim. */
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

// Excel errors arrive as plain text; #N/A in a cell means blank, not a value.
const BAD = /^(#N\/A|#REF!|#VALUE!|#DIV\/0!|#NAME\?|#NULL!|#NUM!|-|\.|_+)$/;

// Some sheet columns are shifted. Three shifts were found across the file and each has a guard here; without them a date lands in a money field or a number in a branch field and becomes unexplained verified data.

/** A number within the serial-date range, i.e. a date that fell into a money cell. */
const looksLikeDate = (n) => n >= 44000 && n <= 48000;

/** Invoice money columns only; purchase and sale columns are fine in the file. */
const INVOICE_MONEY = new Set(['netInvoice', 'tax', 'totalInvoice']);

/** Branch is a name, not a number. */
const BRANCHY = new Set(['payingBranch', 'finalReportDestination', 'branch']);

const skips = { invoiceMoneyAsDate: 0, branchAsNumber: 0, accountingReview: 0, reviewJunk: 0, badDate: 0 };

/**
 * Normalizes the value, or returns undefined to reject it.
 * The operations review is a tick box in the UI, so OK/ok becomes done.
 * The accounts review rejects numbers: ticking accounts reviewed on an unknown number is a false report. Its column is practically empty in this file.
 */
function normalize(key, v) {
  if (key === 'accountingReview' && /^\d+(\.\d+)?$/.test(v)) { skips.accountingReview++; return undefined; }

  if (key === 'operationsReview') {
    if (/^(ok)$/i.test(v)) return 'تم';
    if (/^\d+(\.\d+)?$/.test(v)) { skips.reviewJunk++; return undefined; }
    return v;
  }

  if (key === 'taxIndicator') return /^cash$/i.test(v) ? 'cash' : v;

  if (BRANCHY.has(key) && /^\d+(\.\d+)?$/.test(v)) { skips.branchAsNumber++; return undefined; }

  return v;
}

/** Effectively empty: null or whitespace-only text; zero in a numeric field also counts as empty. */
function isEmpty(v, key) {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (typeof v === 'number') return NUMS.has(key) && v === 0;
  return false;
}

function parseRows() {
  const rows = readSheet(FILE, SHEET).filter((r) => r.r > HEADER_ROW);
  const out = new Map();                              // The last row for a duplicate number wins
  let skipped = 0;
  for (const { cells } of rows) {
    const rn = String(cells.B ?? '').trim();
    if (!rn || BAD.test(rn)) { skipped++; continue; }
    const rec = { reportNumber: rn };
    for (const [col, key] of Object.entries(COL)) {
      if (key === 'reportNumber') continue;
      let v = cells[col];
      if (v == null) continue;
      v = String(v).trim();
      if (!v || BAD.test(v)) continue;
      if (DATES.has(key)) {
        const d = excelDate(v);
        if (d) rec[key] = d; else skips.badDate++;
      } else if (NUMS.has(key)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n === 0) continue;
        if (INVOICE_MONEY.has(key) && looksLikeDate(n)) { skips.invoiceMoneyAsDate++; continue; }
        rec[key] = n;
      } else {
        const nv = normalize(key, v);
        if (nv !== undefined) rec[key] = nv;
      }
    }
    out.set(rn, rec);
  }
  return { recs: out, rawRows: rows.length, skipped };
}

function sameValue(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

(async () => {
  if (!fs.existsSync(FILE)) { console.error('✗ الملفّ غير موجود:', FILE); process.exit(1); }
  console.log('\n  المصدر: ' + path.basename(FILE));

  const { recs, rawRows, skipped } = parseRows();
  console.log(`  قُرئ ${rawRows} صفًّا · ${recs.size} رقم كشفٍ صالح · ${skipped} صفًّا بلا رقم.`);
  console.log('\n  خلايا رُفضت (أعمدةٌ انزلقت في الشيت):');
  console.log(`    مالُ فاتورةٍ قيمتُه تاريخ   : ${skips.invoiceMoneyAsDate}`);
  console.log(`    فرعٌ قيمتُه رقم            : ${skips.branchAsNumber}`);
  console.log(`    «مراجعه الحسابات» كلُّها أرقام: ${skips.accountingReview}`);
  console.log(`    «مراجعه التشغيل» رقمٌ عابث  : ${skips.reviewJunk}`);
  console.log(`    تاريخٌ خارج المدى المعقول  : ${skips.badDate}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const W = require('../models/OperationsWorkflow');
  const User = require('../models/User');

  const nums = [...recs.keys()];
  const existing = await W.find({ reportNumber: { $in: nums } }).lean();
  const byNum = new Map(existing.map((d) => [d.reportNumber, d]));
  const missing = nums.filter((n) => !byNum.has(n));

  console.log(`  في القاعدة: ${await W.countDocuments()} · تطابق: ${existing.length} · غير موجود: ${missing.length}\n`);

  // What will be filled
  const ops = [];
  const undo = [];
  const perField = {};
  for (const [rn, src] of recs) {
    const cur = byNum.get(rn);
    if (!cur) continue;
    const set = {};
    for (const key of Object.values(COL)) {
      if (key === 'reportNumber') continue;
      const s = src[key];
      if (s === undefined) continue;
      if (!isEmpty(cur[key], key)) continue;           // Rule: never overwrite a populated value
      if (sameValue(cur[key], s)) continue;
      set[key] = s;
      perField[key] = (perField[key] || 0) + 1;
    }
    if (!Object.keys(set).length) continue;
    ops.push({ updateOne: { filter: { _id: cur._id }, update: { $set: set } } });
    undo.push({ _id: String(cur._id), reportNumber: rn, before: Object.fromEntries(Object.keys(set).map((k) => [k, cur[k] ?? null])) });
  }

  const width = Math.max(...Object.keys(perField).map((k) => k.length), 20);
  console.log('  ما سيُملأ (الفارغ وحده):');
  console.log('  ' + '─'.repeat(width + 12));
  for (const [k, n] of Object.entries(perField).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + k.padEnd(width) + String(n).padStart(10));
  }
  console.log('  ' + '─'.repeat(width + 12));
  console.log(`  ${ops.length} سجلًّا سيُحدَّث · ${existing.length - ops.length} سجلًّا لا جديد فيه.`);

  if (CREATE_MISSING && missing.length) console.log(`  + ${missing.length} سجلًّا جديدًا سيُنشأ.`);
  else if (missing.length) console.log(`  · ${missing.length} رقم كشفٍ في الملفّ وليس عندنا — لن يُنشأ (أضف --create-missing).`);

  if (DRY || !YES) {
    console.log('\n  ' + (DRY ? '— تجربةٌ فقط، لم يُكتب شيء.' : '— لم يُمرَّر --yes، فلم يُكتب شيء.') + '\n');
    process.exit(0);
  }

  // Rollback file before any write
  const undoDir = path.join(__dirname, '../../backups');
  fs.mkdirSync(undoDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const undoPath = path.join(undoDir, `followup2026-undo-${stamp}.json`);
  fs.writeFileSync(undoPath, JSON.stringify(undo));
  console.log(`\n  ↩ ملفّ التراجع: ${path.relative(process.cwd(), undoPath)} (${undo.length} سجلًّا)`);

  let done = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const chunk = ops.slice(i, i + 1000);
    const r = await W.bulkWrite(chunk, { ordered: false });
    done += r.modifiedCount || 0;
    process.stdout.write(`\r  … حُدِّث ${done}/${ops.length}`);
  }
  console.log(`\r  ✓ حُدِّث ${done} سجلًّا.            `);

  if (CREATE_MISSING && missing.length) {
    const admin = await User.findOne({ email: 'admin@energize.com' }).select('_id').lean();
    if (!admin) { console.log('  ✗ لم يُعثر على المستخدم admin@energize.com — لم يُنشأ شيء.'); }
    else {
      const docs = missing.map((n) => ({ ...recs.get(n), createdBy: admin._id, stage: 'draft' }));
      let made = 0;
      for (let i = 0; i < docs.length; i += 1000) {
        const r = await W.insertMany(docs.slice(i, i + 1000), { ordered: false }).catch((e) => e.insertedDocs || []);
        made += (r.length || 0);
        process.stdout.write(`\r  … أُنشئ ${made}/${docs.length}`);
      }
      console.log(`\r  ✓ أُنشئ ${made} سجلًّا جديدًا.            `);
    }
  }

  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
