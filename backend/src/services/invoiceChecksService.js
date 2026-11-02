/**
 * Invoice checks in the operations workflow: four live cards.
 * 1) invoices not issued: gaps in the tax invoice sequence.
 * 2) invoices with missing reports: a sales-sheet line names a report that does not exist.
 * 3) invoice amount difference: the sheet's invoice value differs from the sum of its reports.  4) customer name mismatch: the sheet's customer differs from the report's customer. All are computed from the DB at request time and cached for 30 seconds under `wf:`, which every report write and sync clears, so a corrected report drops off the card and a higher invoice number extends the sequence immediately.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const InvoiceUploadLine = require('../models/InvoiceUploadLine');
const { hasTaxInvoice } = require('../utils/paymentType');
const { westernDigits, searchKey } = require('../utils/arabicSearch');
const cache = require('../utils/ttlCache');

const CACHE_KEY = 'wf:invchecks';
const CACHE_TTL = 30 * 1000;

// When a number is an outlier, not a start or end. A number more than 1000 from its neighbours is not part of the sequence: a typo ("120184" for "12184") or an invoice from another book. Taking it as a bound would make everything between it and the sequence "missing", thousands of nonexistent numbers, so it is listed on its own.
const OUTLIER_GAP = 1000;
// Cap on list size; a fully broken sequence must not return a hundred thousand lines.
const MAX_GAPS = 20000;
// Smallest value difference that counts: one riyal. Tax rounding fractions (15% per line or on the total) are not disputes.
const VALUE_TOLERANCE = 1;

const CANCELLED_EXEC = ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The numbers carried by an invoice-number text. The cell usually holds one number, sometimes several ("12184 / 12185"). Digits and separators only: all its numbers count as present. With letters ("INV-12184") it is not guessed; it is counted as non-numeric. Placeholders ("no inv", "none") are not numbers at all; see `hasTaxInvoice`. */
function numbersIn(raw) {
  const s = westernDigits(String(raw == null ? '' : raw)).trim();
  if (!hasTaxInvoice({ invoiceNumber: s })) return { kind: 'none', nums: [] };
  const rest = s.replace(/\d+/g, '').replace(/[\s,،/\\\-&+و.]+/g, '');
  if (rest) return { kind: 'text', nums: [] };
  return { kind: 'num', nums: (s.match(/\d+/g) || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) };
}

/**
 * Where the sequence starts and ends.
 * The end is the highest number written on a report, live as invoices are written. The start is the lowest number in the main cluster: numbers are split wherever adjacent ones are more than `OUTLIER_GAP` apart, and the largest cluster by count is used. So an outlier at either end does not create thousands of phantom gaps, and it is listed separately.
 * It does not start at the beginning of the collections ledger, which holds nine thousand pre-system invoices, mostly for reports never in the workflow; that would report thousands of "not issued" for invoices issued and collected before the table existed.
 * `WF_INVOICE_SEQ_START` in the environment pins the start if the accountant decides it.
 */
function sequenceBounds(sorted) {
  if (!sorted.length) return null;
  const clusters = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > OUTLIER_GAP) { clusters.push(cur); cur = []; }
    cur.push(sorted[i]);
  }
  clusters.push(cur);
  // The largest by count; on a tie, the latest (highest).
  const main = clusters.reduce((a, b) => (b.length > a.length || (b.length === a.length && b[b.length - 1] > a[a.length - 1]) ? b : a));
  const envStart = Number(process.env.WF_INVOICE_SEQ_START);
  const useEnv = Number.isSafeInteger(envStart) && envStart > 0 && envStart <= main[main.length - 1];
  const start = useEnv ? envStart : main[0];
  const end = main[main.length - 1];
  const outliers = sorted.filter((n) => n < start || n > end);
  return { start, end, startSource: useEnv ? 'env' : 'data', outliers };
}

/** Invoices not issued: every number between the start and the highest that no report carries. */
async function computeGaps() {
  const raw = await OperationsWorkflow.distinct('invoiceNumber');
  const present = new Set();
  const textual = [];
  for (const v of raw) {
    const r = numbersIn(v);
    if (r.kind === 'num') r.nums.forEach((n) => present.add(n));
    else if (r.kind === 'text') textual.push(String(v).trim());
  }
  const sorted = [...present].sort((a, b) => a - b);
  const b = sequenceBounds(sorted);
  if (!b) return { count: 0, rows: [], start: null, end: null, startSource: 'data', outliers: [], textual, present: 0 };

  const nums = [];
  for (let n = b.start; n <= b.end && nums.length < MAX_GAPS; n++) if (!present.has(n)) nums.push(n);

  // What the collections ledger knows about each missing number. A number is not hidden because the ledger knows it; its status is shown beside it: reserved and unused, cancelled, or an invoice issued in the ledger with no report here. Plus uploaded sales sheets: a number in the sheet whose reports do not exist.
  const strs = nums.map(String);
  const CollectionInvoice = require('../models/CollectionInvoice');
  const [ledger, uploaded] = await Promise.all([
    strs.length ? CollectionInvoice.find({ kind: 'tax', invoiceNumber: { $in: strs } })
      .select('invoiceNumber unused status partyName total invoiceDate').lean() : [],
    strs.length ? InvoiceUploadLine.aggregate([
      { $match: { invoiceNumber: { $in: strs } } },
      { $group: { _id: '$invoiceNumber', lines: { $sum: 1 }, total: { $sum: { $ifNull: ['$total', 0] } }, customer: { $first: '$customerName' } } },
    ]) : [],
  ]);
  const led = new Map();
  for (const l of ledger) {
    const k = String(l.invoiceNumber).trim();
    const prev = led.get(k);
    // One number may have several ledger rows (two accounts); the clearest wins.
    if (!prev || (prev.unused && !l.unused)) led.set(k, l);
  }
  const up = new Map(uploaded.map((u) => [String(u._id), u]));

  let reserved = 0; let cancelled = 0; let inLedger = 0; let inUpload = 0;
  const rows = nums.map((n) => {
    const k = String(n);
    const l = led.get(k); const u = up.get(k);
    let note = ''; let noteAr = '';
    if (l && l.unused) { note = 'reserved'; noteAr = 'محجوز في دفتر التحصيل — لم يُستعمل'; reserved += 1; }
    else if (l && /cancel|ملغ/i.test(l.status || '')) { note = 'cancelled'; noteAr = 'ملغاة في دفتر التحصيل'; cancelled += 1; }
    else if (l) { note = 'ledger'; noteAr = 'صادرة في دفتر التحصيل ولا أمر نقل عليها'; inLedger += 1; }
    else if (u) { note = 'uploaded'; noteAr = 'في ورقة المبيعات المرفوعة — كشوفها غير موجودة'; inUpload += 1; }
    return {
      invoiceNumber: k, note, noteAr,
      ledgerParty: l ? (l.partyName || '') : (u ? (u.customer || '') : ''),
      ledgerTotal: l && !l.unused ? r2(l.total) : (u ? r2(u.total) : null),
      ledgerDate: l ? (l.invoiceDate || null) : null,
    };
  });
  return {
    count: rows.length,
    capped: nums.length >= MAX_GAPS,
    reserved, cancelled, inLedger, inUpload,
    unknown: rows.length - reserved - cancelled - inLedger - inUpload,
    start: b.start, end: b.end, startSource: b.startSource, outliers: b.outliers,
    textual, present: sorted.length,
    rows,
  };
}

/** Name comparison key. Folds what is not a visible difference: all spaces (hard, doubled, edge), direction and zero-width marks, Arabic hamza/ta marbuta/ya variants, diacritics and Indic digits (`searchKey`). What remains is a real difference. */
const nameCmpKey = (s) => searchKey(String(s || '').replace(/[​-‏‪-‮⁠-⁯﻿]/g, ''));

/** A collections party's names (`aliases`) count as one name: a customer renamed on the platform keeps its old name as an alias, and the sheet may use either. */
async function partyKeyIndex() {
  return cache.wrap('wf:invchecks:parties', 5 * 60 * 1000, async () => {
    const CollectionsParty = require('../models/CollectionsParty');
    const parties = await CollectionsParty.find({ kind: 'customer' }).select('name aliases').lean();
    const idx = {};
    for (const p of parties) {
      for (const n of [p.name, ...(p.aliases || [])]) {
        const k = nameCmpKey(n);
        if (k && !idx[k]) idx[k] = String(p._id);
      }
    }
    return idx;
  });
}

/**
 * The three checks over the sales sheet lines.
 * @param {object[]} lines    lines {invoiceNumber, reportNumber, total, net, tax, customerName, ...}
 * @param {Map}      overlay  (preview) report number -> what will be written to it, so reports are read as they will be after applying, not as they are now.
 */
async function checkLines(lines, overlay = null) {
  const real = lines.filter((l) => hasTaxInvoice({ invoiceNumber: l.invoiceNumber }) && String(l.reportNumber || '').trim());
  const reportNums = [...new Set(real.map((l) => String(l.reportNumber).trim()))];
  const invNums = [...new Set(real.map((l) => String(l.invoiceNumber).trim()))];
  const SEL = 'reportNumber username invoiceNumber netInvoice tax totalInvoice paymentType executionStatus';
  const [byRep, byInv, parties] = await Promise.all([
    reportNums.length ? OperationsWorkflow.find({ reportNumber: { $in: reportNums } }).select(SEL).lean() : [],
    invNums.length ? OperationsWorkflow.find({ invoiceNumber: { $in: invNums } }).select(SEL).lean() : [],
    partyKeyIndex(),
  ]);
  const rows = new Map();
  for (const w of [...byRep, ...byInv]) rows.set(String(w._id), { ...w });
  if (overlay) {
    for (const w of rows.values()) {
      const p = overlay.get(String(w.reportNumber || '').trim());
      if (p) Object.assign(w, p);
    }
  }
  const repMap = new Map();
  for (const w of rows.values()) repMap.set(String(w.reportNumber || '').trim(), w);

  // 2) report does not exist.
  const missingReports = real.filter((l) => !repMap.has(String(l.reportNumber).trim())).map((l) => ({
    invoiceNumber: l.invoiceNumber, reportNumber: l.reportNumber, customerName: l.customerName || '',
    total: l.total ?? null, uploadedAt: l.uploadedAt || null, uploadedByName: l.uploadedByName || '', fileName: l.fileName || '',
  }));

  // 3) value difference, against the same sum the collections ledger computes per invoice (`syncOpsInvoices`): total of the non-cancelled tax reports carrying the number. The total is net plus 15%, derived by `applyBillingRules`, and is compared with the sheet's net total. A line whose report does not exist is excluded: its difference is explained on its own card, and counting it here would make one error two cards.
  const upByInv = new Map();
  for (const l of real) {
    if (!repMap.has(String(l.reportNumber).trim())) continue;
    const k = String(l.invoiceNumber).trim();
    const t = l.total != null ? Number(l.total)
      : (l.net != null ? Number(l.net) + (l.tax != null ? Number(l.tax) : Number(l.net) * 0.15) : 0);
    const g = upByInv.get(k) || { invoiceNumber: k, uploaded: 0, lines: 0, customerName: l.customerName || '', reports: [] };
    g.uploaded += t; g.lines += 1; g.reports.push(String(l.reportNumber).trim());
    upByInv.set(k, g);
  }
  const wfByInv = new Map();
  for (const w of rows.values()) {
    const k = String(w.invoiceNumber || '').trim();
    if (!upByInv.has(k)) continue;
    if (w.paymentType === 'cash' || CANCELLED_EXEC.includes(String(w.executionStatus || '').trim())) continue;
    const g = wfByInv.get(k) || { total: 0, count: 0, net: 0 };
    g.total += Number(w.totalInvoice) || 0; g.net += Number(w.netInvoice) || 0; g.count += 1;
    wfByInv.set(k, g);
  }
  const valueDiffs = [];
  for (const [k, g] of upByInv) {
    const w = wfByInv.get(k) || { total: 0, count: 0, net: 0 };
    const diff = r2(g.uploaded - w.total);
    if (Math.abs(diff) > VALUE_TOLERANCE) {
      valueDiffs.push({
        invoiceNumber: k, customerName: g.customerName, uploadedValue: r2(g.uploaded), uploadedLines: g.lines,
        reportsValue: r2(w.total), reportsNet: r2(w.net), reportsCount: w.count, difference: diff,
      });
    }
  }
  valueDiffs.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  // 4) customer name.
  const nameMismatches = [];
  for (const l of real) {
    const w = repMap.get(String(l.reportNumber).trim());
    if (!w) continue;
    const a = nameCmpKey(l.customerName); const b = nameCmpKey(w.username);
    if (!a || !b || a === b) continue;
    if (parties[a] && parties[a] === parties[b]) continue;   // Two spellings of one party
    nameMismatches.push({
      invoiceNumber: l.invoiceNumber, reportNumber: l.reportNumber,
      uploadedCustomer: l.customerName, workflowCustomer: w.username || '',
      uploadedAt: l.uploadedAt || null, uploadedByName: l.uploadedByName || '',
    });
  }
  return { missingReports, valueDiffs, nameMismatches };
}

/** The four cards and their lists: one computation cached for 30 seconds. */
async function computeAll() {
  return cache.wrap(CACHE_KEY, CACHE_TTL, async () => {
    const [gaps, lines, last] = await Promise.all([
      computeGaps(),
      InvoiceUploadLine.find({}).select('invoiceNumber reportNumber total net tax customerName uploadedAt uploadedByName fileName').lean(),
      InvoiceUploadLine.findOne({}).sort({ uploadedAt: -1 }).select('uploadedAt uploadedByName fileName batchId').lean(),
    ]);
    const checks = await checkLines(lines);
    return { gaps, ...checks, uploadedLines: lines.length, lastUpload: last || null, at: new Date().toISOString() };
  });
}

async function summary() {
  const a = await computeAll();
  const { rows, ...g } = a.gaps;
  return {
    gaps: g,
    missingReports: { count: a.missingReports.length },
    valueDiffs: { count: a.valueDiffs.length, sumAbs: r2(a.valueDiffs.reduce((s, x) => s + Math.abs(x.difference), 0)) },
    nameMismatches: { count: a.nameMismatches.length },
    uploadedLines: a.uploadedLines,
    lastUpload: a.lastUpload,
    at: a.at,
  };
}

const KINDS = { gaps: (a) => a.gaps.rows, 'missing-reports': (a) => a.missingReports, 'value-diffs': (a) => a.valueDiffs, 'name-mismatches': (a) => a.nameMismatches };
async function list(kind) {
  if (!KINDS[kind]) return null;
  const a = await computeAll();
  return KINDS[kind](a);
}

/** Saves the sheet lines after applying. A line (invoice, report) overwrites its counterpart from an earlier sheet. A report that moved to another invoice in the newest sheet has its old lines on others deleted, or it would still count in its old invoice's value and create a phantom difference. */
async function persistLines(lines, meta) {
  const real = lines.filter((l) => hasTaxInvoice({ invoiceNumber: l.invoiceNumber }) && String(l.reportNumber || '').trim());
  if (!real.length) return 0;
  const ops = [];
  for (const l of real) {
    const inv = String(l.invoiceNumber).trim(); const rep = String(l.reportNumber).trim();
    ops.push({ deleteMany: { filter: { reportNumber: rep, invoiceNumber: { $ne: inv } } } });
    ops.push({
      updateOne: {
        filter: { invoiceNumber: inv, reportNumber: rep },
        update: {
          $set: {
            net: l.net ?? null, tax: l.tax ?? null, total: l.total ?? null,
            customerName: l.customerName || '', invoiceDate: l.invoiceDate || null,
            sheet: l.sheet || '', sheetRow: l.sheetRow ?? null,
            batchId: meta.batchId, fileName: meta.fileName || '', uploadedAt: meta.at,
            uploadedBy: meta.userId, uploadedByName: meta.userName || '',
          },
        },
        upsert: true,
      },
    });
  }
  await InvoiceUploadLine.bulkWrite(ops, { ordered: true });
  return real.length;
}

module.exports = {
  summary, list, checkLines, persistLines, computeGaps, sequenceBounds, numbersIn, nameCmpKey,
  KINDS: Object.keys(KINDS), OUTLIER_GAP, VALUE_TOLERANCE,
};
