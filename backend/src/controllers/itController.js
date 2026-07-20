const ItTicket = require('../models/ItTicket');
const ItSystem = require('../models/ItSystem');
// Custody deliberately reuses the HR Asset collection — an IT-issued laptop must
// appear on the employee's HR profile automatically, so there is exactly ONE
// custody collection in the system. /api/hr/* is gated to HR roles, which is the
// only reason these IT-facing endpoints exist at all.
const Asset = require('../models/Asset');
const Employee = require('../models/Employee');
const { emitToAll } = require('../websocket/socketManager');

// ── Helpers ─────────────────────────────────────────────────────────────────

const emit = (event, payload) => {
  try { emitToAll(event, payload); } catch (e) {}
};

// Custody writes touch data both sections display, so both must refresh.
const emitCustody = (payload) => {
  emit('hr:asset', payload);
  emit('it:updated', payload);
};

const pick = (body, fields) => {
  const out = {};
  fields.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
  return out;
};

const rx = (s) => new RegExp(String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

const today = () => new Date().toISOString().slice(0, 10);

// The repeat key. Same category + same normalized title ⇒ same signature ⇒ the
// two tickets are treated as occurrences of one recurring problem. Arabic and
// Latin letters/digits are kept, everything else collapses to a single dash, so
// "Printer jam — 2nd floor!!" and "printer jam 2nd floor" match.
const buildSignature = (category, title) => {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${String(category || 'other').toLowerCase()}:${slug}`;
};

const minutesBetween = (fromDateStr, toDate) => {
  if (!fromDateStr) return undefined;
  const a = new Date(`${fromDateStr}T00:00:00Z`).getTime();
  const b = (toDate instanceof Date ? toDate : new Date(toDate)).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.max(0, Math.round((b - a) / 60000));
};

const CLOSED_STATUSES = new Set(['resolved', 'closed']);

const TICKET_EDITABLE = [
  'title', 'category', 'priority', 'status', 'requester', 'requesterName',
  'requesterDepartment', 'assignedTo', 'assignedToName', 'reportedAt',
  'description', 'resolution', 'rootCause', 'preventiveAction',
  'relatedAsset', 'device', 'notes',
];

const CUSTODY_EDITABLE = [
  'employee', 'name', 'type', 'serialNumber', 'brand', 'model', 'condition',
  'value', 'assignedDate', 'notes', 'category', 'specs',
];

const SYSTEM_EDITABLE = [
  'name', 'nameAr', 'type', 'status', 'owner', 'vendor', 'url', 'environment',
  'renewalDate', 'cost', 'costPeriod', 'credentialsNote', 'description', 'notes',
];

// IT hands out everything except vehicles — those belong to the fleet/HR flow.
const IT_CUSTODY_TYPES = ['laptop', 'phone', 'sim', 'access_card', 'tool', 'other'];

const EMP_FIELDS = 'firstName lastName arabicName iqamaNumber employeeNumber department';

// ── Dashboard ───────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  try {
    const to = req.query.to || today();
    const from = req.query.from || new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const inPeriod = { reportedAt: { $gte: from, $lte: to } };

    const [tickets, periodTickets, assets, systems] = await Promise.all([
      ItTicket.find({}).select('status category priority signature title reportedAt resolutionMinutes requesterDepartment ticketNumber createdAt isRecurring').sort({ createdAt: -1 }).limit(5000).lean(),
      ItTicket.find(inPeriod).select('status reportedAt resolvedAt resolutionMinutes').lean(),
      Asset.find({ type: { $ne: 'vehicle' } }).select('status').lean(),
      ItSystem.find({}).select('name nameAr status renewalDate cost costPeriod type').lean(),
    ]);

    const countBy = (rows, key) => {
      const m = new Map();
      rows.forEach((r) => m.set(r[key] || 'other', (m.get(r[key] || 'other') || 0) + 1));
      return Array.from(m, ([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
    };

    const resolvedInPeriod = periodTickets.filter((t) => CLOSED_STATUSES.has(t.status));
    const durations = resolvedInPeriod.map((t) => t.resolutionMinutes).filter((n) => typeof n === 'number');

    // Opened-vs-resolved per day across the window.
    const days = new Map();
    const touch = (d) => { if (!days.has(d)) days.set(d, { date: d, opened: 0, resolved: 0 }); return days.get(d); };
    periodTickets.forEach((t) => { if (t.reportedAt) touch(t.reportedAt).opened += 1; });
    resolvedInPeriod.forEach((t) => {
      const d = t.resolvedAt ? new Date(t.resolvedAt).toISOString().slice(0, 10) : t.reportedAt;
      if (d) touch(d).resolved += 1;
    });
    const timeline = Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Renewals inside the next 60 days (or already overdue).
    const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const renewalsDueSoon = systems
      .filter((s) => s.renewalDate && s.renewalDate <= horizon && s.status !== 'retired')
      .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
      .slice(0, 15);

    const totals = {
      openTickets: tickets.filter((t) => t.status === 'open' || t.status === 'reopened').length,
      inProgress: tickets.filter((t) => t.status === 'in_progress').length,
      resolvedThisPeriod: resolvedInPeriod.length,
      avgResolutionMinutes: durations.length
        ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length)
        : 0,
      ticketsByCategory: countBy(tickets, 'category'),
      ticketsByPriority: countBy(tickets, 'priority'),
      ticketsByStatus: countBy(tickets, 'status'),
      timeline,
      assetsAssigned: assets.filter((a) => a.status === 'assigned').length,
      assetsInStock: assets.filter((a) => a.status === 'returned').length,
      systemsByStatus: countBy(systems, 'status'),
      renewalsDueSoon,
    };

    res.json({
      totals,
      topRecurring: groupRecurring(tickets).slice(0, 6),
      recentTickets: tickets.slice(0, 8),
      range: { from, to },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load IT dashboard' });
  }
};

// ── Tickets ─────────────────────────────────────────────────────────────────

exports.listTickets = async (req, res) => {
  try {
    const { status, category, priority, assignedTo, q, from, to } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (from || to) {
      filter.reportedAt = {};
      if (from) filter.reportedAt.$gte = from;
      if (to) filter.reportedAt.$lte = to;
    }
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ title: r }, { ticketNumber: r }, { description: r }, { requesterName: r }, { device: r }];
    }

    const tickets = await ItTicket.find(filter)
      .populate('requester', EMP_FIELDS)
      .populate('assignedTo', 'firstName lastName')
      .sort({ reportedAt: -1, createdAt: -1 })
      .limit(2000)
      .lean();

    res.json({ tickets });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load tickets' });
  }
};

exports.getTicket = async (req, res) => {
  try {
    const ticket = await ItTicket.findById(req.params.id)
      .populate('requester', EMP_FIELDS)
      .populate('assignedTo', 'firstName lastName')
      .populate('relatedAsset', 'name serialNumber type')
      .lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    // Every other ticket that shares this signature — the problem's repeat
    // history, which is the whole reason the signature exists.
    const siblings = ticket.signature
      ? await ItTicket.find({ signature: ticket.signature, _id: { $ne: ticket._id } })
          .select('ticketNumber title status priority reportedAt resolvedAt resolutionMinutes resolution rootCause requesterName requesterDepartment')
          .sort({ reportedAt: -1 })
          .limit(100)
          .lean()
      : [];

    res.json({ ticket, siblings });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load ticket' });
  }
};

exports.createTicket = async (req, res) => {
  try {
    if (!req.body.title || !String(req.body.title).trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }
    const data = pick(req.body, TICKET_EDITABLE);
    if (!data.reportedAt) data.reportedAt = today();
    data.signature = buildSignature(data.category, data.title);
    data.createdBy = req.user._id;

    // Third strike and it's officially a recurring problem — flag this one AND
    // retro-flag the earlier occurrences so the report catches them all.
    const priorCount = await ItTicket.countDocuments({ signature: data.signature });
    if (priorCount >= 2) {
      data.isRecurring = true;
      await ItTicket.updateMany({ signature: data.signature }, { $set: { isRecurring: true } });
    }

    if (CLOSED_STATUSES.has(data.status)) {
      data.resolvedAt = new Date();
      data.resolutionMinutes = minutesBetween(data.reportedAt, data.resolvedAt);
    }

    const ticket = await ItTicket.create(data);
    emit('it:updated', { type: 'ticket', id: String(ticket._id) });
    res.status(201).json({ ticket });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create ticket' });
  }
};

exports.updateTicket = async (req, res) => {
  try {
    const ticket = await ItTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const wasClosed = CLOSED_STATUSES.has(ticket.status);
    const data = pick(req.body, TICKET_EDITABLE);
    Object.assign(ticket, data);

    // Retitling or recategorising re-points the ticket at a different problem.
    if (data.title !== undefined || data.category !== undefined) {
      ticket.signature = buildSignature(ticket.category, ticket.title);
    }

    const nowClosed = CLOSED_STATUSES.has(ticket.status);
    if (nowClosed && !wasClosed) {
      ticket.resolvedAt = new Date();
      ticket.resolutionMinutes = minutesBetween(ticket.reportedAt, ticket.resolvedAt);
    } else if (!nowClosed && wasClosed) {
      ticket.resolvedAt = undefined;
      ticket.resolutionMinutes = undefined;
    }

    await ticket.save();
    emit('it:updated', { type: 'ticket', id: String(ticket._id) });
    res.json({ ticket });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update ticket' });
  }
};

exports.deleteTicket = async (req, res) => {
  try {
    await ItTicket.findByIdAndDelete(req.params.id);
    emit('it:updated', { type: 'ticket', id: String(req.params.id) });
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete ticket' });
  }
};

// Group tickets into repeat-clusters by signature. Shared by the dashboard's
// "top recurring" panel and the full recurring report.
function groupRecurring(tickets) {
  const groups = new Map();
  tickets.forEach((t) => {
    const sig = t.signature;
    if (!sig) return;
    if (!groups.has(sig)) {
      groups.set(sig, {
        signature: sig,
        sampleTitle: t.title,
        category: t.category,
        count: 0,
        lastReportedAt: null,
        firstReportedAt: null,
        _durations: [],
        _departments: new Set(),
        ticketIds: [],
      });
    }
    const g = groups.get(sig);
    g.count += 1;
    g.ticketIds.push(String(t._id));
    if (t.reportedAt) {
      if (!g.lastReportedAt || t.reportedAt > g.lastReportedAt) g.lastReportedAt = t.reportedAt;
      if (!g.firstReportedAt || t.reportedAt < g.firstReportedAt) g.firstReportedAt = t.reportedAt;
    }
    if (typeof t.resolutionMinutes === 'number') g._durations.push(t.resolutionMinutes);
    if (t.requesterDepartment) g._departments.add(t.requesterDepartment);
  });

  return Array.from(groups.values())
    .filter((g) => g.count >= 2)
    .map((g) => ({
      signature: g.signature,
      sampleTitle: g.sampleTitle,
      category: g.category,
      count: g.count,
      lastReportedAt: g.lastReportedAt,
      firstReportedAt: g.firstReportedAt,
      avgResolutionMinutes: g._durations.length
        ? Math.round(g._durations.reduce((s, n) => s + n, 0) / g._durations.length)
        : 0,
      affectedDepartments: Array.from(g._departments),
      ticketIds: g.ticketIds,
    }))
    .sort((a, b) => b.count - a.count);
}

// The "this problem keeps coming back" report — the signal that a permanent
// root-cause fix is overdue.
exports.getRecurring = async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.from || req.query.to) {
      filter.reportedAt = {};
      if (req.query.from) filter.reportedAt.$gte = req.query.from;
      if (req.query.to) filter.reportedAt.$lte = req.query.to;
    }

    const tickets = await ItTicket.find(filter)
      .select('title category signature reportedAt resolutionMinutes requesterDepartment ticketNumber status priority')
      .limit(5000)
      .lean();

    const groups = groupRecurring(tickets);
    const byId = new Map(tickets.map((t) => [String(t._id), t]));

    res.json({
      groups,
      // Lets the page expand a group without a second round-trip.
      tickets: groups.flatMap((g) => g.ticketIds.map((id) => byId.get(id)).filter(Boolean)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load recurring report' });
  }
};

// ── Custody (العهد) — the SAME Asset collection HR uses ─────────────────────

exports.listCustody = async (req, res) => {
  try {
    const { status, type, employee, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (employee) filter.employee = employee;
    // Vehicles are out of IT's scope unless explicitly asked for.
    if (type) filter.type = type;
    else filter.type = { $in: IT_CUSTODY_TYPES };
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ name: r }, { serialNumber: r }, { brand: r }, { model: r }, { specs: r }];
    }

    const items = await Asset.find(filter)
      .populate('employee', EMP_FIELDS)
      .populate('assignedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load custody items' });
  }
};

exports.createCustody = async (req, res) => {
  try {
    if (!req.body.employee || !req.body.name) {
      return res.status(400).json({ message: 'Employee and name are required' });
    }
    const data = pick(req.body, CUSTODY_EDITABLE);
    if (!data.assignedDate) data.assignedDate = today();
    if (!data.category) data.category = 'IT';
    data.issuedBySection = 'it';
    data.assignedBy = req.user._id;
    data.createdBy = req.user._id;

    const item = await Asset.create(data);
    emitCustody({ type: 'custody', id: String(item._id) });
    res.status(201).json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create custody item' });
  }
};

exports.updateCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    Object.assign(item, pick(req.body, CUSTODY_EDITABLE));
    await item.save();
    emitCustody({ type: 'custody', id: String(item._id) });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update custody item' });
  }
};

// Mirrors hrController.returnAsset — returning custody is the gate that unlocks
// contract termination, so HR screens must see it immediately.
exports.returnCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    item.status = 'returned';
    item.returnedDate = req.body.returnedDate || today();
    if (req.body.returnedCondition) item.returnedCondition = req.body.returnedCondition;
    item.returnedTo = req.user._id;
    await item.save();
    emitCustody({ type: 'custody', id: String(item._id) });
    emit('hr:employee', { id: String(item.employee) });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to return custody item' });
  }
};

exports.deleteCustody = async (req, res) => {
  try {
    await Asset.findByIdAndDelete(req.params.id);
    emitCustody({ type: 'custody', id: String(req.params.id) });
    res.json({ message: 'Custody item deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete custody item' });
  }
};

// Employee picker for the custody modal. /api/hr/employees is restricted to HR
// roles, so IT gets this read-only minimal projection instead.
exports.listEmployees = async (req, res) => {
  try {
    const filter = {};
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ firstName: r }, { lastName: r }, { arabicName: r }, { employeeNumber: r }, { iqamaNumber: r }];
    }
    const employees = await Employee.find(filter)
      .select(EMP_FIELDS)
      .sort({ firstName: 1 })
      .limit(2000)
      .lean();
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load employees' });
  }
};

// ── Systems & services ──────────────────────────────────────────────────────

exports.listSystems = async (req, res) => {
  try {
    const { status, type, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ name: r }, { nameAr: r }, { vendor: r }, { url: r }, { description: r }];
    }
    const systems = await ItSystem.find(filter)
      .populate('owner', 'firstName lastName')
      .sort({ name: 1 })
      .limit(2000)
      .lean();
    res.json({ systems });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load systems' });
  }
};

exports.createSystem = async (req, res) => {
  try {
    if (!req.body.name || !String(req.body.name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const data = pick(req.body, SYSTEM_EDITABLE);
    data.createdBy = req.user._id;
    const system = await ItSystem.create(data);
    emit('it:updated', { type: 'system', id: String(system._id) });
    res.status(201).json({ system });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create system' });
  }
};

exports.updateSystem = async (req, res) => {
  try {
    const system = await ItSystem.findById(req.params.id);
    if (!system) return res.status(404).json({ message: 'System not found' });
    Object.assign(system, pick(req.body, SYSTEM_EDITABLE));
    await system.save();
    emit('it:updated', { type: 'system', id: String(system._id) });
    res.json({ system });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update system' });
  }
};

exports.deleteSystem = async (req, res) => {
  try {
    await ItSystem.findByIdAndDelete(req.params.id);
    emit('it:updated', { type: 'system', id: String(req.params.id) });
    res.json({ message: 'System deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete system' });
  }
};
