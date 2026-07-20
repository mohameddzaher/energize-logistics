const CustomsClearance = require('../models/CustomsClearance');
const { recomputeTotals } = require('../models/CustomsClearance');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');

// Scalar fields a client may set on create/update.
const EDITABLE = [
  'branch', 'stage', 'cancelled', 'assignedTo', 'customerName', 'customer',
  'shippingAgent', 'shippingAgentEmail', 'blNumber', 'invoiceNumber', 'invoiceDate',
  'port', 'invoiceType', 'containerCount', 'totalWeight', 'invoiceValue', 'currency',
  'exporterCompany', 'countryOfOrigin', 'hsCode', 'saberNumber', 'notes',
  // master-spreadsheet additions
  'legacySerial', 'periodMonth', 'periodYear', 'city',
  'declarationNumber', 'declarationDate', 'papersReceivedDate',
  'unloadingAppointment', 'unloadingLocation', 'doNumber', 'exitPermitNumber',
];

// Sub-documents. Sent as whole objects by the frontend but merged field-by-field
// here so a partial PUT can never wipe the sibling keys.
const NESTED = {
  documents: ['bl', 'commercialInvoice', 'certificateOfOrigin', 'packingList', 'saber'],
  agentPapers: ['blStamped', 'customerAuthorization', 'companyAuthorization'],
  stageDates: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  stageDone: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  costs: ['deliveryOrder', 'customsDuty', 'portFees', 'unloadingFees', 'transport', 'transportToYard', 'appointmentBooking', 'yardFees', 'demurrage', 'inspection', 'securityScan', 'extension', 'consolidator', 'commissions', 'storage', 'labour', 'exitPermit'],
  revenue: ['clearanceFee', 'transportSelling', 'transportNet', 'transportToYardNet', 'yardTransportNet', 'totalInvoiced'],
  billing: ['invoiceStatus', 'ourInvoiceNumber', 'invoicedAt'],
};

const NUMERIC_NESTED = new Set(['costs', 'revenue']);

/**
 * Build an update payload from a request body.
 * `existing` (a lean doc) is merged under the incoming sub-documents so partial
 * updates keep untouched keys. costs.total / revenue.profit are always derived,
 * never taken from the client.
 */
function pick(body, existing) {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  if (out.customer === '' || out.customer === null) delete out.customer;

  for (const [group, keys] of Object.entries(NESTED)) {
    const incoming = body[group];
    if (incoming === undefined || incoming === null || typeof incoming !== 'object') continue;
    const base = (existing && existing[group]) || {};
    const merged = {};
    for (const k of keys) {
      const v = incoming[k] !== undefined ? incoming[k] : base[k];
      if (v === undefined) continue;
      merged[k] = NUMERIC_NESTED.has(group) ? (Number.isFinite(Number(v)) ? Number(v) : 0) : v;
    }
    out[group] = merged;
  }

  if (Array.isArray(body.containers)) {
    out.containers = body.containers
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        containerNumber: String(r.containerNumber || '').trim(),
        exitPermit: Number.isFinite(Number(r.exitPermit)) ? Number(r.exitPermit) : 0,
        declaration: String(r.declaration || '').trim(),
        notes: String(r.notes || '').trim(),
      }));
  }

  // Derive totals from whichever cost/revenue values will end up stored.
  const merged = {
    costs: { ...((existing && existing.costs) || {}), ...(out.costs || {}) },
    revenue: { ...((existing && existing.revenue) || {}), ...(out.revenue || {}) },
  };
  recomputeTotals(merged);
  if (out.costs || (existing && existing.costs)) out.costs = merged.costs;
  if (out.revenue || (existing && existing.revenue)) out.revenue = merged.revenue;

  return out;
}

exports.getClearances = async (req, res) => {
  try {
    const { search, branch, stage, active, year, month, invoiceStatus } = req.query;
    const filter = {};
    if (branch) filter.branch = branch;
    if (stage) filter.stage = stage;
    if (active === 'true') filter.cancelled = { $ne: true };
    if (year) filter.periodYear = Number(year);
    if (month) filter.periodMonth = Number(month);
    if (invoiceStatus) filter['billing.invoiceStatus'] = invoiceStatus;

    let list = await CustomsClearance.find(filter).sort({ createdAt: -1 });

    if (search) {
      const s = search.toLowerCase();
      list = list.filter((c) =>
        [c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.invoiceNumber, c.port]
          .some((v) => v && String(v).toLowerCase().includes(s))
      );
    }

    res.json({ clearances: list });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load clearances' });
  }
};

exports.getClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id).populate('customer', 'name');
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    res.json({ clearance });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load clearance' });
  }
};

exports.createClearance = async (req, res) => {
  try {
    const data = pick(req.body, null);
    data.createdBy = req.user._id;
    const clearance = await CustomsClearance.create(data);

    await logAudit({ user: req.user._id, action: 'create_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:created', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to create clearance' });
  }
};

exports.updateClearance = async (req, res) => {
  try {
    const existing = await CustomsClearance.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ message: 'Clearance not found' });
    const data = pick(req.body, existing);
    data.lastModifiedBy = req.user._id;
    const clearance = await CustomsClearance.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: clearance.stage } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to update clearance' });
  }
};

/**
 * Dashboard metrics for /system/customs/analytics — mirrors the company's
 * "UI_AI_dashboard" sheet.
 *
 * Query: ?year=2026  or  ?from=YYYY-MM&to=YYYY-MM (inclusive, on periodYear/periodMonth).
 * Cancelled transactions are excluded from every figure.
 */
exports.getAnalytics = async (req, res) => {
  try {
    const { year, from, to } = req.query;
    const filter = { cancelled: { $ne: true } };
    if (year) filter.periodYear = Number(year);

    let list = await CustomsClearance.find(filter)
      .select('blNumber customerName shippingAgent city branch containerCount periodMonth periodYear costs revenue billing')
      .lean();

    // from/to are month keys (YYYY-MM); filter in JS so rows with no period survive
    // an unbounded request but are excluded from an explicitly bounded one.
    const key = (r) => (r.periodYear && r.periodMonth ? r.periodYear * 100 + r.periodMonth : null);
    if (from || to) {
      const lo = from ? Number(String(from).slice(0, 4)) * 100 + Number(String(from).slice(5, 7) || 1) : -Infinity;
      const hi = to ? Number(String(to).slice(0, 4)) * 100 + Number(String(to).slice(5, 7) || 12) : Infinity;
      list = list.filter((r) => { const k = key(r); return k !== null && k >= lo && k <= hi; });
    }

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const add = (bucket, r) => {
      bucket.count += 1;
      bucket.containers += num(r.containerCount);
      bucket.revenue += num(r.revenue && r.revenue.totalInvoiced);
      bucket.costs += num(r.costs && r.costs.total);
      bucket.clearanceFee += num(r.revenue && r.revenue.clearanceFee);
      if (r.branch === 'dammam') bucket.dammam += 1; else bucket.jeddah += 1;
      return bucket;
    };
    const blank = () => ({ count: 0, containers: 0, revenue: 0, costs: 0, clearanceFee: 0, jeddah: 0, dammam: 0 });
    const group = (rows, keyFn) => {
      const m = new Map();
      for (const r of rows) {
        const k = (keyFn(r) || '').toString().trim() || '—';
        if (!m.has(k)) m.set(k, { key: k, ...blank() });
        add(m.get(k), r);
      }
      return [...m.values()];
    };
    const round = (x) => Math.round(x * 100) / 100;
    const finish = (arr, totalContainers) => arr
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        clearanceFee: round(b.clearanceFee),
        profit: round(b.revenue - b.costs),
        avgContainers: b.count ? round(b.containers / b.count) : 0,
        containerShare: totalContainers ? b.containers / totalContainers : 0,
      }))
      .sort((a, b) => b.containers - a.containers || b.count - a.count)
      .map((b, i) => ({ ...b, rank: i + 1 }));

    const totalContainers = list.reduce((a, r) => a + num(r.containerCount), 0);
    const totalRevenue = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.totalInvoiced), 0));
    const totalCosts = round(list.reduce((a, r) => a + num(r.costs && r.costs.total), 0));
    const clearanceFees = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.clearanceFee), 0));
    const invoiced = list.filter((r) => (r.billing && String(r.billing.invoiceStatus || '').trim()) || num(r.revenue && r.revenue.totalInvoiced) > 0).length;
    const months = new Set(list.filter((r) => key(r) !== null).map((r) => key(r)));

    const byMonth = group(list.filter((r) => key(r) !== null), (r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`)
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        profit: round(b.revenue - b.costs),
        year: Number(b.key.slice(0, 4)),
        month: Number(b.key.slice(5, 7)),
      }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    res.json({
      totals: {
        clearances: list.length,
        containers: totalContainers,
        customers: new Set(list.map((r) => (r.customerName || '').trim()).filter(Boolean)).size,
        agents: new Set(list.map((r) => (r.shippingAgent || '').trim()).filter(Boolean)).size,
        invoiced,
        notInvoiced: list.length - invoiced,
        avgContainersPerBl: list.length ? round(totalContainers / list.length) : 0,
        totalRevenue,
        clearanceFees,
        totalCosts,
        netProfit: round(totalRevenue - totalCosts),
        margin: totalRevenue ? (totalRevenue - totalCosts) / totalRevenue : 0,
        jeddah: list.filter((r) => r.branch !== 'dammam').length,
        dammam: list.filter((r) => r.branch === 'dammam').length,
        avgInvoice: list.length ? round(totalRevenue / list.length) : 0,
        monthsCovered: months.size,
        avgPerMonth: months.size ? round(list.length / months.size) : 0,
      },
      byCustomer: finish(group(list, (r) => r.customerName), totalContainers),
      byAgent: finish(group(list, (r) => r.shippingAgent), totalContainers),
      byCity: finish(group(list, (r) => r.city || (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      byMonth,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load customs analytics' });
  }
};

exports.deleteClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findByIdAndDelete(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'delete_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    try { emitToAll('customs:deleted', { clearanceId: clearance._id }); } catch (e) {}

    res.json({ message: 'Clearance deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete clearance' });
  }
};
