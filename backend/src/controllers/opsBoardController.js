/**
 * Loads & shipments board (/api/ops-board): the workflow rows without invoicing, collection, customs and selling columns.
 * Reads and writes go through the workflow's own filter and status path, so the board, the workflow, shipment orders and fleet loads never disagree.
 */
const OperationsWorkflow = require('../models/OperationsWorkflow');
const WF = require('../controllers/workflowController');
const BOARD = require('../config/opsBoard');
const { FULL_ACCESS_ROLES } = require('../config/constants');

const HIDDEN = new Set(BOARD.HIDDEN_FIELDS);
const SELECT = BOARD.FIELDS.join(' ');
// Filters that would read a hidden column (invoice gaps, customs link) are not honoured here.
const DROP_QUERY = new Set(['invoiceGap', 'pendingKind', 'pendingOnly', 'pendingAsOf', 'customs', 'stage']);

/** Same rule as the sidebar: the page decides, opened by default for the board roles or ticked on the permissions page. */
async function gate(req, res, next) {
  try {
    if (FULL_ACCESS_ROLES.includes(req.user.role)) return next();
    const pages = await require('../utils/permissions').effectivePages(req.user.role);
    if (pages[BOARD.PAGE] === true) return next();
  } catch (e) { /* fall through to the refusal */ }
  return res.status(403).json({ code: 'PAGE_FORBIDDEN', message: 'صفحة متابعة الحمولات والشحنات خارج صلاحيّاتك' });
}

function cleanQuery(q) {
  const out = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (DROP_QUERY.has(k)) continue;
    if (k.startsWith('cf_') && HIDDEN.has(k.slice(3))) continue;
    out[k] = v;
  }
  if (q && q._related) Object.defineProperty(out, '_related', { value: q._related, enumerable: false });
  if (q && q._exactId) Object.defineProperty(out, '_exactId', { value: q._exactId, enumerable: false });
  return out;
}

const shape = (role, rows) => WF.stripMoneyFor(role, rows).map((r) => {
  const o = { ...r };
  for (const f of HIDDEN) delete o[f];
  o.hasWaybill = !!(r.shipmentOrder || r.fleetShipment);
  o.origin = r.fleetShipment ? 'fleet' : (r.shipmentOrder ? 'orders' : 'platform');
  return o;
});

// GET /api/ops-board
exports.list = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const q = cleanQuery(req.query);
    const filter = WF.buildWorkflowFilter(q, undefined, false, false);
    // Status counts ignore the status filter itself, so every chip keeps its number.
    const countFilter = WF.buildWorkflowFilter(q, 'applicationStatus', false, false);
    const [{ rows, total }, byStatus] = await Promise.all([
      WF.pageOfReports(filter, { select: SELECT, skip: (page - 1) * limit, limit, searching: !!String(req.query.search || '').trim() }),
      OperationsWorkflow.aggregate([{ $match: countFilter }, { $group: { _id: '$applicationStatus', n: { $sum: 1 } } }]),
    ]);
    res.json({
      rows: shape(req.user.role, rows),
      total, page, pages: Math.ceil(total / limit),
      byStatus: Object.fromEntries(byStatus.map((b) => [String(b._id || ''), b.n])),
    });
  } catch (e) {
    console.error('ops-board list:', e);
    res.status(500).json({ message: 'تعذّر تحميل الحمولات' });
  }
};

// GET /api/ops-board/filters?field=… — one column's values with counts, under the board's other filters.
const FILTERABLE = new Set(BOARD.FILTER_FIELDS);
exports.filters = (req, res) => {
  const field = String(req.query.field || '');
  if (!FILTERABLE.has(field)) return res.status(400).json({ message: 'Unknown filter column' });
  return WF.filterOptions({ user: req.user, query: cleanQuery(req.query) }, res);
};

// PATCH /api/ops-board/:id/status
exports.setStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    const wf = await OperationsWorkflow.findById(req.params.id)
      .select('externalSource externalId shipmentOrder fleetShipment applicationStatus reportNumber lockedBy lockedByName lockedAt');
    if (!wf) return res.status(404).json({ message: 'أمر النقل غير موجود' });
    if (WF.isLocked(wf, req.user._id)) return res.status(423).json({ message: `أمر النقل مفتوحٌ لدى ${wf.lockedByName || 'مستخدمٍ آخر'}` });
    const out = await WF.pushApplicationStatus(wf, status, req.user);
    if (!out) return res.status(400).json({ message: 'هذا أمر النقل لا حالةَ طلبٍ له تُغيَّر.' });
    const row = await OperationsWorkflow.findById(wf._id).select(SELECT).lean();
    res.json(row ? shape(req.user.role, [row])[0] : { _id: wf._id, applicationStatus: status });
  } catch (e) {
    const known = /حالةٌ غير معروفة/.test(e.message || '');
    if (!known) console.error('ops-board status:', e);
    res.status(known ? 400 : 500).json({ message: known ? e.message : 'تعذّر تغيير الحالة' });
  }
};

// GET /api/ops-board/:id/waybill.pdf — the same file the shipment orders and fleet pages print.
exports.waybill = async (req, res) => {
  const wf = await OperationsWorkflow.findById(req.params.id).select('shipmentOrder fleetShipment').lean();
  if (!wf) return res.status(404).json({ message: 'أمر النقل غير موجود' });
  if (wf.fleetShipment) {
    return require('./fleetController').getWaybillPdf({ ...req, params: { id: String(wf.fleetShipment) }, query: req.query }, res);
  }
  if (wf.shipmentOrder) {
    return require('./shipmentOrdersController').getWaybillsPdf({ ...req, body: { ids: [String(wf.shipmentOrder)] } }, res);
  }
  return res.status(404).json({ message: 'هذا السطر من منصّة التشغيل القديمة ولا يوجد له أمر نقل في النظام' });
};

exports.gate = gate;
