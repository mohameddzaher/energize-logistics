/**
 * ماليّاتُ الموارد البشريّة — رسومُ الإقامات ورخص العمل، وطلباتُ الموارد البشريّة.
 *
 *   الإدارة الماليّة (/api/finance):
 *     GET   /hr-docs             المستنداتُ المستحقّة + أعدادُ الشرائح + قوائمُ الفلاتر
 *     GET   /hr-docs/options     قوائمُ الفلترة السريعة وحدَها (HrQuickFilters)
 *     GET   /hr-docs/summary     أرقامُ بطاقة «ماليات الموارد البشرية»
 *     POST  /hr-docs/pay         «تمّ دفع الرسوم» — صفوفٌ بعينها أو كلُّ نتائج الفلتر
 *     POST  /hr-docs/unpay       التراجعُ عن دفعة (مديرو الماليّة)
 *     GET   /hr-requests         صندوقُ طلبات الموارد البشريّة
 *     PATCH /hr-requests/:id     الجواب: تمّ / لم يتمّ + ملاحظة + مرفقات
 *
 *   الموارد البشريّة (/api/hr):
 *     GET   /finance-follow/docs      الصفوفُ نفسُها بحالة دفعها — قراءةٌ فقط
 *     GET   /finance-follow/options
 *     GET   /finance-requests         طلباتُ القسم إلى الماليّة
 *     POST  /finance-requests         طلبٌ جديد: موظّفون + ما يُحتاج لكلٍّ منهم + مرفقات
 *
 * ── الصفُّ مستندٌ لا موظّف ──────────────────────────────────────────────────
 * لكلّ مقيمٍ مستندان تُدفع رسومُهما منفصلَين: الإقامةُ ورخصةُ العمل. فالموظّفُ
 * الواحدُ قد يظهر صفّين، ويُدفع أحدُهما ويبقى الآخر.
 *
 * ── مَن يُعرض ───────────────────────────────────────────────────────────────
 * مَن لم تنتهِ خدمتُه ولم يُؤرشَف (`employment=current` في hrMaster.buildFilter،
 * ومعه utils/endedStaff احتياطًا)، وليس سعوديًّا (لا إقامةَ له ولا رخصةَ عمل —
 * راجع skipGroups في models/Employee)، ومستندُه مطلوبٌ وله تاريخٌ مقروء. ومن
 * المستندات: ما انتهى (ويُقرأ «منتهية») وما بقي على انتهائه ٢٠ يومًا فأقلّ.
 *
 * ── والأرقامُ لا تتحرّك تحت مَن يضغطها ─────────────────────────────────────
 * كلُّ مجموعةِ أرقامٍ (شرائحُ المدّة، المستند، الدفع، كلُّ فلترٍ سريع، كلُّ
 * عمود) تُحسب بكلّ الفلاتر **عدا** فلترها — كما في hrMaster.expiring. والحسابُ
 * كلُّه هنا في الذاكرة: مئاتُ صفوفٍ لا أكثر، والفلاتر كلُّها تُطبَّق في موضعٍ
 * واحد، فلا يختلف الرقمُ عن الجدول الذي يفتحه.
 *
 * ── والدفعُ ليس تجديدًا ─────────────────────────────────────────────────────
 * «تمّ دفع الرسوم» يسجّل أنّ المال دُفع، ولا يغيّر تاريخًا في ملفّ أحد. التجديدُ
 * يبقى للموارد البشريّة من ملفّ الموظّف كما هو اليوم — وحين يتغيّر التاريخُ تبدأ
 * دورةٌ جديدةٌ غيرُ مدفوعة (راجع models/HrDocPayment).
 */
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const HrDocPayment = require('../models/HrDocPayment');
const HrFinanceRequest = require('../models/HrFinanceRequest');
const H = require('../config/hrFields');
const { normKey } = require('../utils/colFilter');
const { todayKey } = require('../utils/companyDay');
const { endedStaff } = require('../utils/endedStaff');
const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { canonicalRole } = require('../config/roles');
const logAudit = require('../utils/auditLogger');

const S = (v) => (v == null ? '' : String(v).trim());
const multi = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const nameOfUser = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || '';
const nameOfEmp = (e) => e?.arabicName || [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim();

// ═══════════════════════════════════════════════════════════════════════════
//  مَن يملك ماذا
// ═══════════════════════════════════════════════════════════════════════════
/** مَن يسجّل الدفعَ ويجيب الطلبات — أهلُ المال، ومَن مُنح القسمَ «تعديلًا». */
const PAY_ROLES = ['super_admin', 'admin', 'cfo', 'accounting_manager', 'accountant'];
/** والتراجعُ عن دفعةٍ لمديري الماليّة وحدَهم — يُحرَس بـ`authorize.strict`. */
const UNDO_ROLES = ['super_admin', 'admin', 'cfo', 'accounting_manager'];
/** مَن يُبلَّغ بطلبٍ جديد من الموارد البشريّة. */
const FINANCE_NOTIFY_ROLES = ['cfo', 'finance_manager', 'accounting_manager', 'accountant'];

const roleIn = (user, list) => list.map(canonicalRole).includes(canonicalRole(user?.role));
const canPay = (req) => roleIn(req.user, PAY_ROLES) || req.sectionAccess === 'edit';
const canUndo = (req) => roleIn(req.user, UNDO_ROLES);

// ── البثُّ: الصفحتان (الماليّة والموارد البشريّة) تسمعان حدثًا واحدًا ──────────
const announce = (kind) => {
  try { require('../websocket/socketManager').emitToAll('hr-finance:changed', { kind, at: Date.now() }); } catch (_) { /* البثُّ زيادة */ }
};

// ═══════════════════════════════════════════════════════════════════════════
//  المرفقات — data URL في JSON كبقيّة النظام (لا multer)
// ═══════════════════════════════════════════════════════════════════════════
const MAX_FILES = 10;
const MB = 1024 * 1024;
const MAX_TOTAL = 18 * MB; // الخادمُ يقبل ٢٥ ميغا للطلب، وbase64 يزيد الثلث.

/** يحفظ المرفقات ويعيد ما يُكتب — ويرفض قبل أن يكتب شيئًا. */
function saveFiles(list) {
  const files = (Array.isArray(list) ? list : []).filter((f) => f && f.dataUrl);
  if (!files.length) return [];
  if (files.length > MAX_FILES) {
    const e = new Error(`الحدّ ${MAX_FILES} ملفّات / At most ${MAX_FILES} files`); e.status = 400; throw e;
  }
  const total = files.reduce((n, f) => n + Math.floor((String(f.dataUrl).length - String(f.dataUrl).indexOf(',') - 1) * 3 / 4), 0);
  if (total > MAX_TOTAL) {
    const e = new Error('مجموع المرفقات أكبر من 18 ميغا / Attachments exceed 18 MB'); e.status = 400; throw e;
  }
  const saved = [];
  try {
    for (const f of files) {
      const meta = saveUploadFile(f.dataUrl, 'hr-finance', S(f.fileName || f.title).slice(0, 200));
      saved.push({ ...meta, uploadedAt: new Date() });
    }
  } catch (err) {
    saved.forEach((x) => deleteStoredFile(x.fileUrl));
    const e = new Error(err.message || 'تعذّر حفظ الملف'); e.status = 400; throw e;
  }
  return saved;
}

// ═══════════════════════════════════════════════════════════════════════════
//  صفوفُ المستندات
// ═══════════════════════════════════════════════════════════════════════════
const DOCS = [
  { key: 'iqama', ar: 'إقامة', en: 'Iqama', field: 'iqamaExpiry' },
  { key: 'workPermit', ar: 'رخصة عمل', en: 'Work permit', field: 'workPermitExpiry' },
];
/** أوسعُ نافذة: ما بقي عليه ٢٠ يومًا فأقلّ — والشرائحُ تراكميّةٌ تحتها. */
const HORIZON = 20;
const WINDOWS = [20, 15, 10, 5];
/** الفلاترُ السريعةُ نفسُها التي في رأس لوحة الموارد البشريّة (HrQuickFilters). */
const QUICK_KEYS = ['department', 'staffCategory', 'registerNumber', 'branchName', 'workStatusText', 'project', 'nationality', 'iqamaProfession'];

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;
const dayNum = (ymd) => {
  const m = YMD.exec(String(ymd || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};

/**
 * أعمدةُ الجدول القابلةُ للفلترة على طريقة إكسل — القيمةُ تُقرأ هنا وحدَه، فما
 * يُفلتَر عليه وما يُعَدّ في القائمة شيءٌ واحد. (`doc` و`paid` رموزٌ تُترجمها
 * الواجهة.)
 */
const COLUMNS = {
  employeeNumber: (r) => r.employeeNumber,
  name: (r) => r.name,
  idNumber: (r) => r.idNumber,
  doc: (r) => r.docType,
  expiryDate: (r) => r.expiryDate,
  daysLeft: (r) => String(r.daysLeft),
  department: (r) => r.department,
  staffCategory: (r) => r.staffCategory,
  project: (r) => r.project,
  nationality: (r) => r.nationality,
  branchName: (r) => r.branchName,
  registerNumber: (r) => r.registerNumber,
  paid: (r) => (r.paid ? 'paid' : 'unpaid'),
  paidByName: (r) => r.payment?.paidByName || '',
};
const cellOf = (r, k) => normKey(COLUMNS[k] ? COLUMNS[k](r) : '');

/** كلُّ مستندٍ مستحقٍّ اليوم — قبل أيّ فلترٍ من فلاتر الشاشة. */
async function universe() {
  const { _buildFilter } = require('./hrMasterController');
  const match = { $and: [_buildFilter({ employment: 'current' }), { idType: { $ne: 'national_id' } }] };
  const select = ['employeeNumber', 'arabicName', 'firstName', 'lastName', 'idType', 'iqamaNumber', 'nationalId', 'employmentStatus',
    'nationality', 'fieldStatus', ...QUICK_KEYS, ...DOCS.map((d) => d.field), ...H.READ_DEPS].join(' ');
  const [emps, ended] = await Promise.all([
    Employee.find(match).select(select).lean(),
    endedStaff().catch(() => null),
  ]);
  const today = dayNum(todayKey());
  const rows = [];
  for (const e of emps) {
    const id = String(e._id);
    if (ended && (ended.ids.has(id) || ended.archivedIds.has(id))) continue;
    // السعوديُّ لا إقامةَ له ولا رخصةَ عمل — وإن كُتب نوعُ هويّته خطأً.
    if (/سعود|saudi/i.test(String(e.nationality || ''))) continue;
    for (const d of DOCS) {
      const st = e.fieldStatus?.[H.statusKeyOf(d.field)];
      // «غير مطلوب» و«لا يوجد» قرارٌ إداريّ: المستندُ لا ينطبق على صاحبه.
      if (st === 'not_required' || st === 'none') continue;
      const exp = S(e[d.field]).slice(0, 10);
      const n = dayNum(exp);
      if (n === null) continue; // بلا تاريخٍ مقروء — تلك قائمةُ عملٍ في الموارد البشريّة لا رسومٌ تُدفع
      const daysLeft = n - today;
      if (daysLeft > HORIZON) continue;
      rows.push({
        key: `${id}:${d.key}`,
        employeeId: id,
        employeeNumber: S(e.employeeNumber),
        name: nameOfEmp(e),
        idNumber: S(H.valueOf(e, 'iqamaNumber')),
        docType: d.key, docAr: d.ar, docEn: d.en,
        expiryDate: exp, daysLeft, expired: daysLeft < 0,
        department: S(e.department), staffCategory: S(e.staffCategory), project: S(e.project),
        nationality: S(e.nationality), branchName: S(e.branchName), registerNumber: S(e.registerNumber),
        workStatusText: S(e.workStatusText), iqamaProfession: S(e.iqamaProfession),
        paid: false, payment: null,
        _emp: e,
      });
    }
  }
  // الدفعاتُ الساريةُ لدورات هذه الصفوف بالضبط.
  if (rows.length) {
    const pays = await HrDocPayment.find({ voided: false, employee: { $in: [...new Set(rows.map((r) => r.employeeId))] } })
      .select('employee docType expiryDate amount note files paidAt paidByName').lean();
    const byKey = new Map(pays.map((p) => [`${p.employee}:${p.docType}:${p.expiryDate}`, p]));
    for (const r of rows) {
      const p = byKey.get(`${r.employeeId}:${r.docType}:${r.expiryDate}`);
      if (p) {
        r.paid = true;
        r.payment = { _id: p._id, amount: p.amount, note: p.note, files: p.files || [], paidAt: p.paidAt, paidByName: p.paidByName };
      }
    }
  }
  return rows;
}

/** فلاترُ الشاشة كما وصلت — مفصولةً بمجموعاتها لتُعَدّ كلُّ مجموعةٍ بدونها. */
function readQuery(q) {
  let cf = {};
  try {
    const raw = typeof q.cf === 'string' ? JSON.parse(q.cf || '{}') : (q.cf || {});
    for (const [k, v] of Object.entries(raw || {})) {
      if (!COLUMNS[k] || !Array.isArray(v) || !v.length) continue;
      cf[k] = new Set(v.map((x) => normKey(x)));
    }
  } catch (_) { cf = {}; }
  const win = S(q.window);
  return {
    window: win === 'expired' || WINDOWS.includes(Number(win)) ? win : '',
    doc: DOCS.some((d) => d.key === S(q.doc)) ? S(q.doc) : '',
    paid: ['paid', 'unpaid'].includes(S(q.paid)) ? S(q.paid) : '',
    quick: Object.fromEntries(QUICK_KEYS.map((k) => [k, multi(q[k])]).filter(([, v]) => v.length)),
    needle: S(q.q).toLowerCase(),
    cf,
  };
}

const quickVal = (r, k) => normKey(r[k]) || '—';
const inWindow = (r, w) => (w === 'expired' ? r.daysLeft < 0 : r.daysLeft >= 0 && r.daysLeft <= Number(w));

/** يمرّ الصفُّ بكلّ الفلاتر عدا `skip` (اسمُ مجموعةٍ أو `cf:<عمود>` أو `quick:<حقل>`). */
function passes(r, f, skip = '') {
  if (skip !== 'window' && f.window && !inWindow(r, f.window)) return false;
  if (skip !== 'doc' && f.doc && r.docType !== f.doc) return false;
  if (skip !== 'paid' && f.paid && (f.paid === 'paid') !== r.paid) return false;
  for (const [k, vals] of Object.entries(f.quick)) {
    if (skip === `quick:${k}`) continue;
    if (!vals.includes(quickVal(r, k))) return false;
  }
  if (f.needle) {
    const hay = `${r.name} ${r.employeeNumber} ${r.idNumber} ${r._emp.firstName || ''} ${r._emp.lastName || ''}`.toLowerCase();
    if (!hay.includes(f.needle)) return false;
  }
  for (const [k, set] of Object.entries(f.cf)) {
    if (skip === `cf:${k}`) continue;
    if (!set.has(cellOf(r, k))) return false;
  }
  return true;
}

const tally = (rows, valueOf) => {
  const m = new Map();
  for (const r of rows) { const v = valueOf(r); m.set(v, (m.get(v) || 0) + 1); }
  return [...m.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'ar'));
};

/** الحسابُ كلُّه: الصفوفُ المفلترة، وأعدادُ كلّ مجموعةٍ بدون فلترها. */
async function compute(query, { withColumns = true } = {}) {
  const all = await universe();
  const f = readQuery(query || {});
  const rows = all.filter((r) => passes(r, f));
  rows.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'ar') || a.docType.localeCompare(b.docType));

  const noWin = all.filter((r) => passes(r, f, 'window'));
  const windows = { all: noWin.length, expired: noWin.filter((r) => r.daysLeft < 0).length };
  for (const w of WINDOWS) windows[w] = noWin.filter((r) => inWindow(r, String(w))).length;

  const noDoc = all.filter((r) => passes(r, f, 'doc'));
  const docs = { all: noDoc.length };
  for (const d of DOCS) docs[d.key] = noDoc.filter((r) => r.docType === d.key).length;

  const noPaid = all.filter((r) => passes(r, f, 'paid'));
  const paid = { all: noPaid.length, paid: noPaid.filter((r) => r.paid).length, unpaid: noPaid.filter((r) => !r.paid).length };

  // بشكل HrQuickFilters: [{ key, values: [{ value, count }] }]
  const filters = QUICK_KEYS.map((k) => ({ key: k, values: tally(all.filter((r) => passes(r, f, `quick:${k}`)), (r) => quickVal(r, k)) }));

  const columnOptions = {};
  if (withColumns) {
    for (const k of Object.keys(COLUMNS)) columnOptions[k] = tally(all.filter((r) => passes(r, f, `cf:${k}`)), (r) => cellOf(r, k));
  }
  return { all, rows, f, counts: { windows, docs, paid }, filters, columnOptions };
}

const publicRow = (r) => {
  const { _emp, ...rest } = r;
  return rest;
};

// ═══════════════════════════════════════════════════════════════════════════
//  القراءة
// ═══════════════════════════════════════════════════════════════════════════
const listFor = (side) => async (req, res) => {
  try {
    const out = await compute(req.query);
    const finance = side === 'finance';
    res.json({
      rows: out.rows.slice(0, 5000).map(publicRow),
      total: out.rows.length,
      unpaidShown: out.rows.filter((r) => !r.paid).length,
      counts: out.counts,
      filters: out.filters,
      columnOptions: out.columnOptions,
      horizon: HORIZON, windows: WINDOWS, today: todayKey(),
      can: { pay: finance && canPay(req), undo: finance && canUndo(req) },
    });
  } catch (e) {
    console.error('hrFinance docs', e);
    res.status(500).json({ message: 'تعذّر تحميل الرسوم' });
  }
};
exports.financeDocs = listFor('finance');
exports.hrDocs = listFor('hr');

/** قوائمُ الفلترة السريعة وحدَها — تقرؤها HrQuickFilters من رابطها. */
exports.options = async (req, res) => {
  try {
    const out = await compute(req.query, { withColumns: false });
    res.json({ filters: out.filters });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

/** أرقامُ بطاقة «ماليات الموارد البشرية»: ما لم يُدفع، ومنه المنتهي، والطلباتُ المنتظرة. */
exports.summary = async (req, res) => {
  try {
    const [all, pending] = await Promise.all([universe(), HrFinanceRequest.countDocuments({ status: 'pending' })]);
    const unpaid = all.filter((r) => !r.paid);
    res.json({
      unpaid: unpaid.length,
      unpaidExpired: unpaid.filter((r) => r.daysLeft < 0).length,
      paid: all.length - unpaid.length,
      pendingRequests: pending,
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر التحميل' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  الدفع والتراجع
// ═══════════════════════════════════════════════════════════════════════════
/**
 * يحدّد الصفوفَ المقصودة: إمّا `items` بعينها ({employeeId, docType}) وإمّا
 * `all: true` مع `query` — فتُعاد قراءةُ نتائج الفلتر كلِّها في الخادم (لا صفحةُ
 * الشاشة وحدَها). والصفُّ يُقرأ من الملفّ الآن: الدورةُ التي تُدفع هي دورةُ اليوم،
 * لا ما كان في المتصفّح قبل ساعة.
 */
async function targetRows(body) {
  if (body?.all === true) {
    const out = await compute(body.query || {}, { withColumns: false });
    return { rows: out.rows, missing: 0 };
  }
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map((x) => ({ employeeId: S(x?.employeeId), docType: S(x?.docType) }))
    .filter((x) => mongoose.isValidObjectId(x.employeeId) && DOCS.some((d) => d.key === x.docType));
  if (!items.length) return { rows: [], missing: 0, empty: true };
  const all = await universe();
  const byKey = new Map(all.map((r) => [r.key, r]));
  const wanted = [...new Set(items.map((x) => `${x.employeeId}:${x.docType}`))];
  const rows = wanted.map((k) => byKey.get(k)).filter(Boolean);
  return { rows, missing: wanted.length - rows.length };
}

// POST /api/finance/hr-docs/pay   { items | all+query, note, amount, files }
exports.markPaid = async (req, res) => {
  try {
    if (!canPay(req)) return res.status(403).json({ message: 'تسجيلُ الدفع للإدارة الماليّة' });
    const b = req.body || {};
    const t = await targetRows(b);
    if (t.empty) return res.status(400).json({ message: 'اختر مستندًا واحدًا على الأقلّ' });
    const todo = t.rows.filter((r) => !r.paid);
    if (!todo.length) return res.json({ paid: 0, already: t.rows.length, missing: t.missing });

    let amount = null;
    if (b.amount !== undefined && b.amount !== null && S(b.amount) !== '') {
      amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: 'المبلغ غير صحيح' });
    }
    let files = [];
    try { files = saveFiles(b.files); } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }

    const byName = nameOfUser(req.user);
    const docs = todo.map((r) => ({
      employee: r.employeeId, docType: r.docType, expiryDate: r.expiryDate,
      snapshot: { name: r.name, employeeNumber: r.employeeNumber, idNumber: r.idNumber, department: r.department },
      amount, note: S(b.note).slice(0, 2000), files,
      paidAt: new Date(), paidBy: req.user?._id, paidByName: byName,
    }));
    // ── وإدراجٌ لا يكرّر ─────────────────────────────────────────────────────
    // دفعها غيرُه في اللحظة نفسِها؟ `$setOnInsert` مع الشرط يجعل الدورةَ المدفوعةَ
    // تُترَك كما هي، ويُعَدّ ما أُدرج فعلًا لا ما أُرسل.
    let n = 0;
    try {
      const r = await HrDocPayment.bulkWrite(docs.map((d) => ({
        updateOne: {
          filter: { employee: d.employee, docType: d.docType, expiryDate: d.expiryDate, voided: false },
          update: { $setOnInsert: { ...d, voided: false } },
          upsert: true,
        },
      })), { ordered: false });
      n = r.upsertedCount ?? r.nUpserted ?? 0;
    } catch (e) {
      if (e.code !== 11000 && !(e.writeErrors || []).every((w) => w.code === 11000)) throw e;
      n = e.result?.upsertedCount ?? e.result?.nUpserted ?? 0;
    }
    if (!n) files.forEach((x) => deleteStoredFile(x.fileUrl));
    logAudit({
      user: req.user, action: 'hr_doc_fees_paid', entity: 'HrDocPayment',
      changes: { after: { count: n, amount, note: S(b.note), files: files.length, docs: todo.slice(0, 200).map((r) => `${r.employeeNumber || r.name} ${r.docType} ${r.expiryDate}`) } },
      ipAddress: req.ip,
    }).catch(() => {});
    announce('fees');
    res.json({ paid: n, already: t.rows.length - todo.length + (todo.length - n), missing: t.missing });
  } catch (e) {
    console.error('hrFinance markPaid', e);
    res.status(500).json({ message: 'تعذّر تسجيل الدفع' });
  }
};

// POST /api/finance/hr-docs/unpay   { items | all+query, note }
exports.undoPaid = async (req, res) => {
  try {
    if (!canUndo(req)) return res.status(403).json({ message: 'التراجعُ عن الدفع لمديري الإدارة الماليّة' });
    const b = req.body || {};
    const t = await targetRows(b);
    if (t.empty) return res.status(400).json({ message: 'اختر مستندًا واحدًا على الأقلّ' });
    const paid = t.rows.filter((r) => r.paid && r.payment?._id);
    if (!paid.length) return res.json({ undone: 0 });
    const r = await HrDocPayment.updateMany(
      { _id: { $in: paid.map((x) => x.payment._id) }, voided: false },
      { $set: { voided: true, voidedAt: new Date(), voidedBy: req.user?._id, voidedByName: nameOfUser(req.user), voidNote: S(b.note).slice(0, 2000) } },
    );
    logAudit({
      user: req.user, action: 'hr_doc_fees_unpaid', entity: 'HrDocPayment',
      changes: { before: { docs: paid.slice(0, 200).map((x) => `${x.employeeNumber || x.name} ${x.docType} ${x.expiryDate}`) }, after: { voided: r.modifiedCount, note: S(b.note) } },
      ipAddress: req.ip,
    }).catch(() => {});
    announce('fees');
    res.json({ undone: r.modifiedCount || 0 });
  } catch (e) {
    console.error('hrFinance undoPaid', e);
    res.status(500).json({ message: 'تعذّر التراجع' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  طلباتُ الموارد البشريّة إلى الماليّة
// ═══════════════════════════════════════════════════════════════════════════
const nextNumber = async () => {
  const last = await HrFinanceRequest.findOne({}).sort({ number: -1 }).select('number').lean();
  return (last?.number || 1000) + 1;
};

/**
 * GET …/hr-requests?status=&from=&to=&q=&mine=1
 * والعدّادُ بكلّ الفلاتر عدا الحالة — فلا يتغيّر رقمُ «قيد الانتظار» حين تُفتح «تمّ».
 */
const listRequestsFor = (side) => async (req, res) => {
  try {
    const f = {};
    const { startOfDay, endOfDay } = require('../utils/companyDay');
    const from = startOfDay(S(req.query.from));
    const to = endOfDay(S(req.query.to));
    if (from || to) f.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (req.query.mine === '1') f.createdBy = req.user?._id;
    const needle = S(req.query.q);
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const or = [{ 'items.name': rx }, { 'items.employeeNumber': rx }, { 'items.idNumber': rx }, { 'items.note': rx }, { createdByName: rx }];
      if (/^\d+$/.test(needle)) or.push({ number: Number(needle) });
      f.$or = or;
    }
    if (req.query.id && mongoose.isValidObjectId(S(req.query.id))) f._id = S(req.query.id);
    const status = multi(req.query.status).filter((s) => HrFinanceRequest.STATUSES.includes(s));
    const listF = status.length ? { ...f, status: { $in: status } } : f;
    const [requests, counts] = await Promise.all([
      HrFinanceRequest.find(listF).sort({ createdAt: -1 }).limit(500).lean(),
      HrFinanceRequest.aggregate([{ $match: f }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const c = Object.fromEntries(counts.map((x) => [x._id, x.n]));
    res.json({
      requests,
      counts: { all: Object.values(c).reduce((a, n) => a + n, 0), pending: c.pending || 0, done: c.done || 0, not_done: c.not_done || 0 },
      can: { answer: side === 'finance' && canPay(req), create: side === 'hr' },
    });
  } catch (e) {
    console.error('hrFinance listRequests', e);
    res.status(500).json({ message: 'تعذّر تحميل الطلبات' });
  }
};
exports.financeRequests = listRequestsFor('finance');
exports.hrRequests = listRequestsFor('hr');

// POST /api/hr/finance-requests   { items: [{ employee, note }], files }
exports.createRequest = async (req, res) => {
  try {
    const b = req.body || {};
    const raw = (Array.isArray(b.items) ? b.items : [])
      .map((x) => ({ employee: S(x?.employee || x?.employeeId), note: S(x?.note).slice(0, 2000) }))
      .filter((x) => mongoose.isValidObjectId(x.employee));
    // الموظّفُ الواحدُ مرّةً واحدة — وإن اختير مرّتين بقي أوّلُ ما كُتب له.
    const seen = new Set();
    const items = raw.filter((x) => (seen.has(x.employee) ? false : seen.add(x.employee)));
    if (!items.length) return res.status(400).json({ message: 'اختر موظّفًا واحدًا على الأقلّ' });
    if (items.length > 200) return res.status(400).json({ message: 'الحدّ ٢٠٠ موظّف في الطلب الواحد' });
    const blank = items.filter((x) => !x.note);
    if (blank.length) return res.status(400).json({ message: 'اكتب أمامَ كلّ موظّفٍ ما تحتاجه له' });

    const emps = await Employee.find({ _id: { $in: items.map((x) => x.employee) } })
      .select(['arabicName', 'firstName', 'lastName', 'employeeNumber', 'department', 'iqamaNumber', 'nationalId', ...H.READ_DEPS].join(' ')).lean();
    const byId = new Map(emps.map((e) => [String(e._id), e]));
    if (byId.size !== items.length) return res.status(400).json({ message: 'موظّفٌ غير موجود في الملفّ' });

    let files = [];
    try { files = saveFiles(b.files); } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }

    let doc;
    try {
      doc = await HrFinanceRequest.create({
        number: await nextNumber(),
        items: items.map((x) => {
          const e = byId.get(x.employee);
          return {
            employee: e._id, name: nameOfEmp(e), employeeNumber: S(e.employeeNumber),
            idNumber: S(H.valueOf(e, 'iqamaNumber')), department: S(e.department), note: x.note,
          };
        }),
        files,
        createdBy: req.user?._id,
        createdByName: nameOfUser(req.user),
      });
    } catch (e) {
      files.forEach((x) => deleteStoredFile(x.fileUrl));
      throw e;
    }

    // يُبلَّغ أهلُ المال بالدور — لا بقائمة أسماءٍ تشيخ. ولا يُبلَّغ الفاعلُ نفسُه.
    try {
      const { createNotification } = require('../services/notificationService');
      const users = await User.find({ role: { $in: FINANCE_NOTIFY_ROLES }, isActive: { $ne: false } }).select('_id').lean();
      const first = doc.items[0];
      await Promise.all(users.filter((u) => String(u._id) !== String(req.user?._id)).map((u) => createNotification({
        recipient: u._id,
        type: 'approval_needed',
        title: `طلب من الموارد البشرية #${doc.number}`,
        message: doc.items.length === 1
          ? `${first.name}: ${first.note}`.slice(0, 300)
          : `${doc.items.length} موظفين — ${first.name}: ${first.note}`.slice(0, 300),
        relatedEntity: 'HrFinanceRequest',
        relatedEntityId: doc._id,
      }).catch(() => {})));
    } catch (_) { /* التبليغُ زيادةٌ لا شرط */ }

    logAudit({
      user: req.user, action: 'create', entity: 'HrFinanceRequest', entityId: doc._id,
      changes: { after: { number: doc.number, employees: doc.items.length, files: files.length } }, ipAddress: req.ip,
    }).catch(() => {});
    announce('requests');
    res.status(201).json({ request: doc });
  } catch (e) {
    console.error('hrFinance createRequest', e);
    res.status(500).json({ message: 'تعذّر إرسال الطلب' });
  }
};

// PATCH /api/finance/hr-requests/:id   { status: 'done'|'not_done', note, files }
exports.answerRequest = async (req, res) => {
  try {
    if (!canPay(req)) return res.status(403).json({ message: 'الجوابُ للإدارة الماليّة' });
    const b = req.body || {};
    const status = S(b.status);
    if (!['done', 'not_done'].includes(status)) return res.status(400).json({ message: 'اختر «تمّ» أو «لم يتمّ»' });
    const doc = await HrFinanceRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'الطلب غير موجود' });

    let files = [];
    try { files = saveFiles(b.files); } catch (e) { return res.status(e.status || 400).json({ message: e.message }); }
    const before = { status: doc.status, note: doc.answerNote };
    const byName = nameOfUser(req.user);
    const note = S(b.note).slice(0, 2000);
    doc.status = status;
    doc.answerNote = note;
    // مرفقاتُ الجواب تتراكم: تصحيحُ الجواب لا يمحو ما أُرفق قبله.
    doc.answerFiles = [...(doc.answerFiles || []), ...files];
    doc.answeredBy = req.user?._id;
    doc.answeredByName = byName;
    doc.answeredAt = new Date();
    doc.history.push({ status, note, files, by: req.user?._id, byName, at: new Date() });
    await doc.save();

    if (doc.createdBy && String(doc.createdBy) !== String(req.user?._id)) {
      try {
        const { createNotification } = require('../services/notificationService');
        await createNotification({
          recipient: doc.createdBy,
          type: 'status_changed',
          title: `ردّت الإدارة المالية على الطلب #${doc.number}: ${status === 'done' ? 'تمّ' : 'لم يتمّ'}`,
          message: (note || `${doc.items.length} موظفين`).slice(0, 300),
          relatedEntity: 'HrFinanceRequestReply',
          relatedEntityId: doc._id,
        });
      } catch (_) { /* التبليغُ زيادة */ }
    }

    logAudit({
      user: req.user, action: 'answer', entity: 'HrFinanceRequest', entityId: doc._id,
      changes: { before, after: { status, note, files: files.length } }, ipAddress: req.ip,
    }).catch(() => {});
    announce('requests');
    res.json({ request: doc.toObject() });
  } catch (e) {
    console.error('hrFinance answerRequest', e);
    res.status(500).json({ message: 'تعذّر حفظ الجواب' });
  }
};

exports._compute = compute;
exports._PAY_ROLES = PAY_ROLES;
exports._UNDO_ROLES = UNDO_ROLES;
