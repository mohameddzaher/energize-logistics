/**
 * Imports the company's customs master spreadsheet (src/seeds/data/customs-master-2026-08.xlsx, override with --file=<path>) into CustomsClearance; preview by default, --apply writes.
 * Sheets: Clearance (base records), Accounts (per-BL P&L, authoritative for money), Sheet3 (costing; only source of customs fees + storage), Sheet2 (container grain, merged BL cells forward-filled). UI_AI_dashboard is a mock-up and is not imported.
 * The BL number is the key: existing records are updated in place, unknown BLs inserted, nothing deleted; a BL repeated in the sheet (MEDUWA259425) is disambiguated by legacySerial. Enrichment order: Clearance -> Sheet3 -> Accounts, non-empty values only; a blank, #N/A or - cell never overwrites existing data.
 * Stage is inferred from the highest unambiguous done marker (invoice, returns, unloading, port, DO link, DO payment, customs payment) and never moves backwards.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CustomsClearance = require('../models/CustomsClearance');
const { STAGES, recomputeTotals: recomputeRaw, seedPricesFromNets, COST_KEYS, MARGIN_KEYS, readStages, lockReason } = require('../models/CustomsClearance');
// The sheet gives nets, not prices: seed the price so the derived net equals the sheet's.
const recomputeTotals = (r) => recomputeRaw(seedPricesFromNets(r));

// From October 2026 the customs team works on the system itself: those rows are never imported.
const SYSTEM_FROM = { year: 2026, month: 10 };
const fromSystemPeriod = (r) => r.periodYear > SYSTEM_FROM.year
  || (r.periodYear === SYSTEM_FROM.year && r.periodMonth >= SYSTEM_FROM.month);
// A record with work recorded on the system is never overwritten by the sheet.
const workedOnSystem = (e) => (e.paymentStages || []).some((p) => Number(p && p.amount) > 0)
  || (e.saleItems || []).length > 0 || !!(e.invoiceRequest && e.invoiceRequest.status) || !!e.saleInvoiceNumber;
const CLOSED_BY = 'سجلّ سابق';

const { excelDate } = require('./lib/xlsxStream');

// Writes only with an explicit --apply; anything else is a dry run.
const DRY = !process.argv.includes('--apply');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const FILE = fileArg
  ? path.resolve(fileArg.slice(7))
  : path.join(__dirname, '../seeds/data/customs-master-2026-08.xlsx');

// The master is read from xlsx directly with no intermediate JSON export, which is a manual step that gets forgotten and imports last month's file.
// Date conversion happens here, not in the matcher: Excel stores dates as serials and this master mixes numbers in one column (the paper-receipt date column holds a declaration number in 114 rows; the unloading-appointment column holds a 12-digit container number).
// So a number is accepted as a date only in a sane range (excelDate rejects the rest); a rejected value stays as text for dateStr, then is dropped.

const DATE_COLS = new Set([
  'تاريخ استلام الورق', 'تاريخ البيان', 'موعد التفريغ', 'اخر موعد ارجاع',
  'ميل فاتورة اذن التسليم', 'سداد فاتورة اذن التسليم', 'ميل ربط اذن التسليم',
  'سداد رسوم جمركية', 'سداد الموانى', 'سداد التفريغ', 'الارجاع',
]);

const SHEETS = ['التخليص', 'الحسابات', 'Sheet3', 'Sheet2'];

/**
 * One sheet -> array of objects keyed by the trimmed header of row 1.
 * Sheets are read by NAME because their order changes between versions of the master. A repeated header gets a ' #2' suffix (the Accounts sheet has the yard unloading fee column twice: the cost, then the price charged to the customer).
 * Excel dates stay raw serials and are converted by excelDate (see xlsx-date-epoch-trap).
 */
function sheetToObjects(ws) {
  const XLSX = require('xlsx');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  if (!rows.length) return [];
  const header = [];
  const seen = new Map();
  for (const v of rows[0]) {
    const name = String(v ?? '').trim();
    if (!name) { header.push(''); continue; }
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    header.push(n === 1 ? name : `${name} #${n}`);
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const obj = {};
    let any = false;
    header.forEach((name, i) => {
      if (!name) return;
      let v = r[i];
      if (v === undefined || v === null || String(v).trim() === '') return;
      if (DATE_COLS.has(name) && /^\d+(\.\d+)?$/.test(String(v))) {
        const d = excelDate(v);
        v = d ? d.toISOString().slice(0, 10) : String(v);
      }
      obj[name] = v;
      any = true;
    });
    if (any) out.push(obj);
  }
  return out;
}

function readBook(file) {
  if (file.toLowerCase().endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const wb = require('xlsx').readFile(file);
  const book = {};
  for (const name of SHEETS) book[name] = wb.Sheets[name] ? sheetToObjects(wb.Sheets[name]) : [];
  return book;
}

// ---------------------------------------------------------------- normalisers

const EMPTY_TOKENS = new Set(['', '-', '−', '–', '—', '#n/a', 'n/a', 'na', 'null', 'undefined']);

/** '' for anything the sheet uses to mean "blank". */
function str(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return EMPTY_TOKENS.has(s.toLowerCase()) ? '' : s;
}

const isBlank = (v) => str(v) === '';

/** Strip currency symbols / thousands separators. Returns null when unparseable. */
function num(v) {
  const s = str(v);
  if (s === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = s.replace(/[,٬\s]/g, '').replace(/(ر\.?س|SAR|ريال|\$|USD)/gi, '').trim();
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** num() but 0 instead of null — for money buckets that must never be NaN. */
const money = (v) => {
  const n = num(v);
  return n === null ? null : n;
};

const MONTHS = {
  'يناير': 1, 'كانون الثاني': 1,
  'فبراير': 2, 'شباط': 2,
  'مارس': 3, 'اذار': 3, 'آذار': 3,
  'ابريل': 4, 'أبريل': 4, 'إبريل': 4, 'نيسان': 4,
  'مايو': 5, 'أيار': 5,
  'يونيو': 6, 'يونية': 6, 'حزيران': 6,
  'يوليو': 7, 'يوليه': 7, 'تموز': 7,
  'اغسطس': 8, 'أغسطس': 8, 'اب': 8, 'آب': 8,
  'سبتمبر': 9, 'ايلول': 9, 'أيلول': 9,
  'اكتوبر': 10, 'أكتوبر': 10, 'تشرين الاول': 10,
  'نوفمبر': 11, 'تشرين الثاني': 11,
  'ديسمبر': 12, 'كانون الاول': 12,
};

function monthNum(v) {
  const s = str(v);
  if (s === '') return null;
  if (MONTHS[s]) return MONTHS[s];
  const n = num(s);
  if (n !== null && n >= 1 && n <= 12) return n;
  return null;
}

/**
 * Sheet dates come in two shapes: an ISO timestamp ('2026-07-04T00:00:00')
 * or free-typed 'd-m-yyyy'. Returns 'YYYY-MM-DD' or ''.
 */
function dateStr(v) {
  const s = str(v);
  if (s === '') return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${dmy[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return '';
}

const DONE_TOKENS = new Set(['تم', 'تمت', 'نعم', 'yes', 'done']);
const isDone = (v) => DONE_TOKENS.has(str(v).toLowerCase());

function branchOf(city) {
  const s = str(city);
  if (s.includes('الدمام') || s.includes('دمام')) return 'dammam';
  if (s.includes('جدة') || s.includes('جده')) return 'jeddah';
  return null;
}

// ------------------------------------------------------------------- mapping

// sheet column -> costs.<key>
const COST_COLS = {
  'قيمة اذن التسليم': 'deliveryOrder',
  'اذن التسليم': 'deliveryOrder',            // Accounts/Sheet3 only, see note below
  'الرسوم الجمركية': 'customsDuty',
  'اجور الموانى': 'portFees',
  'اجور التفريغ': 'unloadingFees',
  'اجور النقل ( بالضريبة )': 'transport',
  'اجور النقل': 'transport',
  'النقل الى الساحة (بالضريبة)': 'transportToYard',
  'النقل الى الساحة': 'transportToYard',
  'حجز الموعد': 'appointmentBooking',
  'اجور الساحه': 'yardFees',
  'اجور تفريغ الساحه': 'yardFees',
  'تمديد الحاويات': 'extension',
  'ارضيات': 'demurrage',
  'اجور الكشف': 'inspection',
  'تمديد': 'extension',
  'الدامج': 'consolidator',
  'عمولات': 'commissions',
  'اجور اضافية': 'extraFees',
  'تخزين': 'storage',
  'تصريح الخروج': 'exitPermit',
  'فاتورة الارجاع': 'returnInvoice',
};

// sheet column -> revenue.<key>
// Margin items. The invoice total column is deliberately absent: in the master it is a formula (expenses + margin), so it is derived, not read.
const REVENUE_COLS = {
  'اجور التخليص': 'clearanceFee',
  'سعر بيع النقل': 'transportSelling',
  'صافي النقل': 'transportNet',
  'صافى النقل الى الساحة (بالضريبة)': 'transportToYardNet',
  'صافى النقل الى الساحة': 'transportToYardNet',
  'صافي نقل الساحه': 'yardTransportNet',
  'صافى الساحه': 'yardNet',
  // The second yard unloading fee column in Accounts sits among the revenue columns: what the customer pays.
  'اجور تفريغ الساحه #2': 'yardPrice',
  'صافى التخزين': 'storageNet',
  'فحص امنى': 'securityScan',
  'عمال': 'labour',
  'يوميات نقل': 'transportDailies',
};

/** In the Clearance sheet the DO column holds the six-digit DO reference number, while the DO value column holds its cost. In Accounts / Sheet3 there is no separate value column and the DO column IS the cost. Handled per sheet. */
function readMoney(row, out, unparseable, sheet, bl, treatDoAsNumber) {
  for (const [col, key] of Object.entries(COST_COLS)) {
    if (!(col in row)) continue;
    // In Accounts this header sits among the revenue columns: the yard-transport price charged to the customer.
    if (sheet === 'الحسابات' && col === 'النقل الى الساحة (بالضريبة)') {
      const v = money(row[col]);
      if (v !== null) out.revenue.transportToYardSelling = v;
      continue;
    }
    if (col === 'اذن التسليم' && treatDoAsNumber) continue;
    if (col === 'قيمة اذن التسليم' && !treatDoAsNumber) continue;
    if (isBlank(row[col])) continue;
    const v = money(row[col]);
    if (v === null) { unparseable.push({ sheet, bl, col, value: String(row[col]) }); continue; }
    out.costs[key] = v;
  }
  // The DO extension column is a second extension charge: it adds to the container extension.
  if ('تمديد اذن التسليم' in row && !isBlank(row['تمديد اذن التسليم'])) {
    const v = money(row['تمديد اذن التسليم']);
    if (v !== null) out.costs.extension = (out.costs.extension || 0) + v;
  }
  for (const [col, key] of Object.entries(REVENUE_COLS)) {
    if (!(col in row) || isBlank(row[col])) continue;
    const v = money(row[col]);
    if (v === null) { unparseable.push({ sheet, bl, col, value: String(row[col]) }); continue; }
    out.revenue[key] = v;
  }
}

/** Map one Clearance row to a partial CustomsClearance. */
function mapMasterRow(row, unparseable) {
  const bl = str(row['رقم البوليصة']);
  const out = { costs: {}, revenue: {}, billing: {}, stageDates: {}, stageDone: {} };

  const serial = num(row['مسلسل']);
  if (serial !== null) out.legacySerial = serial;
  const m = monthNum(row['الشهر']);
  if (m !== null) out.periodMonth = m;
  const y = num(row['السنة']);
  if (y !== null) out.periodYear = y;

  if (bl) out.blNumber = bl;
  if (!isBlank(row['اسم العميل'])) out.customerName = str(row['اسم العميل']);
  if (!isBlank(row['وكيل الشحن'])) out.shippingAgent = str(row['وكيل الشحن']);
  if (!isBlank(row['المدينة'])) {
    out.city = str(row['المدينة']);
    const b = branchOf(row['المدينة']);
    if (b) out.branch = b;
  }
  const cc = num(row['عدد الحاويات']);
  if (cc !== null) out.containerCount = cc;

  if (!isBlank(row['رقم البيان'])) out.declarationNumber = str(row['رقم البيان']);
  if (!isBlank(row['البند الجمركى'])) out.hsCode = str(row['البند الجمركى']);
  // A DO number has ten digits or six. A value like 35 here is a slip from the adjacent grace-days column (23 rows) and 0 means no DO yet; neither is a number.
  if (!isBlank(row['اذن التسليم'])) {
    const doRaw = str(row['اذن التسليم']);
    const doNum = num(doRaw);
    if (doNum === null || doNum >= 1000) out.doNumber = doRaw;
  }
  if (!isBlank(row['مكان التفريغ'])) out.unloadingLocation = str(row['مكان التفريغ']);
  if (!isBlank(row['ملاحظات'])) out.notes = str(row['ملاحظات']);

  // Last return date: most rows hold a count of grace days (35), not a date.
  // A number is stored as days and a date as a deadline; the two are never mixed.
  if (!isBlank(row['اخر موعد ارجاع'])) {
    const raw = row['اخر موعد ارجاع'];
    const d = dateStr(raw);
    if (d) out.returnDeadline = d;
    else {
      const days = num(raw);
      if (days !== null && days > 0 && days <= 400) out.returnFreeDays = days;
    }
  }

  const decl = dateStr(row['تاريخ البيان']);
  if (decl) out.declarationDate = decl;
  const papers = dateStr(row['تاريخ استلام الورق']);
  if (papers) out.papersReceivedDate = papers;
  // The unloading appointment is sometimes a date, sometimes just the done marker; keep it verbatim.
  if (!isBlank(row['موعد التفريغ'])) out.unloadingAppointment = dateStr(row['موعد التفريغ']) || str(row['موعد التفريغ']);

  // Milestones: the done marker -> stageDone flag, a real date -> stageDates.
  const MILESTONES = {
    'ميل فاتورة اذن التسليم': 'doInvoiceEmailed',
    'سداد فاتورة اذن التسليم': 'doInvoicePaid',
    'ميل ربط اذن التسليم': 'doLinkEmailed',
    'سداد رسوم جمركية': 'dutyPaid',
    'سداد الموانى': 'portFeesPaid',
    'سداد التفريغ': 'unloadingFeesPaid',
    'الارجاع': 'containersReturned',
  };
  for (const [col, key] of Object.entries(MILESTONES)) {
    if (isBlank(row[col])) continue;
    if (isDone(row[col])) out.stageDone[key] = true;
    const d = dateStr(row[col]);
    if (d) { out.stageDates[key] = d; out.stageDone[key] = true; }
  }

  if (!isBlank(row['حالة الفاتورة'])) out.billing.invoiceStatus = str(row['حالة الفاتورة']);
  // «0» in the invoice-number column means no invoice.
  if (!isBlank(row['رقم الفاتورة']) && str(row['رقم الفاتورة']) !== '0') out.billing.ourInvoiceNumber = str(row['رقم الفاتورة']);

  readMoney(row, out, unparseable, 'التخليص', bl, true);
  return out;
}

/** Map an Accounts / Sheet3 row (enrichment only). */
function mapCostRow(row, sheet, unparseable) {
  const bl = str(row['رقم البوليصة']);
  const out = { costs: {}, revenue: {}, billing: {} };
  if (!isBlank(row['حالة الفاتورة'])) out.billing.invoiceStatus = str(row['حالة الفاتورة']);
  // «0» in the invoice-number column means no invoice.
  if (!isBlank(row['رقم الفاتورة']) && str(row['رقم الفاتورة']) !== '0') out.billing.ourInvoiceNumber = str(row['رقم الفاتورة']);
  readMoney(row, out, unparseable, sheet, bl, false);
  return out;
}

/** Highest unambiguously-implied stage for a Clearance row. See header comment. */
function inferStage(row) {
  const invNo = str(row['رقم الفاتورة']);
  const invStatus = str(row['حالة الفاتورة']);
  if ((invNo && invNo !== '0') || (invStatus && !/^مل/.test(invStatus))) return 'invoiced';
  if (isDone(row['الارجاع'])) return 'containers_returned';
  if (isDone(row['سداد التفريغ'])) return 'unloading_fees_paid';
  if (isDone(row['سداد الموانى'])) return 'port_fees_paid';
  if (isDone(row['ميل ربط اذن التسليم'])) return 'do_linked';
  if (isDone(row['سداد فاتورة اذن التسليم'])) return 'do_requested';
  if (isDone(row['سداد رسوم جمركية'])) return 'declaration_paid';
  return null;
}

/** Deep-merge `src` into `dst`, never letting a blank overwrite a non-blank. */
function mergeInto(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
      mergeInto(dst[k], v);
    } else {
      if (typeof v === 'string' && v.trim() === '') continue;
      dst[k] = v;
    }
  }
  return dst;
}

// ---------------------------------------------------------------------- main

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`Source file not found: ${FILE}`);
    process.exit(1);
  }
  const book = readBook(FILE);
  const master = book['التخليص'] || [];
  const accounts = book['الحسابات'] || [];
  const sheet3 = book['Sheet3'] || [];
  const sheet2 = book['Sheet2'] || [];

  const unparseable = [];
  const skipped = [];

  console.log('='.repeat(72));
  console.log(DRY ? 'CUSTOMS MASTER IMPORT — DRY RUN (no writes)' : 'CUSTOMS MASTER IMPORT — APPLYING');
  console.log('='.repeat(72));
  console.log(`source: ${FILE}`);
  console.log('\nrows read per sheet:');
  console.log(`  التخليص        ${master.length}`);
  console.log(`  الحسابات       ${accounts.length}`);
  console.log(`  Sheet3         ${sheet3.length}`);
  console.log(`  Sheet2         ${sheet2.length}`);
  console.log(`  UI_AI_dashboard ${(book['UI_AI_dashboard'] || []).length}  (spec only — not imported)`);

  // Build the base records from the Clearance sheet
  const records = [];
  for (const row of master) {
    const bl = str(row['رقم البوليصة']);
    if (!bl) { skipped.push({ serial: row['مسلسل'], reason: 'no رقم البوليصة' }); continue; }
    const mapped = mapMasterRow(row, unparseable);
    mapped.__bl = bl;
    mapped.__stage = inferStage(row);
    records.push(mapped);
  }
  console.log(`\nالتخليص: ${records.length} rows with a BL, ${skipped.length} skipped (no BL)`);
  const systemRows = records.filter(fromSystemPeriod);
  if (systemRows.length) {
    console.log(`  October 2026 onward (worked on the system, not imported): ${systemRows.length} — ${systemRows.map((r) => r.__bl).slice(0, 10).join(', ')}`);
    for (const r of systemRows) records.splice(records.indexOf(r), 1);
  }

  // duplicate BLs inside the sheet
  const blCounts = new Map();
  records.forEach((r) => blCounts.set(r.__bl, (blCounts.get(r.__bl) || 0) + 1));
  const dupBls = [...blCounts.entries()].filter(([, n]) => n > 1);
  if (dupBls.length) {
    console.log(`  duplicate BLs in the sheet (kept separately, keyed by مسلسل): ${dupBls.map(([b, n]) => `${b} x${n}`).join(', ')}`);
  }

  // index for enrichment joins
  const byBl = new Map();
  for (const r of records) {
    if (!byBl.has(r.__bl)) byBl.set(r.__bl, []);
    byBl.get(r.__bl).push(r);
  }

  // Enrich: Sheet3 first, then Accounts (accounting wins).
  // Money comes from ONE source per row, as a whole set: Accounts, else Sheet3, else Clearance. Merging field by field mixed a stale Clearance value into an accounting row.
  // A BL repeated in both sheets (e.g. a cancelled declaration and the real one) is paired by order of appearance; otherwise one sheet row covers every row of the BL.
  const enrich = (rows, sheetName) => {
    let hit = 0, miss = 0;
    const missed = [];
    const countIn = new Map();
    for (const row of rows) { const b = str(row['رقم البوليصة']); if (b) countIn.set(b, (countIn.get(b) || 0) + 1); }
    const seenIn = new Map();
    for (const row of rows) {
      const bl = str(row['رقم البوليصة']);
      if (!bl) continue;
      const targets = byBl.get(bl);
      if (!targets) { miss += 1; missed.push(bl); continue; }
      hit += 1;
      const nth = seenIn.get(bl) || 0;
      seenIn.set(bl, nth + 1);
      const partial = mapCostRow(row, sheetName, unparseable);
      const paired = countIn.get(bl) === targets.length ? [targets[nth]] : targets;
      for (const t of paired) {
        if (Object.keys(partial.costs).length || Object.keys(partial.revenue).length) {
          t.costs = {}; t.revenue = {};
          t.__moneyFrom = sheetName;
        }
        mergeInto(t, partial);
      }
    }
    const withBl = rows.filter((r) => str(r['رقم البوليصة'])).length;
    console.log(`${sheetName}: ${withBl}/${rows.length} rows have a BL — join hit ${hit}/${withBl} (${withBl ? Math.round((hit / withBl) * 100) : 0}%)${miss ? `, ${miss} unmatched: ${[...new Set(missed)].slice(0, 5).join(', ')}` : ''}`);
  };
  enrich(sheet3, 'Sheet3');
  enrich(accounts, 'الحسابات');

  // ---- Sheet2 -> containers[] (merged BL cells are forward-filled)
  const containersByBl = new Map();
  let lastBl = '';
  let s2rows = 0;
  for (const row of sheet2) {
    const bl = str(row['البوليصة']) || lastBl;
    if (!bl) continue;
    lastBl = bl;
    const cn = str(row['الحاوية']);
    if (!cn) continue;
    if (!containersByBl.has(bl)) containersByBl.set(bl, []);
    containersByBl.get(bl).push({
      containerNumber: cn,
      exitPermit: money(row['تصريح خروج']) ?? 0,
      declaration: str(row['البيان']),
      notes: '',
    });
    s2rows += 1;
  }
  let s2hit = 0;
  for (const [bl, list] of containersByBl.entries()) {
    const targets = byBl.get(bl);
    if (!targets) continue;
    s2hit += 1;
    targets[0].containers = list; // attach to the first row of the BL
  }
  console.log(`Sheet2: ${s2rows} container rows across ${containersByBl.size} BLs (merged cells forward-filled) — join hit ${s2hit}/${containersByBl.size}`);

  // Invoiced in the sheet (number or status) -> closed and invoiced on the system.
  // A cancelled marker as the invoice status means a cancelled row, not an invoice.
  const cancelledRows = [];
  for (const r of records) {
    const status = str(r.billing && r.billing.invoiceStatus);
    if (/^مل/.test(status) && !str(r.billing && r.billing.ourInvoiceNumber)) {
      r.cancelled = true;
      r.billing.invoiceStatus = 'ملغي';
      cancelledRows.push(r.__bl);
      r.__invoiced = false;
      continue;
    }
    r.__invoiced = !!(str(r.billing && r.billing.ourInvoiceNumber) || status);
  }
  if (cancelledRows.length) console.log(`  cancelled in the sheet («ملغي»): ${cancelledRows.length} — ${cancelledRows.join(', ')}`);
  console.log(`  invoiced in the sheet: ${records.filter((r) => r.__invoiced).length} · not invoiced: ${records.filter((r) => !r.__invoiced).length}`);

  // ---- derived totals
  for (const r of records) recomputeTotals(r);

  // Account check against the master's own columns.
  // The master has three Excel-formula columns: total expenses, total profit, total invoice. They are not imported (derived here) but act as the referee: if our derivation disagrees with their formula, the mapping is wrong, not the sheet.
  const round2 = (x) => Math.round(x * 100) / 100;
  const sum = (fn) => round2(records.reduce((a, r) => a + (Number(fn(r)) || 0), 0));

  const recon = (rows, label, costCol, profitCol, invCol) => {
    let n = 0, okC = 0, okP = 0, okI = 0;
    const off = [];
    for (const row of rows) {
      const bl = str(row['رقم البوليصة']);
      const targets = byBl.get(bl);
      if (!bl || !targets || !targets.length) continue;
      const t = recomputeTotals(JSON.parse(JSON.stringify(targets[0])));
      n += 1;
      const sc = money(row[costCol]), sp = money(row[profitCol]), si = money(row[invCol]);
      const near = (a, b) => a === null || Math.abs(a - b) <= 1;
      if (near(sc, t.costs.total)) okC += 1;
      else if (off.length < 6) off.push(`${bl}: مصروفات الشيت ${sc} ≠ المحسوب ${t.costs.total}`);
      if (near(sp, t.revenue.profit)) okP += 1;
      else if (process.env.RECON_DEBUG && label.trim() === 'الحسابات') off.push(`${bl}: ربح الشيت ${sp} ≠ المحسوب ${t.revenue.profit} · ${JSON.stringify(t.revenue)}`);
      if (near(si, t.revenue.totalInvoiced)) okI += 1;
    }
    if (!n) return;
    console.log(`  ${label}: ${n} صفًّا مطابَقًا — مصروفات ${okC}/${n} · ربح ${okP}/${n} · فاتورة ${okI}/${n}`);
    off.forEach((o) => console.log(`      ${o}`));
  };

  console.log('\n--- مطابقة الأعمدة المحسوبة في الماستر ---');
  recon(master, 'التخليص ', 'اجمالى المصروفات', 'اجمالى الربح', 'اجمالى الفاتورة');
  recon(sheet3, 'Sheet3   ', 'اجمالى المصروفات', 'اجمالى الربح', 'اجمالى الفاتورة');
  recon(accounts, 'الحسابات ', 'اجمالى المصروفات', 'اجمالى الربح', 'اجمالى الفاتورة');

  console.log('\n--- ما سيُخزَّن (بعد الإثراء من الحسابات و Sheet3) ---');
  console.log(`  بوالص            ${records.length}`);
  console.log(`  حاويات           ${sum((r) => r.containerCount)}`);
  console.log(`  عملاء            ${new Set(records.map((r) => r.customerName).filter(Boolean)).size}`);
  console.log(`  إجمالي المصاريف  ${sum((r) => r.costs.total)}   (مبالغُ تُمرَّر على العميل)`);
  console.log(`  إجمالي الربح     ${sum((r) => r.revenue.profit)}`);
  console.log(`  إجمالي الفاتورة  ${sum((r) => r.revenue.totalInvoiced)}`);
  console.log(`  أجور التخليص     ${sum((r) => r.revenue.clearanceFee)}`);

  if (unparseable.length) {
    console.log(`\n--- unparseable numeric cells (${unparseable.length}) — left empty ---`);
    unparseable.slice(0, 25).forEach((u) => console.log(`  [${u.sheet}] BL ${u.bl} · ${u.col} = "${u.value}"`));
    if (unparseable.length > 25) console.log(`  ... and ${unparseable.length - 25} more`);
  }
  if (skipped.length) {
    console.log(`\n--- skipped rows (${skipped.length}) ---`);
    console.log(`  ${skipped.length} التخليص rows with no رقم البوليصة (blank spreadsheet padding rows: مسلسل ${skipped[0].serial}..${skipped[skipped.length - 1].serial})`);
  }

  // ---- connect and diff against the DB
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('\nMONGODB_URI is not set'); process.exit(1); }
  await mongoose.connect(uri);

  const existing = await CustomsClearance.find({ blNumber: { $in: [...byBl.keys()] } }).lean();
  const existingByBl = new Map();
  for (const e of existing) {
    const k = str(e.blNumber);
    if (!existingByBl.has(k)) existingByBl.set(k, []);
    existingByBl.get(k).push(e);
  }

  // Pair each sheet row with an existing doc: prefer a legacySerial match, then
  // any not-yet-claimed doc for that BL. Keeps re-runs idempotent.
  const claimed = new Set();
  let toCreate = 0, toUpdate = 0;
  for (const r of records) {
    const pool = existingByBl.get(r.__bl) || [];
    let match = pool.find((e) => !claimed.has(String(e._id)) && r.legacySerial !== undefined && e.legacySerial === r.legacySerial);
    if (!match) match = pool.find((e) => !claimed.has(String(e._id)));
    if (match) {
      claimed.add(String(match._id));
      if (workedOnSystem(match) || fromSystemPeriod(match)) { r.__skip = true; continue; }
      r.__existing = match; toUpdate += 1;
    } else toCreate += 1;
  }
  const kept = records.filter((r) => r.__skip);
  if (kept.length) {
    console.log(`  worked on the system — left untouched: ${kept.length} — ${kept.map((r) => r.__bl).slice(0, 15).join(', ')}`);
  }

  console.log(`\n--- database diff ---`);
  console.log(`  existing CustomsClearance docs matching these BLs: ${existing.length}`);
  console.log(`  to create: ${toCreate}`);
  console.log(`  to update: ${toUpdate}`);

  if (DRY) {
    console.log('\nDRY RUN — nothing written.');
    await mongoose.disconnect();
    return;
  }

  // ---- write
  let created = 0, updated = 0, stageAdvanced = 0, failed = 0;
  // Closing an invoiced row: every applicable stage done, closed at the end of its month.
  const closeInvoiced = (doc) => {
    const { route: known } = readStages(doc);
    const route = known || 'customer';
    doc.stagesDone = STAGES.filter((k) => !lockReason(k, route, doc.cargoType));
    doc.transportRoute = route;
    doc.pipelineVersion = 2;
    doc.stage = 'invoiced';
    if (!doc.isCompleted) {
      doc.isCompleted = true;
      doc.completedAt = doc.periodYear && doc.periodMonth
        ? new Date(Date.UTC(doc.periodYear, doc.periodMonth, 0, 9, 0, 0)) : new Date();
      doc.completedBy = null;
      doc.completedByName = CLOSED_BY;
    }
  };
  let closed = 0;
  for (const r of records) {
    const { __bl, __stage, __existing, __skip, __invoiced, ...data } = r;
    if (__skip) continue;
    try {
      if (__existing) {
        const doc = await CustomsClearance.findById(__existing._id);
        if (!doc) { failed += 1; continue; }
        // Blank-guard: mergeInto skips blank strings, and the mapper only ever emits non-blank values, so nothing here can clear existing data.
        // The sheet is the money reference, and mergeInto never clears, so a stale value in a cell the sheet emptied would be summed forever.
        // Also, earlier imports were read by a reader that shifted a column at every empty cell, so all money fields are zeroed before the merge and then filled from the sheet.
        const base = doc.toObject();
        base.costs = base.costs || {};
        base.revenue = base.revenue || {};
        for (const k of COST_KEYS) base.costs[k] = 0;
        for (const k of MARGIN_KEYS) base.revenue[k] = 0;
        base.revenue.transportSelling = 0;
        base.revenue.yardTransportNet = 0;
        base.revenue.yardPrice = null;
        const merged = recomputeTotals(mergeInto(base, data));
        for (const [k, v] of Object.entries(merged)) {
          if (k === '_id' || k === '__v' || k === 'refNumber' || k === 'createdAt' || k === 'updatedAt') continue;
          doc.set(k, v);
        }
        if (__stage) {
          const from = STAGES.indexOf(doc.stage);
          const to = STAGES.indexOf(__stage);
          if (to > from) { doc.stage = __stage; stageAdvanced += 1; }
        }
        if (__invoiced) { const was = doc.isCompleted; closeInvoiced(doc); if (!was) closed += 1; }
        await doc.save();
        updated += 1;
      } else {
        if (__stage) data.stage = __stage;
        const doc = new CustomsClearance(data);
        if (__invoiced) { closeInvoiced(doc); closed += 1; }
        await doc.save();
        created += 1;
      }
    } catch (e) {
      failed += 1;
      console.error(`  ! ${__bl}: ${e.message}`);
    }
  }

  console.log(`\n--- write results ---`);
  console.log(`  created: ${created}`);
  console.log(`  updated: ${updated}  (stage advanced on ${stageAdvanced})`);
  console.log(`  closed as invoiced: ${closed}`);
  console.log(`  failed:  ${failed}`);

  const after = await CustomsClearance.aggregate([
    { $group: { _id: null, n: { $sum: 1 }, containers: { $sum: '$containerCount' }, rev: { $sum: '$revenue.totalInvoiced' }, cost: { $sum: '$costs.total' }, profit: { $sum: '$revenue.profit' }, fee: { $sum: '$revenue.clearanceFee' } } },
  ]);
  if (after[0]) {
    const a = after[0];
    const r2 = (x) => Math.round((x || 0) * 100) / 100;
    console.log('\n--- totals now in the database (all CustomsClearance docs) ---');
    console.log(`  docs ${a.n} · حاويات ${a.containers} · إيرادات ${r2(a.rev)} · مصاريف ${r2(a.cost)} · ربح ${r2(a.profit)} · أجور تخليص ${r2(a.fee)}`);
  }

  await mongoose.disconnect();
}

// Runs only when invoked directly, never on require().
if (require.main === module) {
  main().catch(async (e) => {
    console.error(e);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  });
}
