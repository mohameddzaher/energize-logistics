/**
 * Import the company's customs master spreadsheet into CustomsClearance.
 *
 *   cd backend
 *   node src/scripts/importCustomsMaster.js --dry     # preview, writes nothing
 *   node src/scripts/importCustomsMaster.js           # apply
 *
 * Source: src/data/masters/ماستر_التخليص_data.json  (gitignored, commercial data)
 * Override with:  --file=<path>
 *
 * Sheets
 *   التخليص  (358 rows, 251 with a BL) — the operational master; base records.
 *   الحسابات (93 rows)  — per-BL P&L, most authoritative for money.
 *   Sheet3   (163 rows) — costing variant; the only source of الرسوم الجمركية + تخزين.
 *   Sheet2   (41 rows)  — container grain; merged BL cells are forward-filled.
 *   UI_AI_dashboard     — a rendered mock-up. NOT imported.
 *
 * Matching:  رقم البوليصة (blNumber) is the key. Existing records are updated in
 * place, unknown BLs are inserted, nothing is ever deleted. Where the sheet
 * itself repeats a BL (one case: MEDUWA259425) the rows are disambiguated by
 * مسلسل (legacySerial) so both survive and re-runs stay idempotent.
 *
 * Precedence for enrichment (later wins, but only for non-empty values):
 *   التخليص  ->  Sheet3  ->  الحسابات
 *
 * Blank-guard: an empty / '#N/A' / '-' cell never overwrites an existing
 * non-empty value, in the sheet merge or against the database.
 *
 * ---------------------------------------------------------------------------
 * Stage inference rules (only applied where the data is unambiguous; otherwise
 * the record keeps whatever stage it already has / the model default):
 *   رقم الفاتورة or حالة الفاتورة non-empty ..... 'invoiced'
 *   الارجاع == 'تم' ............................. 'containers_returned'
 *   سداد التفريغ == 'تم' ........................ 'unloading_fees_paid'
 *   سداد الموانى == 'تم' ........................ 'port_fees_paid'
 *   ميل ربط اذن التسليم == 'تم' ................. 'do_linked'
 *   سداد فاتورة اذن التسليم == 'تم' ............. 'do_requested'
 *   سداد رسوم جمركية == 'تم' .................... 'declaration_paid'
 * The highest matching stage wins. A stage is never moved BACKWARDS on an
 * existing record — the sheet is a snapshot, the ERP may be further along.
 * ---------------------------------------------------------------------------
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CustomsClearance = require('../models/CustomsClearance');
const { STAGES, recomputeTotals, COST_KEYS, MARGIN_KEYS } = require('../models/CustomsClearance');

const { readSheet, excelDate } = require('./lib/xlsxStream');

const DRY = process.argv.includes('--dry');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const FILE = fileArg
  ? path.resolve(fileArg.slice(7))
  : path.join(__dirname, '../seeds/data/customs-master-2026-08.xlsx');

// ---------------------------------------------------------------------------
// قراءةُ الماستر من xlsx مباشرةً — لا تصديرَ وسيطًا إلى JSON. الوسيطُ خطوةٌ
// يدويّةٌ تُنسى، فيُستورد ملفُّ الشهر الماضي ويُظنُّ أنّه الجديد.
//
// وتحويلُ التواريخ هنا لا في المُطابِق: إكسل يخزّن التاريخَ رقمًا تسلسليًّا،
// وفي هذا الماستر تختلط الأرقامُ في عمودٍ واحد — «تاريخ استلام الورق» يحمل
// رقمَ بيانٍ في ١١٤ صفًّا، و«موعد التفريغ» يحمل رقمَ حاويةٍ من اثنَي عشر رقمًا.
// فلا يُقبل رقمٌ تاريخًا إلّا إن وقع في نطاقٍ معقول (excelDate يرفض ما عداه)،
// وما رُفض يبقى نصَّه كما هو فيتولّاه dateStr ثمّ يُهمَل.
// ---------------------------------------------------------------------------

const DATE_COLS = new Set([
  'تاريخ استلام الورق', 'تاريخ البيان', 'موعد التفريغ', 'اخر موعد ارجاع',
  'ميل فاتورة اذن التسليم', 'سداد فاتورة اذن التسليم', 'ميل ربط اذن التسليم',
  'سداد رسوم جمركية', 'سداد الموانى', 'سداد التفريغ', 'الارجاع',
]);

const SHEET_XML = {
  'التخليص': 'sheet1.xml',
  'الحسابات': 'sheet2.xml',
  'Sheet3': 'sheet4.xml',
  'Sheet1': 'sheet5.xml',
  'Sheet2': 'sheet6.xml',
};

/** ورقةٌ واحدة -> مصفوفةُ كائنات مفاتيحُها عناوينُ الصفّ الأوّل (مُشذَّبة). */
function sheetToObjects(file, xml) {
  const rows = readSheet(file, 'xl/worksheets/' + xml);
  if (!rows.length) return [];
  const header = {};
  for (const [col, v] of Object.entries(rows[0].cells)) {
    const name = String(v).trim();
    if (name && !(name in header)) header[name] = col; else if (name) header[`${name} (${col})`] = col;
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const obj = {};
    let any = false;
    for (const [name, col] of Object.entries(header)) {
      let v = r.cells[col];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (DATE_COLS.has(name) && /^\d+(\.\d+)?$/.test(String(v))) {
        const d = excelDate(v);
        v = d ? d.toISOString().slice(0, 10) : String(v);
      }
      obj[name] = v;
      any = true;
    }
    if (any) out.push(obj);
  }
  return out;
}

function readBook(file) {
  if (file.toLowerCase().endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const book = {};
  for (const [name, xml] of Object.entries(SHEET_XML)) {
    try { book[name] = sheetToObjects(file, xml); } catch (e) { book[name] = []; }
  }
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
  'اذن التسليم': 'deliveryOrder',            // الحسابات/Sheet3 only — see note below
  'الرسوم الجمركية': 'customsDuty',
  'اجور الموانى': 'portFees',
  'اجور التفريغ': 'unloadingFees',
  'اجور النقل ( بالضريبة )': 'transport',
  'اجور النقل': 'transport',
  'النقل الى الساحة (بالضريبة)': 'transportToYard',
  'النقل الى الساحة': 'transportToYard',
  'حجز الموعد': 'appointmentBooking',
  'اجور الساحه': 'yardFees',
  'ارضيات': 'demurrage',
  'اجور الكشف': 'inspection',
  'تمديد': 'extension',
  'الدامج': 'consolidator',
  'عمولات': 'commissions',
  'تخزين': 'storage',
  'تصريح الخروج': 'exitPermit',
  'فاتورة الارجاع': 'returnInvoice',
};

// sheet column -> revenue.<key>
// بنودُ الهامش. `اجمالى الفاتورة` غائبٌ عمدًا: عمودُه في الماستر صيغةٌ
// (= المصروفات + الهامش)، فيُشتقّ لا يُقرأ.
const REVENUE_COLS = {
  'اجور التخليص': 'clearanceFee',
  'سعر بيع النقل': 'transportSelling',
  'صافي النقل': 'transportNet',
  'صافى النقل الى الساحة (بالضريبة)': 'transportToYardNet',
  'صافى النقل الى الساحة': 'transportToYardNet',
  'صافي نقل الساحه': 'yardTransportNet',
  'صافى الساحه': 'yardNet',
  'صافى التخزين': 'storageNet',
  'فحص امنى': 'securityScan',
  'عمال': 'labour',
};

/**
 * In the التخليص sheet "اذن التسليم" holds the six-digit DO reference number,
 * while "قيمة اذن التسليم" holds its cost. In الحسابات / Sheet3 there is no
 * separate value column and "اذن التسليم" IS the cost. Handled per-sheet.
 */
function readMoney(row, out, unparseable, sheet, bl, treatDoAsNumber) {
  for (const [col, key] of Object.entries(COST_COLS)) {
    if (!(col in row)) continue;
    if (col === 'اذن التسليم' && treatDoAsNumber) continue;
    if (col === 'قيمة اذن التسليم' && !treatDoAsNumber) continue;
    if (isBlank(row[col])) continue;
    const v = money(row[col]);
    if (v === null) { unparseable.push({ sheet, bl, col, value: String(row[col]) }); continue; }
    out.costs[key] = v;
  }
  for (const [col, key] of Object.entries(REVENUE_COLS)) {
    if (!(col in row) || isBlank(row[col])) continue;
    const v = money(row[col]);
    if (v === null) { unparseable.push({ sheet, bl, col, value: String(row[col]) }); continue; }
    out.revenue[key] = v;
  }
}

/** Map one التخليص row to a partial CustomsClearance. */
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
  // رقمُ إذن التسليم عشرةُ أرقامٍ أو ستّة. و«٣٥» في هذه الخانة انزلاقٌ من عمود
  // أيّام السماح المجاور (٢٣ صفًّا)، و«٠» تعني لا إذنَ بعد — كلاهما ليس رقمًا.
  if (!isBlank(row['اذن التسليم'])) {
    const doRaw = str(row['اذن التسليم']);
    const doNum = num(doRaw);
    if (doNum === null || doNum >= 1000) out.doNumber = doRaw;
  }
  if (!isBlank(row['مكان التفريغ'])) out.unloadingLocation = str(row['مكان التفريغ']);
  if (!isBlank(row['ملاحظات'])) out.notes = str(row['ملاحظات']);

  // «اخر موعد ارجاع»: أكثرُ الصفوف تكتب فيه عددَ أيّام السماح (٣٥) لا تاريخًا.
  // الرقمُ يُخزَّن أيّامًا، والتاريخُ يُخزَّن موعدًا، ولا يُخلط أحدُهما بالآخر.
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
  // موعد التفريغ is sometimes a date, sometimes just 'تم' — keep it verbatim.
  if (!isBlank(row['موعد التفريغ'])) out.unloadingAppointment = dateStr(row['موعد التفريغ']) || str(row['موعد التفريغ']);

  // Milestones: 'تم' -> stageDone flag, a real date -> stageDates.
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
  if (!isBlank(row['رقم الفاتورة'])) out.billing.ourInvoiceNumber = str(row['رقم الفاتورة']);

  readMoney(row, out, unparseable, 'التخليص', bl, true);
  return out;
}

/** Map an الحسابات / Sheet3 row (enrichment only). */
function mapCostRow(row, sheet, unparseable) {
  const bl = str(row['رقم البوليصة']);
  const out = { costs: {}, revenue: {}, billing: {} };
  if (!isBlank(row['حالة الفاتورة'])) out.billing.invoiceStatus = str(row['حالة الفاتورة']);
  if (!isBlank(row['رقم الفاتورة'])) out.billing.ourInvoiceNumber = str(row['رقم الفاتورة']);
  readMoney(row, out, unparseable, sheet, bl, false);
  return out;
}

/** Highest unambiguously-implied stage for a التخليص row. See header comment. */
function inferStage(row) {
  if (!isBlank(row['رقم الفاتورة']) || !isBlank(row['حالة الفاتورة'])) return 'invoiced';
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

  // ---- build the base records from التخليص
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

  // ---- enrich: Sheet3 first, then الحسابات (accounting wins)
  const enrich = (rows, sheetName) => {
    let hit = 0, miss = 0;
    const missed = [];
    for (const row of rows) {
      const bl = str(row['رقم البوليصة']);
      if (!bl) continue;
      const targets = byBl.get(bl);
      if (!targets) { miss += 1; missed.push(bl); continue; }
      hit += 1;
      const partial = mapCostRow(row, sheetName, unparseable);
      // Apply to every row sharing the BL — the money is per-BL, not per-row.
      for (const t of targets) mergeInto(t, partial);
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

  // ---- derived totals
  for (const r of records) recomputeTotals(r);

  // ---- مطابقةُ الحساب بأعمدة الماستر نفسِها ------------------------------
  // الماستر يحمل ثلاثةَ أعمدةٍ محسوبةٍ بصِيَغ إكسل: اجمالى المصروفات، اجمالى
  // الربح، اجمالى الفاتورة. لا تُستورد — تُشتقّ عندنا — لكنّها الحَكَم: لو
  // خالف اشتقاقُنا صيغتَهم فالخريطةُ غلط لا الشيت.
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
    if (match) { claimed.add(String(match._id)); r.__existing = match; toUpdate += 1; }
    else toCreate += 1;
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
  for (const r of records) {
    const { __bl, __stage, __existing, ...data } = r;
    try {
      if (__existing) {
        const doc = await CustomsClearance.findById(__existing._id);
        if (!doc) { failed += 1; continue; }
        // Blank-guard: mergeInto skips blank strings, and the mapper only ever
        // emits non-blank values, so nothing here can clear existing data.
        // الشيت هو مرجعُ المال. وmergeInto لا يمسح — لو بقيت قيمةٌ قديمة في
        // خانةٍ أفرغها الشيت لظلّت تُجمَع إلى الأبد. ولأنّ أرقامَ الاستيراد
        // السابق قُرئت بقارئٍ كان ينزلق عمودًا عند كلّ خليّةٍ فارغة، تُصفَّر
        // خاناتُ المال كلُّها قبل الدمج ثمّ تُملأ من الشيت.
        const base = doc.toObject();
        base.costs = base.costs || {};
        base.revenue = base.revenue || {};
        for (const k of COST_KEYS) base.costs[k] = 0;
        for (const k of MARGIN_KEYS) base.revenue[k] = 0;
        base.revenue.transportSelling = 0;
        base.revenue.yardTransportNet = 0;
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
        await doc.save();
        updated += 1;
      } else {
        if (__stage) data.stage = __stage;
        await CustomsClearance.create(data);
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

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
