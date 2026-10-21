/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  فحوصُ الفواتير في سير عمل التشغيل — أربعُ بطاقاتٍ حيّة
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ١) «فواتير لم تُفوتَر» — أرقامٌ ناقصةٌ في تسلسل الفواتير الضريبيّة.
 *  ٢) «فواتير بكشوفات غير موجودة» — سطرٌ في ورقة المبيعات يذكر كشفًا لا يوجد.
 *  ٣) «فرق قيمة الفاتورة» — ما تقوله الورقةُ عن الفاتورة غيرُ مجموع كشوفها.
 *  ٤) «عدم تطابق اسم العميل» — العميلُ في الورقة غيرُ عميل الكشف.
 *
 * الأربعةُ تُحسب من القاعدة لحظةَ السؤال (وتُحفظ ثلاثين ثانيةً تحت `wf:` التي
 * تمسحها كلُّ كتابةٍ على الكشوف وكلُّ مزامنة) — فكشفٌ يُصحَّح يسقط من البطاقة
 * بلا رفعٍ جديد، وفاتورةٌ تُكتب اليومَ برقمٍ أعلى تمدّ التسلسلَ في الحال.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const InvoiceUploadLine = require('../models/InvoiceUploadLine');
const { hasTaxInvoice } = require('../utils/paymentType');
const { westernDigits, searchKey } = require('../utils/arabicSearch');
const cache = require('../utils/ttlCache');

const CACHE_KEY = 'wf:invchecks';
const CACHE_TTL = 30 * 1000;

// ── متى يكون الرقمُ «شاذًّا» لا بدايةً ولا نهاية ──────────────────────────────
// رقمٌ يبعد عن جيرانه أكثرَ من ألفٍ ليس من التسلسل: خطأُ كتابة («120184» بدل
// «12184») أو فاتورةٌ من دفترٍ آخر. ولو أُخذ حدًّا لصار كلُّ ما بينه وبين
// التسلسل «ناقصًا» — آلافُ أرقامٍ لا وجودَ لها. فيُقال باسمه في قائمةٍ وحدَه.
const OUTLIER_GAP = 1000;
// سقفُ ما تُرجعه القائمة — تسلسلٌ مكسورٌ بالكامل لا يُرسَل مئةَ ألف سطر.
const MAX_GAPS = 20000;
// فرقُ القيمة الذي يُعدّ فرقًا: ريالٌ واحد — كسورُ تقريب الضريبة (١٥٪ على كلّ
// سطرٍ أو على المجموع) لا تُحسب خلافًا.
const VALUE_TOLERANCE = 1;

const CANCELLED_EXEC = ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * الأرقامُ التي يحملها نصُّ رقم الفاتورة.
 *
 * الخانةُ تحمل رقمًا واحدًا في الغالب، وأحيانًا أكثر («12184 / 12185»). فما كان
 * أرقامًا وفواصلَ وحدَها عُدّت أرقامُه كلُّها موجودة؛ وما فيه حروفٌ («INV-12184»)
 * لا يُخمَّن: يُعَدّ «غيرَ رقميّ» ويُقال عددُه. والبدائلُ («no inv»، «بدون»)
 * ليست أرقامًا أصلًا — `hasTaxInvoice`.
 */
function numbersIn(raw) {
  const s = westernDigits(String(raw == null ? '' : raw)).trim();
  if (!hasTaxInvoice({ invoiceNumber: s })) return { kind: 'none', nums: [] };
  const rest = s.replace(/\d+/g, '').replace(/[\s,،/\\\-&+و.]+/g, '');
  if (rest) return { kind: 'text', nums: [] };
  return { kind: 'num', nums: (s.match(/\d+/g) || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) };
}

/**
 * ── أين يبدأ التسلسل وأين ينتهي ──────────────────────────────────────────────
 *
 * النهايةُ أعلى رقمٍ مكتوبٍ على كشف — حيّةٌ، تتحرّك مع كلّ فاتورةٍ تُكتب.
 * والبدايةُ أدنى رقمٍ في **الكتلة الرئيسيّة**: الأرقامُ تُقسَم حيث يفصل بين
 * رقمين متجاورين أكثرُ من `OUTLIER_GAP`، وتُؤخذ أكبرُ الكتل عددًا. فرقمٌ شاذٌّ
 * في أوّلها أو آخرها لا يصنع آلافَ «ناقصٍ» وهميّة — ويُعرض في قائمته.
 *
 * ولماذا لا يبدأ من أوّل دفتر التحصيل: الدفترُ فيه تسعةُ آلاف فاتورةٍ من قبل
 * النظام، أكثرُها لكشوفٍ لم تدخل سيرَ العمل قطّ. والبدءُ منه يجعل البطاقةَ
 * تقول «آلافُ الفواتير لم تُفوتَر» عن فواتيرَ صدرت وحُصّلت قبل أن يوجد الجدول.
 *
 * و`WF_INVOICE_SEQ_START` في البيئة يثبّت البدايةَ إن قرّرها المحاسب.
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
  // أكبرُها عددًا، وعند التساوي الأحدثُ (الأعلى).
  const main = clusters.reduce((a, b) => (b.length > a.length || (b.length === a.length && b[b.length - 1] > a[a.length - 1]) ? b : a));
  const envStart = Number(process.env.WF_INVOICE_SEQ_START);
  const useEnv = Number.isSafeInteger(envStart) && envStart > 0 && envStart <= main[main.length - 1];
  const start = useEnv ? envStart : main[0];
  const end = main[main.length - 1];
  const outliers = sorted.filter((n) => n < start || n > end);
  return { start, end, startSource: useEnv ? 'env' : 'data', outliers };
}

/** «فواتير لم تُفوتَر»: كلُّ رقمٍ بين البداية وأعلى رقمٍ لا يحمله كشف. */
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

  // ── وما يعرفه دفترُ التحصيل عن كلّ رقمٍ ناقص ───────────────────────────────
  // لا يُخفى رقمٌ لأنّ الدفتر يعرفه: يُكتب بجانبه ما يعرفه — محجوزٌ لم يُستعمل،
  // أو ملغاة، أو فاتورةٌ صادرةٌ في الدفتر لا كشفَ عليها هنا. ومعها ما في أوراق
  // المبيعات المرفوعة: رقمٌ في الورقة كشوفُه غيرُ موجودة.
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
    // رقمٌ واحدٌ قد يكون له في الدفتر أكثرُ من صفّ (حسابان) — الأوضحُ يغلب.
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
    else if (l) { note = 'ledger'; noteAr = 'صادرة في دفتر التحصيل ولا كشفَ عليها'; inLedger += 1; }
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

/**
 * ── مفتاحُ مقارنة الأسماء ───────────────────────────────────────────────────
 * يُطوى ما لا يُرى فرقًا: المسافاتُ كلُّها (الصلبةُ والمكرّرةُ والطرفيّة)
 * وعلاماتُ الاتّجاه والعرضِ الصفريّ، والهمزاتُ والتاءُ المربوطة والياء، والتشكيل
 * والأرقامُ الهنديّة — `searchKey`. وما بقي بعده فرقٌ حقيقيّ.
 */
const nameCmpKey = (s) => searchKey(String(s || '').replace(/[​-‏‪-‮⁠-⁯﻿]/g, ''));

/**
 * وأسماءُ الطرف الواحد في التحصيل (`aliases`) اسمٌ واحد: عميلٌ غيّر اسمَه في
 * المنصّة يبقى اسمُه القديم صيغةً له، والورقةُ قد تكتب أيَّهما.
 */
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
 * الفحوصُ الثلاثةُ على أسطر ورقة المبيعات.
 *
 * @param {object[]} lines    أسطرٌ {invoiceNumber, reportNumber, total, net, tax, customerName, …}
 * @param {Map}      overlay  (للمعاينة) رقمُ الكشف ← ما سيُكتب عليه، فتُقرأ الكشوفُ
 *                            كما ستكون بعد التطبيق لا كما هي الآن.
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

  // ٢) كشفٌ غير موجود.
  const missingReports = real.filter((l) => !repMap.has(String(l.reportNumber).trim())).map((l) => ({
    invoiceNumber: l.invoiceNumber, reportNumber: l.reportNumber, customerName: l.customerName || '',
    total: l.total ?? null, uploadedAt: l.uploadedAt || null, uploadedByName: l.uploadedByName || '', fileName: l.fileName || '',
  }));

  // ٣) فرقُ القيمة — بمجموع ما يجمعه دفترُ التحصيل نفسُه للفاتورة (`syncOpsInvoices`):
  // إجماليُّ الكشوف الضريبيّة غيرِ الملغاة التي تحمل الرقم. والإجماليُّ صافٍ +
  // ١٥٪ تشتقّه `applyBillingRules`، فهو ما يُقارَن بـ«المجموع الصافي» في الورقة.
  // وسطرٌ كشفُه غيرُ موجودٍ لا يدخل هنا: فرقُه مفسَّرٌ في بطاقته («كشوفات غير
  // موجودة»)، وعدُّه هنا أيضًا يجعل الخطأَ الواحد بطاقتين.
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

  // ٤) اسمُ العميل.
  const nameMismatches = [];
  for (const l of real) {
    const w = repMap.get(String(l.reportNumber).trim());
    if (!w) continue;
    const a = nameCmpKey(l.customerName); const b = nameCmpKey(w.username);
    if (!a || !b || a === b) continue;
    if (parties[a] && parties[a] === parties[b]) continue;   // صيغتان لطرفٍ واحد
    nameMismatches.push({
      invoiceNumber: l.invoiceNumber, reportNumber: l.reportNumber,
      uploadedCustomer: l.customerName, workflowCustomer: w.username || '',
      uploadedAt: l.uploadedAt || null, uploadedByName: l.uploadedByName || '',
    });
  }
  return { missingReports, valueDiffs, nameMismatches };
}

/** البطاقاتُ الأربع وقوائمُها — حسابٌ واحدٌ مخزَّنٌ ثلاثين ثانية. */
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

/**
 * حفظُ أسطر الورقة بعد التطبيق.
 *
 * السطرُ (فاتورة، كشف) يُكتب فوق نظيره من ورقةٍ سابقة. وكشفٌ صار في الورقة
 * الأحدث على فاتورةٍ أخرى تُحذف أسطرُه القديمةُ على غيرها — وإلّا بقي يُحسب في
 * قيمة فاتورته القديمة فيصنع فرقًا لا وجودَ له.
 */
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
