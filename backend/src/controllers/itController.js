const mongoose = require('mongoose');
const ItTicket = require('../models/ItTicket');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const ItSystem = require('../models/ItSystem');
// Custody deliberately reuses the HR Asset collection — an IT-issued laptop must
// appear on the employee's HR profile automatically, so there is exactly ONE
// custody collection in the system. /api/hr/* is gated to HR roles, which is the
// only reason these IT-facing endpoints exist at all.
const Asset = require('../models/Asset');
const Employee = require('../models/Employee');
const User = require('../models/User');
const AssetEvent = require('../models/AssetEvent');
const {
  BUCKETS, BUCKET_KEYS, EXCLUDED_TYPES, bucketOf, typesInBucket,
  deriveAssetName, normalizeBrand, RETIRED_TYPES, retiredTypeError,
} = require('../config/itCustody');
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

// The company runs on Riyadh time (UTC+3). Using the UTC date put anything after 9 pm on the previous day, so custody showed delivered a day early and a report showed open before it was reported.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const dateInRiyadh = (t) => new Date(new Date(t).getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);

const today = () => dateInRiyadh(Date.now());

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

/**
 * Resolution time in whole days between the report day and the resolution day.
 * The report date has no time of day, so minute precision is not available from the source; whole days are the honest unit and avoid UTC-midnight skew against Riyadh working hours.
 */
const daysBetweenDates = (fromDateStr, toDateStr) => {
  if (!fromDateStr || !toDateStr) return undefined;
  const a = Date.parse(`${fromDateStr}T00:00:00Z`);
  const b = Date.parse(`${toDateStr}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.max(0, Math.round((b - a) / 86400000));
};

// Storage stays in minutes because the dashboard and the recurrence report average from it, but the value is always a whole-day multiple.
const resolutionMinutesOf = (reportedAt, resolvedDate) => {
  const d = daysBetweenDates(reportedAt, resolvedDate);
  return d === undefined ? undefined : d * 1440;
};

const CLOSED_STATUSES = new Set(['resolved', 'closed']);

// Roles a report may be assigned to. Matches the permission list in routes/it.js: assigning to someone who cannot edit it leaves nobody able to close it.
const EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist'];

const TICKET_EDITABLE = [
  'title', 'category', 'priority', 'status', 'requester', 'requesterName',
  'requesterDepartment', 'assignedTo', 'assignedToName', 'reportedAt', 'resolvedDate',
  'description', 'resolution', 'rootCause', 'preventiveAction',
  'relatedAsset', 'device', 'notes',
];


// Append to an item's movement log. Never throws into the caller: a failed log
// line must not roll back a handover that physically already happened — but it
// is logged loudly, because a gap in the trail is a real problem.
const logEvent = async (req, asset, action, extra = {}) => {
  try {
    await AssetEvent.create({
      asset: asset._id,
      action,
      date: extra.date || today(),
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      section: 'it',
      ...extra,
    });
  } catch (e) {
    console.error('[custody] failed to log', action, 'for', String(asset._id), e.message);
  }
};

// `name` is deliberately omitted: it is derived from type and brand in the controller. Accepting it from the request would reopen free-text names (many spellings per item).
const CUSTODY_EDITABLE = [
  'employee', 'type', 'serialNumber', 'brand', 'condition',
  'value', 'assignedDate', 'notes', 'category', 'specs', 'quantity',
  // Who holds the device when not an employee; the name is stored as text.
  'holderName', 'holderKind',
  // Mobile line details, see models/Asset.telecom. Accepted as one whole object because it is edited in a single form.
  'telecom',
];

// Stock items have no employee and no assignedDate - they gain both the moment they are handed out via assignFromStock.
// Name is derived, not entered, as in custody. Model and location are dropped because they were mostly left empty, giving two empty columns in every report.
const STOCK_EDITABLE = [
  'type', 'serialNumber', 'brand', 'condition', 'value',
  'notes', 'category', 'specs', 'quantity',
];

const SYSTEM_EDITABLE = [
  'name', 'nameAr', 'type', 'status', 'owner', 'vendor', 'url', 'environment',
  'renewalDate', 'cost', 'costPeriod', 'credentialsNote', 'description', 'notes',
];

// Types this department hands out: everything the five buckets know. Vehicles belong to the fleet, `tool` to HR custody, and SIM lines are not ours; all three are excluded from one source in config/itCustody.
const IT_CUSTODY_TYPES = BUCKETS
  .flatMap((b) => b.types)
  .filter((t) => !EXCLUDED_TYPES.includes(t));

// Query that excludes what does not belong to the department. Used by every asset read so card counts match table counts. Items issued by another section (HR, phone lines) are tagged with `issuedBySection` and are not IT custody even if of a tech type.
const OTHER_SECTIONS = ['hr', 'telecom'];
const NOT_EXCLUDED = { type: { $nin: EXCLUDED_TYPES }, issuedBySection: { $nin: OTHER_SECTIONS } };

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
      Asset.find(NOT_EXCLUDED).select('status type quantity condition value').lean(),
      ItSystem.find({}).select('name nameAr status renewalDate cost costPeriod type').lean(),
    ]);

    // One row can represent several identical units (cables, chargers), so count units, not rows.
    const units = (a) => Math.max(1, Number(a.quantity) || 1);

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

    // Warehouse view. A consumable row can stand for many units, so stock is
    // counted in units (quantity) rather than documents — 1 row of 20 cables is
    // 20 cables, and the low-stock warning has to know that.
    const stockItems = assets.filter((a) => a.status === 'in_stock');
    const stockCount = stockItems.reduce((s, a) => s + units(a), 0);

    const stockMap = new Map();
    stockItems.forEach((a) => {
      const k = a.type || 'other';
      stockMap.set(k, (stockMap.get(k) || 0) + units(a));
    });
    const stockByType = Array.from(stockMap, ([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    // "We're about to run out" — any IT type with fewer than 3 units on the
    // shelf, including the types that have hit zero and so never appear above.
    const LOW_STOCK_THRESHOLD = 3;
    // A cancelled type is neither bought nor stocked, so no shortage alert for it.
    const lowStock = IT_CUSTODY_TYPES
      .filter((key) => !RETIRED_TYPES[key])
      .map((key) => ({ key, count: stockMap.get(key) || 0 }))
      .filter((r) => r.count < LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.count - b.count);

    // Custody summary: the same cards and buttons shown on the custody page.
    // The dashboard reads the same aggregation as the page so one figure never differs between two screens.
    const custodyBuckets = BUCKETS.map((b) => ({ key: b.key, nameAr: b.nameAr, nameEn: b.nameEn, count: 0 }));
    const bucketIndex = new Map(custodyBuckets.map((b) => [b.key, b]));
    const custodyByStatus = { assigned: 0, in_stock: 0, returned: 0 };
    const conditionMap = new Map();
    const otherKindMap = new Map();

    assets.forEach((a) => {
      const n = units(a);
      const b = bucketIndex.get(bucketOf(a.type));
      if (b) b.count += n;
      if (custodyByStatus[a.status] !== undefined) custodyByStatus[a.status] += n;
      const c = a.condition || 'good';
      conditionMap.set(c, (conditionMap.get(c) || 0) + n);
      // Breakdown of the 'other' bucket: the second filter shows only types actually present, so the user cannot pick a filter that returns zero.
      if (bucketOf(a.type) === 'other') otherKindMap.set(a.type, (otherKindMap.get(a.type) || 0) + n);
    });

    const sortedCount = (m) => Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

    const custody = {
      buckets: custodyBuckets,
      byStatus: custodyByStatus,
      byCondition: sortedCount(conditionMap),
      otherKinds: sortedCount(otherKindMap),
      total: custodyBuckets.reduce((s2, b) => s2 + b.count, 0),
    };

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
      // Kept for the existing dashboard card: retired / out-of-circulation gear.
      assetsInStock: assets.filter((a) => a.status === 'returned').length,
      stockCount,
      stockByType,
      lowStock,
      systemsByStatus: countBy(systems, 'status'),
      renewalsDueSoon,
    };

    res.json({
      totals,
      custody,
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
      // The resolution day is user-entered; the save time is not the repair time, and most reports are logged days after closing.
      if (!data.resolvedDate) data.resolvedDate = today();
      data.resolvedAt = new Date(`${data.resolvedDate}T00:00:00Z`);
      data.resolutionMinutes = resolutionMinutesOf(data.reportedAt, data.resolvedDate);
    }

    const ticket = await ItTicket.create(data);
    await require('../services/itTicketJp').fromTicket(ticket._id, req.user._id);
    emit('it:updated', { type: 'ticket', id: String(ticket._id) });
    res.status(201).json({ ticket });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create ticket');
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
    if (nowClosed) {
      // Recomputed on every save of a closed report, not only the first close: correcting the date of an already closed report used to leave a stale resolution time.
      if (!ticket.resolvedDate) ticket.resolvedDate = today();
      ticket.resolvedAt = new Date(`${ticket.resolvedDate}T00:00:00Z`);
      ticket.resolutionMinutes = resolutionMinutesOf(ticket.reportedAt, ticket.resolvedDate);
    } else if (!nowClosed && wasClosed) {
      ticket.resolvedDate = undefined;
      ticket.resolvedAt = undefined;
      ticket.resolutionMinutes = undefined;
    }

    await ticket.save();
    await require('../services/itTicketJp').fromTicket(ticket._id, req.user._id);
    emit('it:updated', { type: 'ticket', id: String(ticket._id) });
    res.json({ ticket });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update ticket');
  }
};

exports.deleteTicket = async (req, res) => {
  try {
    const gone = await ItTicket.findByIdAndDelete(req.params.id);
    await require('../services/itTicketJp').ticketDeleted(gone);
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

// Custody - the SAME Asset collection HR uses

// Fold Arabic letter variants before comparing (alef/hamza forms, ta marbuta vs ha). Without it a search by the name as typed misses a row saved with another spelling, and the item gets entered twice.
const fold = (s) => String(s || '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .toLowerCase()
  .trim();

// Search text. The employee name is included because the usual question is who holds a device, not the device name; the screen used to search on that alone before search moved to the server.
const custodyHaystack = (a) => fold([
  a.name, a.serialNumber, a.brand, a.model, a.specs,
  a.employee && [a.employee.firstName, a.employee.lastName, a.employee.arabicName, a.employee.employeeNumber]
    .filter(Boolean).join(' '),
].filter(Boolean).join(' '));

/**
 * GET /custody - displayed rows, card counts and buttons in one response.
 * Counts used to be computed in the screen over the whole register while the table was filtered, so a card could disagree with the rows beneath it.
 * Everything now derives from one definition: matchers are built once and both rows and counts come from them, so a count is the size of the set the click opens.
 * Each count applies all filters except its own dimension; otherwise picking one card would zero the other four. Same shape as hrMasterController.filterOptions.
 */
exports.listCustody = async (req, res) => {
  try {
    const { status, type, bucket, otherType, condition, employee, q, scope } = req.query;

    // Read once without the UI filters, then filter and count in memory: the register is a few hundred rows, and separating filtering from the query guarantees counts and rows come from the same matchers.
    // `scope=all` includes the warehouse because the warehouse button and each category card count stock too.
    const base = { type: { $in: IT_CUSTODY_TYPES }, issuedBySection: { $nin: OTHER_SECTIONS } };
    if (scope !== 'all') base.status = { $ne: 'in_stock' };
    if (employee) base.employee = employee;

    const runQuery = () => Asset.find(base)
      .populate('employee', EMP_FIELDS)
      .populate('assignedBy', 'firstName lastName')
      // Who recorded the return (set from the acting user on every return path).
      .populate('returnedTo', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    // The key carries no UI filters: the cached value is the raw register and filtering runs on top per request. Asset writes invalidate the 'it:custody' prefix via hooks.
    const cache = require('../utils/ttlCache');
    const rawRows = await cache.wrap(`it:custody:rows:${scope || ''}:${employee || ''}`, 20000, runQuery);
    // Custody of an archived employee is neither shown nor counted, as if deleted; custody of a specific file (from the archive) is kept.
    const { endedStaff, employeeArchived } = require('../utils/endedStaff');
    const archSets = employee ? null : await endedStaff();
    const rows = archSets ? rawRows.filter((a) => !employeeArchived(archSets, a.employee)) : rawRows;

    const wantedBucket = BUCKET_KEYS.includes(bucket) ? bucket : '';
    // `otherType` is the second filter inside 'other'; `type` stays accepted because old dashboard links use it.
    const exactType = String(otherType || type || '').trim();
    const needle = fold(q);

    // One matcher per dimension; each count's exclusion of its own filter is built on them.
    const byCat = (a) => (!wantedBucket || bucketOf(a.type) === wantedBucket)
      && (!exactType || a.type === exactType);
    const byState = (a) => !status || a.status === status;
    const byCondition = (a) => !condition || a.condition === condition;
    const bySearch = (a) => !needle || custodyHaystack(a).includes(needle);

    const items = rows.filter((a) => byCat(a) && byState(a) && byCondition(a) && bySearch(a));

    const tally = (pred) => rows.reduce((n, a) => n + (pred(a) ? 1 : 0), 0);

    // Five category cards: all filters except category.
    const buckets = BUCKETS.map((b) => ({
      key: b.key,
      nameAr: b.nameAr,
      nameEn: b.nameEn,
      count: tally((a) => byState(a) && byCondition(a) && bySearch(a) && bucketOf(a.type) === b.key),
    }));

    // Three state buttons: all filters except state.
    // 'Sold' is counted like the others: the filter button reads this counter and without a key it would stay zero however much is sold. See CUSTODY_STATE_KEYS.
    const byStatus = { assigned: 0, in_stock: 0, returned: 0, sold: 0 };
    rows.forEach((a) => {
      if (byCat(a) && byCondition(a) && bySearch(a) && byStatus[a.status] !== undefined) byStatus[a.status] += 1;
    });

    // 'Other' breakdown: all filters except the detailed type, within the bucket only.
    const kindMap = new Map();
    rows.forEach((a) => {
      if (bucketOf(a.type) !== 'other') return;
      if (!byState(a) || !byCondition(a) || !bySearch(a)) return;
      kindMap.set(a.type, (kindMap.get(a.type) || 0) + 1);
    });
    // The selected type stays visible even at zero after another filter; hiding it while active would leave an empty list with no way to clear the filter.
    if (exactType && bucketOf(exactType) === 'other' && !kindMap.has(exactType)) kindMap.set(exactType, 0);
    const otherKinds = typesInBucket('other')
      .filter((t) => kindMap.has(t))
      .map((t) => ({ key: t, count: kindMap.get(t) }));

    // Technical condition counts: all filters except condition.
    const condMap = new Map();
    rows.forEach((a) => {
      if (!byCat(a) || !byState(a) || !bySearch(a)) return;
      const c = a.condition || 'good';
      condMap.set(c, (condMap.get(c) || 0) + 1);
    });
    if (condition && !condMap.has(condition)) condMap.set(condition, 0);
    const conditions = Array.from(condMap, ([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count);

    res.json({
      items,
      counts: {
        buckets,
        byStatus,
        otherKinds,
        conditions,
        // 'Currently shown' and its value both describe the table beneath, not the whole register.
        total: items.length,
        value: items.reduce((s, a) => s + (Number(a.value) || 0), 0),
      },
      // The register total stays shown beside the filtered number to show what it was cut from, not to replace it.
      register: {
        total: rows.length,
        assigned: rows.filter((a) => a.status === 'assigned').length,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load custody items' });
  }
};

exports.createCustody = async (req, res) => {
  try {
    // Handed to an employee or a named person.
    // Employee used to be required, but devices sometimes go to someone outside the company, who then had to be created as an HR employee; that put a company name in the employee register and left custody orphaned on deletion.
    const holderName = String(req.body.holderName || '').trim();
    if (!req.body.employee && !holderName) {
      return res.status(400).json({ message: 'اختر الموظّف، أو اكتب اسم من استلمه إن لم يكن موظّفًا.' });
    }
    const retired = retiredTypeError(req.body.type);
    if (retired) return res.status(400).json({ message: retired });
    const data = pick(req.body, CUSTODY_EDITABLE);
    data.holderKind = req.body.employee ? 'employee' : 'external';
    if (!req.body.employee) data.employee = null;
    // The name is no longer typed; it is derived from type and brand exactly as in the warehouse, so an item gets one name whoever enters it and from whichever screen.
    data.brand = normalizeBrand(data.brand);
    data.name = deriveAssetName(data.type, data.brand);
    if (!data.assignedDate) data.assignedDate = today();
    if (!data.category) data.category = 'IT';
    if (data.quantity === undefined || Number(data.quantity) < 1) data.quantity = 1;
    data.issuedBySection = 'it';
    data.assignedBy = req.user._id;
    data.createdBy = req.user._id;

    const item = await Asset.create(data);
    // A device handed out directly, bypassing the shelf, must be recorded the same way: without an intake entry the item's history starts at hand-over and never shows it entered company ownership.
    await logEvent(req, item, 'added_to_store', { condition: item.condition, date: item.assignedDate });
    await logEvent(req, item, 'assigned', { toEmployee: item.employee, date: item.assignedDate, condition: item.condition });
    emitCustody({ type: 'custody', id: String(item._id) });
    res.status(201).json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create custody item');
  }
};

exports.updateCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    const retired = retiredTypeError(req.body.type, item.type);
    if (retired) return res.status(400).json({ message: retired });
    Object.assign(item, pick(req.body, CUSTODY_EDITABLE));
    // The name is derived, so any change of type or brand must update it; otherwise an item that became a Dell monitor would still show its original laptop name.
    item.brand = normalizeBrand(item.brand);
    item.name = deriveAssetName(item.type, item.brand);
    await item.save();
    emitCustody({ type: 'custody', id: String(item._id) });
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update custody item');
  }
};

// Mirrors hrController.returnAsset — returning custody is the gate that unlocks
// contract termination, so HR screens must see it immediately.
//
// A returned device normally goes back on the shelf and gets handed to the next
// person, so the default lands it in stock rather than retiring it. Pass
// `{ retire: true }` for gear that is genuinely out of circulation (dead,
// written off, sold) — that keeps the old `status: 'returned'` terminal state.
exports.returnCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });

    // Captured before we clear it — HR's employee screen needs the refresh.
    const previousEmployee = item.employee ? String(item.employee) : null;

    item.returnedDate = req.body.returnedDate || today();
    if (req.body.returnedCondition) {
      item.returnedCondition = req.body.returnedCondition;
      // The condition it came back in is the condition it now sits in.
      item.condition = req.body.returnedCondition;
    }
    item.returnedTo = req.user._id;

    if (req.body.retire) {
      item.status = 'returned';
    } else {
      item.status = 'in_stock';
      item.employee = null;
      item.assignedDate = undefined;
      if (req.body.location !== undefined) item.location = req.body.location;
    }

    await item.save();
    await logEvent(req, item, req.body.retire ? 'retired' : 'returned', {
      fromEmployee: previousEmployee,
      date: item.returnedDate,
      condition: item.returnedCondition || item.condition,
      notes: req.body.notes,
    });
    emitCustody({ type: 'custody', id: String(item._id) });
    if (previousEmployee) emit('hr:employee', { id: previousEmployee });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to return custody item' });
  }
};

// ── Custody movements: transfer, report, retire, batch handover ─────────────
// A device's life is one Asset document plus an AssetEvent trail. Each endpoint
// below moves the document and appends the matching event, so "who had this and
// when" is always answerable.

// Employee → employee, without a trip through the store. The receiving side is
// validated first: half a transfer is worse than none.
exports.transferCustody = async (req, res) => {
  try {
    const { toEmployee, date, condition, notes } = req.body;
    if (!toEmployee) return res.status(400).json({ message: 'Receiving employee is required' });

    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    if (item.status !== 'assigned') {
      return res.status(400).json({ message: 'Only an item currently held by an employee can be transferred' });
    }
    if (String(item.employee) === String(toEmployee)) {
      return res.status(400).json({ message: 'The item is already held by that employee' });
    }

    const receiver = await Employee.findById(toEmployee).select('_id user').lean();
    if (!receiver) return res.status(404).json({ message: 'Receiving employee not found' });

    const fromEmployee = item.employee;
    item.employee = receiver._id;
    item.assignedDate = date || today();
    item.assignedBy = req.user._id;
    if (condition) item.condition = condition;
    await item.save();

    await logEvent(req, item, 'transferred', { fromEmployee, toEmployee: receiver._id, date, condition, notes });

    emitCustody({ type: 'custody', id: String(item._id) });
    // Both profiles changed — the giver lost an item, the receiver gained one.
    if (fromEmployee) emit('hr:employee', { id: String(fromEmployee) });
    emit('hr:employee', { id: String(receiver._id) });
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to transfer custody item');
  }
};

// Faulty: one action, not two.
// The screen had two buttons that did the same thing to the user: 'report faulty' wrote a report with reason and deduction but left the item in the employee's custody, and 'convert to faulty' changed the state without reason or deduction.
// They are now one action that writes the report with reason and deduction and moves the item to faulty.
// The employee stays recorded on the item on purpose (history must say who held it when it broke) but is no longer charged, because all HR gates (termination, clearance, custody inventory) check `status: 'assigned'` only.
exports.markFaulty = async (req, res) => {
  try {
    // A report without a type reads as faulty: the old /retire path was called with an empty body and installed mobile builds still call it.
    const kind = req.body.kind || 'damaged';
    const { notes, cost, date } = req.body;
    if (!['damaged', 'lost'].includes(kind)) {
      return res.status(400).json({ message: 'kind must be "damaged" or "lost"' });
    }

    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    if (item.status === 'returned') {
      return res.status(400).json({ message: 'This item is already out of service' });
    }

    const holder = item.employee ? String(item.employee) : null;

    // Faulty items stop being described as good. A lost item keeps its technical condition: it did not break, it vanished.
    if (kind === 'damaged') item.condition = 'damaged';
    item.status = 'returned';
    item.returnedDate = date || today();
    item.returnedCondition = item.condition;
    item.returnedTo = req.user._id;
    await item.save();

    await logEvent(req, item, kind, {
      fromEmployee: holder,
      date: item.returnedDate,
      condition: item.condition,
      cost: Number(cost) || 0,
      notes,
    });

    emitCustody({ type: 'custody', id: String(item._id) });
    if (holder) emit('hr:employee', { id: holder });
    res.json({ item });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record the item as faulty' });
  }
};

// The two old paths are now names for one handler: separate implementations are what produced two buttons for one thing, and removing one would break installed mobile builds.
exports.reportCustody = exports.markFaulty;
exports.retireCustody = exports.markFaulty;

// The handover desk: an employee walks in with some of their gear. Pick what
// they actually handed back; whatever is not ticked stays on them, and the
// response says exactly what is still outstanding.
/**
 * Selling a custody item: it leaves stock and custody, and the row records to whom, for how much and when. Recording a sale as delivered would keep it counted as owned; deleting the row would lose where it went.
 * POST /api/it/custody/:id/sell
 * { employee?, buyerName?, price?, date?, notes? }
 */
exports.sellCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    if (item.status === 'sold') return res.status(400).json({ message: 'هذا الصنف مُباعٌ بالفعل.' });

    const buyerName = String(req.body.buyerName || '').trim();
    if (!req.body.employee && !buyerName) {
      return res.status(400).json({ message: 'اختر الموظّف المشتري، أو اكتب اسم المشتري الخارجيّ.' });
    }

    const previousEmployee = item.employee ? String(item.employee) : null;
    item.status = 'sold';
    item.soldTo = req.body.employee || null;
    item.soldToName = req.body.employee ? '' : buyerName;
    item.soldDate = req.body.date || today();
    item.soldPrice = Number(req.body.price) || 0;
    // A sold item is held by nobody, otherwise it would block termination of whoever held it.
    item.employee = null;
    item.holderKind = '';
    item.holderName = '';
    if (req.body.notes) item.notes = req.body.notes;
    await item.save();

    await logEvent(req, item, 'sold', {
      toEmployee: item.soldTo, buyerName: item.soldToName,
      price: item.soldPrice, date: item.soldDate,
    });
    emitCustody({ type: 'custody', id: String(item._id), employee: previousEmployee });
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تسجيل البيع');
  }
};

/**
 * Returning a sold item to stock: the sale is cancelled and the price refunded. The same row returns to the shelf with its full history (the sale, then a sale-return event with the refund), keeping serial and history.
 * POST /api/it/custody/:id/unsell
 * { date?, refund?, condition?, location?, notes? }
 */
exports.unsellCustody = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Custody item not found' });
    if (item.status !== 'sold') return res.status(400).json({ message: 'هذا الصنف غير مُباع.' });

    const buyer = item.soldTo ? String(item.soldTo) : null;
    const buyerName = item.soldToName || '';
    const refund = req.body.refund !== undefined && req.body.refund !== ''
      ? Number(req.body.refund) || 0
      : Number(item.soldPrice) || 0;
    const date = req.body.date || today();

    item.status = 'in_stock';
    item.employee = null;
    item.holderKind = '';
    item.holderName = '';
    item.assignedDate = undefined;
    // The sale details are cleared from the row (the row shows current state) but stay in the log.
    item.soldTo = null;
    item.soldToName = '';
    item.soldDate = undefined;
    item.soldPrice = 0;
    if (req.body.condition) item.condition = req.body.condition;
    if (req.body.location !== undefined) item.location = req.body.location;
    item.returnedDate = date;
    item.returnedTo = req.user._id;
    await item.save();

    await logEvent(req, item, 'sale_returned', {
      fromEmployee: buyer, buyerName, price: refund, date,
      condition: item.condition, notes: req.body.notes,
    });
    emitCustody({ type: 'custody', id: String(item._id), employee: buyer });
    if (buyer) emit('hr:employee', { id: buyer });
    res.json({ item, refund });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إرجاع الصنف المُباع');
  }
};

exports.handoverCustody = async (req, res) => {
  try {
    // An item has three outcomes, not two.
    // On hand-back the item used to return to the shelf or be recorded faulty. A third happens: the employee buys it and pays accounts, which was recorded as delivered and kept it counted as owned.
    // `outcome` selects: `stock` (default, previous behaviour), `faulty` (the old `retire`, still accepted so existing calls do not break), or `sold`. A sale writes what sellCustody writes, so the logs agree.
    const {
      employee, items, date, condition, notes, retire, outcome, price,
    } = req.body;
    const fate = outcome || (retire ? 'faulty' : 'stock');
    if (!employee) return res.status(400).json({ message: 'Employee is required' });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'Select at least one item that was handed back' });
    }

    // Scoped to this employee's own assigned items, so a stray id in the list
    // can never return someone else's device.
    const held = await Asset.find({ _id: { $in: items }, employee, status: 'assigned' });
    if (!held.length) return res.status(404).json({ message: 'None of those items are currently held by this employee' });

    for (const item of held) {
      item.returnedDate = date || today();
      item.returnedTo = req.user._id;
      if (condition) {
        item.returnedCondition = condition;
        item.condition = condition;
      }
      if (fate === 'faulty') {
        item.status = 'returned';
      } else if (fate === 'sold') {
        // The buyer is the returner: this is the hand-back path and whoever buys what is in their hand owns it. It stays in nobody's custody and not on the shelf.
        item.status = 'sold';
        item.soldTo = employee;
        item.soldToName = '';
        item.soldDate = date || today();
        item.soldPrice = Number(price) || 0;
        item.employee = null;
        item.holderKind = '';
        item.holderName = '';
        item.assignedDate = undefined;
      } else {
        item.status = 'in_stock';
        item.employee = null;
        item.assignedDate = undefined;
      }
      if (notes) item.notes = notes;
      await item.save();
      await logEvent(req, item, fate === 'faulty' ? 'retired' : fate === 'sold' ? 'sold' : 'returned', {
        fromEmployee: employee, date, condition, notes,
        ...(fate === 'sold' ? { toEmployee: employee, price: item.soldPrice } : {}),
      });
      emitCustody({ type: 'custody', id: String(item._id) });
    }

    const outstanding = await Asset.find({ employee, status: 'assigned' })
      .select('name type serialNumber brand model assignedDate')
      .lean();

    emit('hr:employee', { id: String(employee) });
    res.json({ returned: held.length, outcome: fate, outstanding });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record the handover' });
  }
};

// Everything an employee holds right now plus what they have already handed
// back — the two halves of the handover screen.
exports.custodyByEmployee = async (req, res) => {
  try {
    const employee = req.params.employeeId;
    const [assigned, history] = await Promise.all([
      Asset.find({ employee, status: 'assigned' }).sort({ assignedDate: -1 }).lean(),
      AssetEvent.find({ $or: [{ fromEmployee: employee }, { toEmployee: employee }] })
        .populate('asset', 'name type serialNumber brand model')
        .populate('fromEmployee toEmployee', EMP_FIELDS)
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);
    res.json({ assigned, history });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the employee custody record' });
  }
};

/**
 * GET /api/it/custody/events — every custody movement in one searchable log.
 * Filters: from, to (YYYY-MM-DD, the day it happened), action, by (the user who
 * recorded it), employee (giver or receiver), q (item name/serial, people, notes).
 * Also returns the filter options (actions in use, people who recorded movements).
 */
exports.custodyEvents = async (req, res) => {
  try {
    const q = req.query || {};
    const f = { section: { $ne: 'hr' } };
    const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    if (ymd(q.from) || ymd(q.to)) f.date = { ...(ymd(q.from) ? { $gte: ymd(q.from) } : {}), ...(ymd(q.to) ? { $lte: ymd(q.to) } : {}) };
    if (q.action) f.action = { $in: String(q.action).split(',').filter(Boolean) };
    if (mongoose.isValidObjectId(q.by)) f.by = q.by;
    if (mongoose.isValidObjectId(q.employee)) f.$or = [{ fromEmployee: q.employee }, { toEmployee: q.employee }];
    const rows = await AssetEvent.find(f)
      .populate('asset', 'name type serialNumber brand model category')
      .populate('fromEmployee toEmployee', EMP_FIELDS)
      .sort({ date: -1, createdAt: -1 })
      .limit(Math.min(Number(q.limit) || 3000, 10000))
      .lean();
    const empName = (e) => (e ? (e.arabicName || [e.firstName, e.lastName].filter(Boolean).join(' ')) : '');
    let events = rows.map((e) => ({
      _id: e._id, date: e.date || (e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : ''), at: e.createdAt,
      action: e.action, condition: e.condition || '', notes: e.notes || '', price: e.price || 0, cost: e.cost || 0, buyerName: e.buyerName || '',
      asset: e.asset ? { _id: e.asset._id, name: e.asset.name, serialNumber: e.asset.serialNumber || '', type: e.asset.type || '', category: e.asset.category || '' } : null,
      from: e.fromEmployee ? { _id: e.fromEmployee._id, name: empName(e.fromEmployee), employeeNumber: e.fromEmployee.employeeNumber || '' } : null,
      to: e.toEmployee ? { _id: e.toEmployee._id, name: empName(e.toEmployee), employeeNumber: e.toEmployee.employeeNumber || '' } : null,
      by: e.by ? String(e.by) : '', byName: e.byName || '',
    }));
    if (q.q && String(q.q).trim()) {
      const fold = (v) => String(v || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
      const t = fold(String(q.q).trim());
      events = events.filter((e) => fold([e.asset?.name, e.asset?.serialNumber, e.from?.name, e.from?.employeeNumber, e.to?.name, e.to?.employeeNumber, e.byName, e.notes, e.buyerName].join(' ')).includes(t));
    }
    // Filter options from the whole log (not the filtered page).
    const [actions, doers] = await Promise.all([
      AssetEvent.distinct('action', { section: { $ne: 'hr' } }),
      AssetEvent.aggregate([{ $match: { section: { $ne: 'hr' }, by: { $ne: null } } }, { $group: { _id: '$by', name: { $last: '$byName' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    ]);
    res.json({ events, total: events.length, actions, doers: doers.map((d) => ({ _id: String(d._id), name: d.name || '—', count: d.n })) });
  } catch (error) {
    console.error('custodyEvents error:', error);
    res.status(500).json({ message: 'Failed to load the custody log' });
  }
};

// One item's full timeline.
exports.custodyHistory = async (req, res) => {
  try {
    const events = await AssetEvent.find({ asset: req.params.id })
      .populate('fromEmployee toEmployee', EMP_FIELDS)
      .populate('by', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ events });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load the item history' });
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

// Stock - same Asset collection, held by nobody
// One document per physical device for its whole life: it moves between `in_stock` and `assigned` so its serial and history never fragment across two collections. HR only ever sees the `assigned`/`returned` half.

exports.listStock = async (req, res) => {
  try {
    const { type, q, condition } = req.query;
    // HR keeps its own shelf in this collection (`issuedBySection: 'hr'`) — it
    // is a different store and must not show up here. Legacy stock with no flag
    // set stays with IT, which is where it has always been.
    const filter = { status: 'in_stock', issuedBySection: { $ne: 'hr' }, ...NOT_EXCLUDED };
    if (type) filter.type = type;
    else if (req.query.bucket && BUCKET_KEYS.includes(req.query.bucket)) {
      filter.type = { $in: typesInBucket(req.query.bucket).filter((t) => !EXCLUDED_TYPES.includes(t)) };
    }
    if (condition) filter.condition = condition;
    if (q && q.trim()) {
      const r = rx(q);
      filter.$or = [{ name: r }, { serialNumber: r }, { brand: r }, { specs: r }];
    }

    const items = await Asset.find(filter)
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load stock items' });
  }
};

exports.createStock = async (req, res) => {
  try {
    if (!req.body.type || !String(req.body.type).trim()) {
      return res.status(400).json({ message: 'Item type is required' });
    }
    const retired = retiredTypeError(req.body.type);
    if (retired) return res.status(400).json({ message: retired });
    const data = pick(req.body, STOCK_EDITABLE);
    data.brand = normalizeBrand(data.brand);
    data.name = deriveAssetName(data.type, data.brand);
    if (!data.category) data.category = 'IT';
    if (data.quantity === undefined || Number(data.quantity) < 1) data.quantity = 1;
    data.status = 'in_stock';
    data.employee = null;
    data.issuedBySection = 'it';
    data.createdBy = req.user._id;

    const item = await Asset.create(data);
    await logEvent(req, item, 'added_to_store', { condition: item.condition });
    emitCustody({ type: 'stock', id: String(item._id) });
    res.status(201).json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to create stock item');
  }
};

exports.updateStock = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    if (item.status !== 'in_stock') {
      return res.status(400).json({ message: 'This item is no longer in stock — edit it from the custody page instead' });
    }
    const retired = retiredTypeError(req.body.type, item.type);
    if (retired) return res.status(400).json({ message: retired });
    Object.assign(item, pick(req.body, STOCK_EDITABLE));
    item.brand = normalizeBrand(item.brand);
    item.name = deriveAssetName(item.type, item.brand);
    await item.save();
    emitCustody({ type: 'stock', id: String(item._id) });
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to update stock item');
  }
};

exports.deleteStock = async (req, res) => {
  try {
    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    // Deleting an assigned item here would silently wipe an employee's custody
    // record, so this endpoint only ever touches shelf stock.
    if (item.status !== 'in_stock') {
      return res.status(400).json({ message: 'Only in-stock items can be deleted here' });
    }
    await Asset.findByIdAndDelete(req.params.id);
    emitCustody({ type: 'stock', id: String(req.params.id) });
    res.json({ message: 'Stock item deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete stock item' });
  }
};

// The handover: in_stock → assigned. Same document, so the device keeps its
// serial and its history, and it appears on the employee's HR profile at once.
exports.assignFromStock = async (req, res) => {
  try {
    if (!req.body.employee) return res.status(400).json({ message: 'Employee is required' });

    const item = await Asset.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    if (item.status !== 'in_stock') {
      return res.status(400).json({
        message: item.status === 'assigned'
          ? 'This item is already assigned to an employee'
          : 'This item is not in stock and cannot be assigned',
      });
    }

    const employee = await Employee.findById(req.body.employee).select('_id').lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    item.employee = employee._id;
    item.status = 'assigned';
    item.assignedDate = req.body.assignedDate || today();
    item.assignedBy = req.user._id;
    // Technical condition is not asked on hand-out from stock: the item already carries it from when it was added, and asking again allows two truths for one thing.
    if (req.body.notes) item.notes = req.body.notes;
    // The item has left the shelf — clear the leftovers from its last return.
    item.returnedDate = undefined;
    item.returnedCondition = undefined;
    item.returnedTo = undefined;

    await item.save();
    await logEvent(req, item, 'assigned', {
      toEmployee: item.employee, date: item.assignedDate, condition: item.condition, notes: req.body.notes,
    });
    emitCustody({ type: 'custody', id: String(item._id) });
    emit('hr:employee', { id: String(item.employee) });
    res.json({ item });
  } catch (error) {
    return sendMongooseError(res, error, 'Failed to assign stock item');
  }
};

// Employee picker for the custody modal. /api/hr/employees is restricted to HR
// roles, so IT gets this read-only minimal projection instead.
exports.listEmployees = async (req, res) => {
  try {
    const filter = { isHrRecord: { $ne: false } };   // Excluding archive records.
    if (req.query.q && req.query.q.trim()) {
      const r = rx(req.query.q);
      filter.$or = [{ firstName: r }, { lastName: r }, { arabicName: r }, { employeeNumber: r }, { iqamaNumber: r }];
    }
    // An archived employee cannot be given custody or be selected, as if deleted.
    const employees = await Employee.find(require('../utils/hrEngagement').withoutArchived(filter))
      .select(EMP_FIELDS)
      .sort({ firstName: 1 })
      .limit(2000)
      .lean();
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load employees' });
  }
};

// Report form lists

/**
 * Company departments as they actually appear in employee files.
 * Department was free text in the report form, so variant spellings and 'HR' counted as separate departments in grouped reports. The source is the Employee.department values themselves, not a hand-written list, so no phantom department appears and a new one is never missing.
 */
exports.listDepartments = async (req, res) => {
  try {
    const values = await Employee.distinct('department', { isHrRecord: { $ne: false } });
    const departments = values
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ar'));
    res.json({ departments: Array.from(new Set(departments)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load departments' });
  }
};

/**
 * Who a report can be assigned to for resolution: system admins and IT staff.
 * The name used to be free text, so the number of reports per person and a per-person view were impossible; assigning to a real user makes both possible.
 */
exports.listAssignees = async (req, res) => {
  try {
    const users = await User.find({ role: { $in: EDIT_ROLES }, isActive: { $ne: false } })
      .select('firstName lastName role email')
      .sort({ firstName: 1 })
      .limit(500)
      .lean();
    // An archived user is neither selectable nor assignable, as if deleted.
    const archSets = await require('../utils/endedStaff').endedStaff();
    res.json({ users: users.filter((u) => !require('../utils/endedStaff').userArchived(archSets, u)) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load assignees' });
  }
};

// ── Systems & services ──────────────────────────────────────────────────────

exports.listSystems = async (req, res) => {
  try {
    const { status, type, q } = req.query;
    const filter = {};
    // One status or several.
    // The 'down or degraded' card combines two statuses (`down` and `degraded`); a filter accepting a single value would make the number and the table disagree on click.
    if (status) {
      const keys = String(status).split(',').map((x) => x.trim()).filter(Boolean);
      if (keys.length === 1) [filter.status] = keys; else if (keys.length) filter.status = { $in: keys };
    }
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
    return sendMongooseError(res, error, 'Failed to create system');
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
    return sendMongooseError(res, error, 'Failed to update system');
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

// Shared with services/itTicketJp so a ticket opened from the work plan obeys the same rules.
exports._ticketRules = {
  today, buildSignature,
  closedFields: (reportedAt, resolvedDate) => ({
    resolvedDate, resolvedAt: new Date(`${resolvedDate}T00:00:00Z`), resolutionMinutes: resolutionMinutesOf(reportedAt, resolvedDate),
  }),
};
