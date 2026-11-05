/** HR finance: residency and work-permit fees, and HR requests. Finance (/api/finance): GET   /hr-docs             due documents + bucket counts + filter lists GET   /hr-docs/options     quick-filter lists only (HrQuickFilters) GET   /hr-docs/summary     numbers for the HR finance card POST  /hr-docs/pay         mark fees paid - given rows or all filter results POST  /hr-docs/unpay       undo a payment (finance managers) GET   /hr-requests         HR requests inbox PATCH /hr-requests/:id     answer: done / not done + note + attachments HR (/api/hr): GET   /finance-follow/docs      same rows with payment state - read only GET   /finance-follow/options GET   /finance-requests         department requests to finance POST  /finance-requests         new request: employees + needs + attachments A row is a document, not an employee: each resident has two fee-paying documents (residency, work permit), so one employee can show two rows with one paid. Shown: not ended, not archived (`employment=current` in hrMaster.buildFilter, with utils/endedStaff as a safeguard), not Saudi (no residency or work permit; see skipGroups in models/Employee), document required and with a readable date. Included: expired ones and those 20 days or less from expiry. Counts do not move under the one clicking: each group of numbers is computed with all filters except its own, as in hrMaster.expiring. All computed in memory (hundreds of rows) with filters applied in one place, so numbers match the table they open. Paying is not renewing: it records payment and changes no date. Renewal stays with HR from the employee file; when the date changes a new unpaid cycle starts (models/HrDocPayment). */
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

// Ownership
/** Who records payment and answers requests: finance staff and anyone granted the section edit access. */
const PAY_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant'];
/** Undoing a payment is for finance managers only, guarded by `authorize.strict`. */
const UNDO_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager'];
/** Who is notified of a new HR request. */
const FINANCE_NOTIFY_ROLES = ['cfo', 'finance_manager', 'accounting_manager', 'accountant'];

const roleIn = (user, list) => list.map(canonicalRole).includes(canonicalRole(user?.role));
const canPay = (req) => roleIn(req.user, PAY_ROLES) || req.sectionAccess === 'edit';
const canUndo = (req) => roleIn(req.user, UNDO_ROLES);

// Broadcast: the finance and HR pages listen to one event.
const announce = (kind) => {
  try { require('../websocket/socketManager').emitToAll('hr-finance:changed', { kind, at: Date.now() }); } catch (_) { /* The broadcast is optional. */ }
};

// Attachments: data URL in JSON like the rest of the system (no multer)
const MAX_FILES = 10;
const MB = 1024 * 1024;
const MAX_TOTAL = 18 * MB; // The server accepts 25 MB per request and base64 adds a third.

/** Save the attachments and return what to store; reject before writing anything. */
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

// Document rows
const DOCS = [
  { key: 'iqama', ar: 'إقامة', en: 'Iqama', field: 'iqamaExpiry' },
  { key: 'workPermit', ar: 'رخصة عمل', en: 'Work permit', field: 'workPermitExpiry' },
];
/** Widest window: 20 days or less remaining; the buckets are cumulative beneath it. */
const HORIZON = 20;
const WINDOWS = [20, 15, 10, 5];
/** The same quick filters as the HR dashboard header (HrQuickFilters). */
const FV = require('../utils/hrFilterValue');
const QUICK_KEYS = ['department', 'staffCategory', 'registerNumber', 'branchName', 'workStatusText', 'project', 'nationality', 'iqamaProfession'];

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;
const dayNum = (ymd) => {
  const m = YMD.exec(String(ymd || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};

/** Table columns filterable Excel-style. The value is read here only, so what is filtered on and what is counted in the list are the same. (`doc` and `paid` are codes the UI translates.) */
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
  registerShown: (r) => r.registerShown,
  paid: (r) => (r.paid ? 'paid' : 'unpaid'),
  paidByName: (r) => r.payment?.paidByName || '',
};
const cellOf = (r, k) => normKey(COLUMNS[k] ? COLUMNS[k](r) : '');

/** The register number, or the kind when the file has none: same words as the HR master. */
const registerShownOf = (e) => {
  const kind = require('../utils/hrEngagement').engagementOf(e);
  if (kind === 'freelance') return 'فريلانسر';
  if (kind === 'trainee') return 'متدرّب';
  return S(e.registerNumber) || 'غير محدّد';
};

/** Every document due today, before any screen filter. */
async function universe() {
  const { _buildFilter } = require('./hrMasterController');
  const match = { $and: [_buildFilter({ employment: 'current' }), { idType: { $ne: 'national_id' } }] };
  const select = ['employeeNumber', 'arabicName', 'firstName', 'lastName', 'idType', 'iqamaNumber', 'nationalId', 'employmentStatus',
    'nationality', 'fieldStatus', ...FV.STATUS_DEPS.split(' '), ...QUICK_KEYS, ...DOCS.map((d) => d.field), ...H.READ_DEPS].join(' ');
  const [emps, ended] = await Promise.all([
    Employee.find(match).select(select).lean(),
    endedStaff().catch(() => null),
  ]);
  const today = dayNum(todayKey());
  const rows = [];
  for (const e of emps) {
    const id = String(e._id);
    if (ended && (ended.ids.has(id) || ended.archivedIds.has(id))) continue;
    // A Saudi has no residency or work permit, even if his identity type was entered wrongly.
    if (/سعود|saudi/i.test(String(e.nationality || ''))) continue;
    for (const d of DOCS) {
      const st = e.fieldStatus?.[H.statusKeyOf(d.field)];
      // Not-required and none are administrative decisions: the document does not apply to the holder.
      if (st === 'not_required' || st === 'none') continue;
      const exp = S(e[d.field]).slice(0, 10);
      const n = dayNum(exp);
      if (n === null) continue; // No readable date: that is an HR work list, not fees to pay.
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
        nationality: S(e.nationality), branchName: S(e.branchName), registerNumber: S(e.registerNumber), registerShown: registerShownOf(e),
        workStatusText: S(e.workStatusText) || FV.derivedOf(e, 'workStatusText'), iqamaProfession: S(e.iqamaProfession) || FV.answerOf(e, 'iqamaProfession'),
        paid: false, payment: null,
        _emp: e,
      });
    }
  }
  // Active payments for exactly these rows' cycles.
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

/** Screen filters as received, split by group so each group can be counted without itself. */
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

const quickVal = (r, k) => (FV.applies(r, k) ? normKey(r[k]) || '—' : null);
const inWindow = (r, w) => (w === 'expired' ? r.daysLeft < 0 : r.daysLeft >= 0 && r.daysLeft <= Number(w));

/** The row passes all filters except `skip` (a group name, `cf:<column>` or `quick:<field>`). */
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
  for (const r of rows) { const v = valueOf(r); if (v !== null) m.set(v, (m.get(v) || 0) + 1); }
  return [...m.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'ar'));
};

/** The whole computation: filtered rows and each group's counts without its own filter. */
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

  // Shaped like HrQuickFilters: [{ key, values: [{ value, count }] }]
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

// Reads
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

/** Quick-filter lists only; HrQuickFilters reads them from its link. */
exports.options = async (req, res) => {
  try {
    const out = await compute(req.query, { withColumns: false });
    res.json({ filters: out.filters });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

/** Numbers for the HR finance card: unpaid, of which expired, and waiting requests. */
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

// Pay and undo
/** Select the target rows: either explicit `items` ({employeeId, docType}) or `all: true` with `query`, which re-reads all filter results on the server (not just the screen's page). The row is read from the file now: the cycle paid is today's, not what the browser held an hour ago. */
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
    // Insert without duplicating. If someone else paid in the same moment, `$setOnInsert` with the condition leaves an already paid cycle as is, and the count is of rows actually inserted, not sent.
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

// HR requests to finance
const nextNumber = async () => {
  const last = await HrFinanceRequest.findOne({}).sort({ number: -1 }).select('number').lean();
  return (last?.number || 1000) + 1;
};

/**
 * GET .../hr-requests?status=&from=&to=&q=&mine=1
 * The counter uses all filters except status, so the pending number does not change when done is opened.
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
    // Each employee once; if picked twice, the first entry written for him stays.
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

    // Finance is notified by role, not by an aging name list, and the actor is not notified.
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
    } catch (_) { /* Notification is an extra, not a requirement. */ }

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
    // Answer attachments accumulate: correcting an answer does not erase earlier attachments.
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
      } catch (_) { /* Notification is an extra. */ }
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
