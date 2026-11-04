const CustomsClearance = require('../models/CustomsClearance');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const {
  recomputeTotals, COST_KEYS, MARGIN_KEYS, pipelineOf, readStages, readUnits, lockReason, hasTransportInvoice,
  UNIT_STAGES, PORT_LEGS,
  syncUnits, TRANSPORT_LEGS, CARGO_TYPES, VEHICLE_KINDS,
  STAGE_COST, TRANSPORT_STAGE_KEYS, DERIVED_REVENUE, applyPaidCosts, costFieldOf,
} = require('../models/CustomsClearance');
const contractPricing = require('../utils/customsContractPricing');
const cache = require('../utils/ttlCache');
const { searchKey } = require('../utils/arabicSearch');
const { parseMonth, parseYear } = require('../utils/period');
const logAudit = require('../utils/auditLogger');
const { endedStaff, userEnded } = require('../utils/endedStaff');
const { emitToAll } = require('../websocket/socketManager');
const { createNotification } = require('../services/notificationService');

// Scalar fields a client may set on create/update.
const EDITABLE = [
  'branch', 'cancelled', 'cargoType', 'assignedTo', 'customerName', 'customer',
  'shippingAgent', 'shippingAgentEmail', 'blNumber', 'invoiceNumber', 'invoiceDate',
  'port', 'invoiceType', 'containerCount', 'totalWeight', 'invoiceValue', 'currency',
  'exporterCompany', 'countryOfOrigin', 'hsCode', 'saberNumber', 'notes',
  // master-spreadsheet additions
  'legacySerial', 'periodMonth', 'periodYear', 'city',
  'declarationNumber', 'declarationDate', 'papersReceivedDate',
  'unloadingAppointment', 'unloadingLocation', 'doNumber', 'exitPermitNumber',
  'returnDeadline', 'returnFreeDays', 'demurrageStartDate',
  // Stages are not written here: they have rules (two mutually exclusive paths, stages that close), so they go through `setStage` only. See PATCH /:id/stage.
  // Links the transaction to the customer and agent files.
  'customerParty', 'agentParty',
  // Upcoming transaction: its flag and expected date.
  'upcoming', 'expectedDate',
];

// Sub-documents. Sent as whole objects by the frontend but merged field-by-field
// here so a partial PUT can never wipe the sibling keys.
const NESTED = {
  documents: ['bl', 'commercialInvoice', 'certificateOfOrigin', 'packingList', 'saber'],
  agentPapers: ['blStamped', 'customerAuthorization', 'companyAuthorization'],
  stageDates: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  stageDone: ['doInvoiceEmailed', 'doInvoicePaid', 'doLinkEmailed', 'dutyPaid', 'portFeesPaid', 'unloadingFeesPaid', 'containersReturned', 'returnInvoiceDate'],
  costs: COST_KEYS,
  // totalInvoiced/profit are derived and never accepted from the client. Same for `transportNet`: it is now the difference between transport price and supplier price (recomputeTotals), so accepting it would allow a number that contradicts its line items.
  revenue: [...MARGIN_KEYS.filter((k) => !DERIVED_REVENUE.includes(k)), 'transportSelling', 'yardTransportNet',
    'transportToYardSelling', 'yardToCustomerSelling', 'yardPrice'],
  billing: ['invoiceStatus', 'ourInvoiceNumber', 'invoicedAt'],
};

const NUMERIC_NESTED = new Set(['costs', 'revenue']);
// Fields where empty means something, not zero: price not yet entered (see recomputeTotals).
const NULLABLE_NESTED = new Set(['revenue.transportToYardSelling', 'revenue.yardPrice']);

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
      if (NULLABLE_NESTED.has(`${group}.${k}`) && (v === null || v === '')) { merged[k] = null; continue; }
      merged[k] = NUMERIC_NESTED.has(group) ? (Number.isFinite(Number(v)) ? Number(v) : 0) : v;
    }
    out[group] = merged;
  }

  if (out.cargoType !== undefined && !CARGO_TYPES.includes(out.cargoType)) delete out.cargoType;

  if (Array.isArray(body.containers)) {
    const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    out.containers = body.containers
      .filter((r) => r && typeof r === 'object')
      .map((r, i) => ({
        // Unit stages and their path are not written here (they use `PATCH /:id/stage`): keep the stored value for this field whatever the screen sent.
        route: (existing && existing.containers && existing.containers[i] && existing.containers[i].route) || '',
        stagesDone: (existing && existing.containers && existing.containers[i] && existing.containers[i].stagesDone) || [],
        containerNumber: String(r.containerNumber || '').trim().slice(0, 60),
        exitPermit: Number.isFinite(Number(r.exitPermit)) ? Number(r.exitPermit) : 0,
        declaration: String(r.declaration || '').trim(),
        notes: String(r.notes || '').trim(),
        returnDate: ymd(r.returnDate),
        returnDepot: String(r.returnDepot || '').trim().slice(0, 120),
        returnReceipt: String(r.returnReceipt || '').trim().slice(0, 80),
        returnVehicleKind: VEHICLE_KINDS.includes(r.returnVehicleKind) ? r.returnVehicleKind : '',
        returnRef: String(r.returnRef || '').trim().slice(0, 80),
        returnNotes: String(r.returnNotes || '').trim().slice(0, 500),
        // One statement per transport stage; the last wins if the key repeats.
        moves: TRANSPORT_LEGS.map((leg) => (Array.isArray(r.moves) ? r.moves : []).filter((m) => m && m.leg === leg).pop())
          .filter(Boolean)
          .map((m) => ({
            leg: m.leg,
            vehicleKind: VEHICLE_KINDS.includes(m.vehicleKind) ? m.vehicleKind : '',
            ref: String(m.ref || '').trim().slice(0, 80),
          }))
          .filter((m) => m.vehicleKind || m.ref),
      }));
  }
  // Slots match the number of units
  // The count is set on create and editable later; either way one slot is opened per container. A slot with a number written in it is not dropped when the count shrinks (see syncUnits).
  if (out.containerCount !== undefined || out.containers) {
    const count = out.containerCount !== undefined
      ? out.containerCount
      : ((existing && existing.containerCount) || (out.containers || []).length);
    out.containers = syncUnits(out.containers || (existing && existing.containers) || [], count);
    out.containerCount = out.containers.length;
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

/**
 * Fields not displayed, exported or searched are not sent; the cluster round trip is the whole cost (see dashboard-performance).
 * Fields are named explicitly: what the table shows, what Excel exports and what is searched (search runs in memory on this same list, so a field dropped here silently leaves search).
 * Search-only fields are read from the cluster and cached, and `toWire` drops them before sending.
 */
// What both screens read: web table, Excel columns, mobile line and their filters.
const DISPLAY_FIELDS = [
  'refNumber', 'blNumber', 'customerName', 'shippingAgent', 'port', 'stage', 'branch', 'city',
  'containerCount', 'declarationNumber', 'periodYear', 'periodMonth', 'createdAt',
  // Table columns: declaration number and unloading date (the transaction's unloading appointment).
  'unloadingAppointment',
  'cancelled', 'isCompleted', 'returnDeadline', 'returnFreeDays',
  'customerParty', 'agentParty',
  // Transaction type and customer invoice number; the table's invoice status is read from it.
  'cargoType', 'saleInvoiceNumber',
  // The mobile line shows and searches the exporting company (configs.dart, customsCfg).
  'exporterCompany',
  // The web search box runs in the browser
  // The web screen does not send `search` to the server; it filters its own rows. So a field the box reads must actually reach the client. The agent invoice number is one of them and costs almost nothing.
  'invoiceNumber',
];
// Sent after an internal pick, not the whole subdocument (see toWire).
const DISPLAY_NESTED = ['invoiceRequest.status', 'billing.invoiceStatus', 'billing.ourInvoiceNumber', 'stageDone.containersReturned',
  'costs.total', 'revenue.clearanceFee', 'revenue.totalInvoiced', 'revenue.profit'];
// Search has its own index (see SEARCH_INDEX_FIELDS below), so the list reads only what is displayed or computed from.
// Read for computation but not sent: stage percentage and whether it awaits the transport invoice.
const DERIVE_ONLY = ['papersReceivedDate', 'declarationDate', 'stagesDone', 'transportRoute', 'pipelineVersion', 'stageDone.doInvoicePaid', 'transportInvoiceReceived',
  'containers.route', 'containers.stagesDone',
  // Container (or vehicle) numbers: searched, and only one line is sent (see toWire).
  'containers.containerNumber'];
const LIST_FIELDS = [...DISPLAY_FIELDS, ...DISPLAY_NESTED, ...DERIVE_ONLY, 'notesLog'].join(' ');

/**
 * Search by anything written on the transaction (container, bill of lading, declaration, delivery order, exit permit, invoice numbers...).
 * One index serves all screens: each transaction has one folded line of all its text, queried by containment. Folding (searchKey) drops spaces and dashes and unifies Arabic letter forms and digits.
 * Add any new text field to the transaction here and in `searchValuesOf`.
 */
const SEARCH_INDEX_FIELDS = [
  'refNumber', 'blNumber', 'customerName', 'shippingAgent', 'shippingAgentEmail', 'carrierName',
  'customerParty', 'agentParty', 'carrierParty',
  'invoiceNumber', 'saleInvoiceNumber', 'billing.ourInvoiceNumber', 'billing.invoiceStatus',
  'port', 'city', 'branch', 'declarationNumber', 'doNumber', 'exitPermitNumber', 'saberNumber', 'hsCode',
  'exporterCompany', 'countryOfOrigin', 'currency', 'invoiceType', 'legacySerial', 'notes', 'assignedTo',
  'unloadingLocation', 'contractPricing.contractTitle', 'contractPricing.routeFrom', 'contractPricing.routeTo',
  // Containers (or vehicles): number, statement, return, and each trip's manifest number.
  'containers.containerNumber', 'containers.declaration', 'containers.notes', 'containers.returnDepot',
  'containers.returnReceipt', 'containers.returnRef', 'containers.returnNotes', 'containers.moves.ref',
  // All payment requests, sale lines, transport invoice, attachments and notes.
  'paymentStages.label', 'paymentStages.note', 'paymentStages.decisionNote', 'paymentStages.fileName',
  'saleItems.label', 'saleItems.note', 'transportInvoice.note', 'transportInvoice.fileName',
  'attachments.title', 'attachments.fileName', 'notesLog.text', 'notesLog.byName',
].join(' ');
const BRANCH_NAMES = { jeddah: 'جدة Jeddah', dammam: 'الدمام Dammam' };

/** Every searchable text of the transaction, plus its parties' names as in the parties register. */
function searchValuesOf(c, partyName = () => '') {
  const list = (a) => (Array.isArray(a) ? a : []);
  return [
    c.refNumber, c.blNumber, c.customerName, c.shippingAgent, c.shippingAgentEmail, c.carrierName,
    partyName(c.customerParty), partyName(c.agentParty), partyName(c.carrierParty),
    c.invoiceNumber, c.saleInvoiceNumber, c.billing && c.billing.ourInvoiceNumber, c.billing && c.billing.invoiceStatus,
    c.port, c.city, BRANCH_NAMES[c.branch], c.declarationNumber, c.doNumber, c.exitPermitNumber, c.saberNumber, c.hsCode,
    c.exporterCompany, c.countryOfOrigin, c.currency, c.invoiceType, c.legacySerial, c.notes, c.assignedTo,
    c.unloadingLocation,
    c.contractPricing && c.contractPricing.contractTitle, c.contractPricing && c.contractPricing.routeFrom,
    c.contractPricing && c.contractPricing.routeTo,
    ...list(c.containers).flatMap((x) => (x ? [x.containerNumber, x.declaration, x.notes, x.returnDepot,
      x.returnReceipt, x.returnRef, x.returnNotes, ...list(x.moves).map((m) => m && m.ref)] : [])),
    ...list(c.paymentStages).flatMap((x) => (x ? [x.label, x.note, x.decisionNote, x.fileName] : [])),
    ...list(c.saleItems).flatMap((x) => (x ? [x.label, x.note] : [])),
    c.transportInvoice && c.transportInvoice.note, c.transportInvoice && c.transportInvoice.fileName,
    ...list(c.attachments).flatMap((x) => (x ? [x.title, x.fileName] : [])),
    ...list(c.notesLog).flatMap((x) => (x ? [x.text, x.byName] : [])),
  ];
}

// Separator that cannot be typed in a search box, so text cannot match across the end of one field and the start of the next.
const SEP = '\u0001';

/** The index itself: built once per 30 seconds and cleared on every write in the section. */
const searchIndex = () => cache.wrap('customs:search-index', 30000, async () => {
  const [rows, parties] = await Promise.all([
    CustomsClearance.find({}).select(SEARCH_INDEX_FIELDS).lean(),
    require('../models/CustomsParty').find({}).select('name').lean(),
  ]);
  const names = new Map(parties.map((p) => [String(p._id), p.name || '']));
  const partyName = (id) => (id ? names.get(String(id)) || '' : '');
  return rows.map((c) => ({
    id: String(c._id),
    parties: [c.customerParty, c.agentParty, c.carrierParty].filter(Boolean).map(String),
    blob: searchValuesOf(c, partyName)
      .filter((v) => v != null && v !== '')
      .map(searchKey).filter(Boolean).join(SEP),
  }));
});

/**
 * Transactions matching the search text. Matches the whole folded text ("MSKU 123 4567" = "MSKU1234567") or each word separately (agent and branch).
 * `null` if the text has nothing to search by.
 */
async function searchClearances(text) {
  const raw = String(text || '').trim().slice(0, 120);
  const whole = searchKey(raw);
  if (!whole) return null;
  const words = raw.split(/\s+/).map(searchKey).filter(Boolean);
  const idx = await searchIndex();
  return idx.filter((r) => r.blob.includes(whole) || (words.length > 1 && words.every((w) => r.blob.includes(w))));
}
exports._search = { searchValuesOf, searchClearances, SEARCH_INDEX_FIELDS };

/**
 * Profit is for management, not the team
 * Analytics and profit are management matters. System admin and section manager see profit and margin; for others the number is removed on the server, not hidden in the screen.
 */
const MONEY_ROLES = ['super_admin', 'admin', 'customs_manager'];
const seesMoney = (req) => MONEY_ROLES.includes(req.user && req.user.role);
// Profit of a single transaction: for management, and for finance, which reviews it from its own screen.
const PROFIT_ROLES = [...MONEY_ROLES, 'cfo', 'accounting_manager', 'accountant'];
/**
 * Transaction date
 * Day, month and period filters are measured on it. `createdAt` is unsuitable: records imported from the master were all entered on one day, so a date filter dropped all or kept all. The date is what the business knows: paper receipt, then declaration, then first of its month in the master, then entry day (Riyadh time).
 */
const txDateOf = (c) => {
  for (const v of [c.papersReceivedDate, c.declarationDate]) {
    const d = String(v || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  if (c.periodYear && c.periodMonth) return `${c.periodYear}-${String(c.periodMonth).padStart(2, '0')}-01`;
  return c.createdAt ? new Date(new Date(c.createdAt).getTime() + 3 * 3600000).toISOString().slice(0, 10) : '';
};

/** Invoiced but not closed: awaiting the transport invoice. */
// Closing no longer waits for a transport invoice in the payment stages: the request is sent with its lines and then closed. So no transaction is awaiting a transport invoice except leftovers from before.
const awaitsTransportInvoice = (c) => (!!c.saleInvoiceNumber || c.invoiceRequest?.status === 'pending') && !c.isCompleted && !c.cancelled;

/**
 * A list row as it crosses the network.
 * Empty values are not sent (`"carrierName":""`, `"lastNote":null`, `"returnDeadline":""`); readers use `?.` or `|| ''`, so absent and empty are the same. Zero and `false` are sent: a count of 0 containers and a not-closed state are meaningful.
 */
function toWire(r, money = true) {
  const out = { _id: r._id };
  for (const k of DISPLAY_FIELDS) {
    const v = r[k];
    if (v !== '' && v !== null && v !== undefined) out[k] = v;
  }
  if (r.costs) out.costs = { total: r.costs.total };
  if (r.revenue) {
    out.revenue = {
      clearanceFee: r.revenue.clearanceFee, totalInvoiced: r.revenue.totalInvoiced,
      ...(money ? { profit: r.revenue.profit } : {}),
    };
  }
  // Percentage and next stage are computed by the transaction's own rule (pipelineOf).
  const p = pipelineOf(r);
  out.pipeline = { percent: p.percent, done: p.done, total: p.total, next: p.next };
  // The transaction date used for filtering (see txDateOf), and whether it was invoiced, even before the system.
  out.date = txDateOf(r);
  if (r.saleInvoiceNumber || p.steps.some((x) => x.key === 'invoiced' && x.done)) out.invoiced = true;
  if (awaitsTransportInvoice(r)) out.awaitingTransportInvoice = true;
  const billing = {};
  if (r.billing && r.billing.invoiceStatus) billing.invoiceStatus = r.billing.invoiceStatus;
  if (r.billing && r.billing.ourInvoiceNumber) billing.ourInvoiceNumber = r.billing.ourInvoiceNumber;
  if (Object.keys(billing).length) out.billing = billing;
  // Returned is a raised flag, not a state moved to: the screen reads `stageDone?.containersReturned`.
  // The return is marked per container since stages became per unit, so the aggregate step counts too (done when every container is returned), the same rule as the dashboard. Reading only the transaction flag left a returned transaction "return overdue" on the list.
  const returnedAll = p.steps.some((x) => x.key === 'containers_returned' && x.done);
  if (returnedAll || (r.stageDone && r.stageDone.containersReturned) || (r.stagesDone || []).includes('containers_returned')) out.stageDone = { containersReturned: true };
  if (r.lastNote) out.lastNote = r.lastNote;
  out.notesCount = r.notesCount;
  // Unit numbers on one line: the web search box filters in the browser, so it would not find a container that never reached it.
  const nums = (r.containers || []).map((x) => String((x && x.containerNumber) || '').trim()).filter(Boolean);
  if (nums.length) out.containerNumbers = nums.join(' ');
  return out;
}

exports.getClearances = async (req, res) => {
  try {
    const q = req.query || {};
    const filter = {};
    // Filters
    // There used to be four: branch, stage, period, billing status. The business asks for more: a specific customer, agent, port, currency, origin country, date range and owner. All are table columns that were read but not filterable, which forced exporting everything and filtering in Excel.
    const eq = {
      branch: 'branch', stage: 'stage', invoiceStatus: 'billing.invoiceStatus',
      port: 'port', currency: 'currency', invoiceType: 'invoiceType', city: 'city',
      countryOfOrigin: 'countryOfOrigin', assignedTo: 'assignedTo',
      customerParty: 'customerParty', agentParty: 'agentParty',
    };
    for (const [k, path] of Object.entries(eq)) if (q[k]) filter[path] = q[k];
    // Records before the field existed have no type and are containers, so containers means "not vehicles" rather than "equals containers".
    if (CARGO_TYPES.includes(q.cargoType)) filter.cargoType = q.cargoType === 'vehicles' ? 'vehicles' : { $ne: 'vehicles' };
    // Upcoming transactions are not mixed with current ones
    // Everything on this screen is about transactions that happened: counts, profit, delays. A row not yet arrived would corrupt every count. They have their own list: `upcoming=true`.
    filter.upcoming = q.upcoming === 'true' ? true : { $ne: true };
    if (q.active === 'true') filter.cancelled = { $ne: true };
    if (q.cancelled === 'true') filter.cancelled = true;
    // Month is accepted as a number or "YYYY-MM"; unparseable values are ignored (see utils/period).
    const yq = parseYear(q.year); if (yq) filter.periodYear = yq;
    const mq = parseMonth(q.month);
    if (mq.month) filter.periodMonth = mq.month;
    if (mq.year && !yq) filter.periodYear = mq.year;
    // Date range in company time (see utils/companyDay).
    if (q.from || q.to) {
      const { startOfDay, endOfDay } = require('../utils/companyDay');
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = startOfDay(q.from);
      filter.createdAt.$lte = q.to ? endOfDay(q.to) : new Date();
    }
    // Not yet invoiced is a finance question asked weekly that previously needed an export.
    if (q.uninvoiced === 'true') {
      filter.$and = [...(filter.$and || []), {
        $or: [{ 'billing.invoiceStatus': { $ne: 'invoiced' } }, { 'billing.invoiceStatus': { $exists: false } }],
      }];
    }

    // Search text: `search` from web, `q` from mobile (serverSearch)
    const search = String(q.search || q.q || '').trim();
    // `ids=1`: only the matching ids, no rows. Used by screens that filter in the browser (list, section dashboard, party pages) so their filters and counters stay and search covers everything in the transaction. Not restricted to upcoming or otherwise: each screen intersects it with its own set.
    if (q.ids === '1' || q.ids === 'true') {
      const hits = (await searchClearances(search)) || [];
      return res.json({ ids: hits.map((h) => h.id), parties: [...new Set(hits.flatMap((h) => h.parties))] });
    }

    const SKIP = new Set(['search', 'q', 'limit']);
    const ck = `customs:list:${JSON.stringify(Object.keys(q).sort().reduce((o, k) => (SKIP.has(k) ? o : (o[k] = q[k], o)), {}))}`;
    // Heavy fields are excluded from the list: attachments alone can reach forty lines per transaction and the list shows none of them. They load only when the transaction opens. This greatly reduces transfer on the constrained Atlas tier.
    let list = await cache.wrap(ck, 30000, async () => {
      const rows = await CustomsClearance.find(filter)
        .select(LIST_FIELDS).sort({ createdAt: -1 }).lean();
      // Only the last note is sent
      // The table shows the last one, not the whole log; sending ten notes per row over a constrained link is wasted transfer. The log is read in the transaction.
      return rows.map((r) => {
        const log = r.notesLog || [];
        const last = log.length ? log[log.length - 1] : null;
        const { notesLog, ...rest } = r;
        return { ...rest, lastNote: last ? { text: last.text, byName: last.byName, at: last.at } : null, notesCount: log.length };
      });
    });

    // Search by any name or number
    // From the index (see SEARCH_INDEX_FIELDS). Applied before sending, so the count is the number matched, not the list size.
    if (search) {
      const hits = await searchClearances(search);
      if (hits) {
        const keep = new Set(hits.map((h) => h.id));
        list = list.filter((c) => keep.has(String(c._id)));
      }
    }

    const money = seesMoney(req);
    res.json({ clearances: list.map((r) => toWire(r, money)) });
  } catch (error) {
    console.error('getClearances error:', error);
    res.status(500).json({ message: 'Failed to load clearances' });
  }
};

/** Values of each filter with their row counts: built from the collection, not hand-written. */
exports.getFilterOptions = async (req, res) => {
  try {
    const hit = cache.get('customs:filters');
    if (hit !== undefined) return res.json(hit);
    const FIELDS = ['branch', 'stage', 'port', 'currency', 'invoiceType', 'city', 'countryOfOrigin', 'assignedTo'];
    const facet = {};
    FIELDS.forEach((f, i) => {
      facet[`f${i}`] = [{ $group: { _id: `$${f}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }];
    });
    facet.invoiceStatus = [{ $group: { _id: '$billing.invoiceStatus', count: { $sum: 1 } } }, { $sort: { count: -1 } }];
    facet.years = [{ $group: { _id: '$periodYear', count: { $sum: 1 } } }, { $sort: { _id: -1 } }];
    const [r] = await CustomsClearance.aggregate([{ $facet: facet }]);
    const shape = (rows) => (rows || []).filter((x) => x._id != null && x._id !== '')
      .map((x) => ({ value: String(x._id), count: x.count }));
    const out = { options: {} };
    FIELDS.forEach((f, i) => { out.options[f] = shape(r[`f${i}`]); });
    out.options.invoiceStatus = shape(r.invoiceStatus);
    out.options.years = shape(r.years);
    const parties = await CustomsParty.find({ isActive: { $ne: false } }).select('kind name').sort({ name: 1 }).lean();
    out.options.customers = parties.filter((p) => p.kind === 'customer').map((p) => ({ value: String(p._id), label: p.name }));
    out.options.agents = parties.filter((p) => p.kind === 'agent').map((p) => ({ value: String(p._id), label: p.name }));
    cache.set('customs:filters', out, 5 * 60 * 1000);
    res.json(out);
  } catch (e) {
    console.error('customs getFilterOptions error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر' });
  }
};

exports.getClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id).populate('customer', 'name');
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    // The document leaves without its profit (see toJSON in the model); whoever is entitled gets it here.
    const profit = PROFIT_ROLES.includes(req.user.role) ? Number(clearance.revenue && clearance.revenue.profit) || 0 : undefined;
    res.json({ clearance, ...(profit !== undefined ? { profit } : {}) });
  } catch (error) {
    // An invalid id means not found, not a server fault; a stale or truncated link used to return 500 as if the system were down.
    if (error.name === 'CastError') return res.status(404).json({ message: 'Clearance not found' });
    res.status(500).json({ message: 'Failed to load clearance' });
  }
};

exports.createClearance = async (req, res) => {
  try {
    const data = pick(req.body, null);
    data.createdBy = req.user._id;
    await attachPartyFields(data);
    // Customer contract prices fill revenue from the start (and remain editable).
    if (data.customerParty) {
      const contract = await contractPricing.activeCustomerContract(data.customerParty).catch(() => null);
      if (contract) contractPricing.fillRevenue(data, {}, contract);
    }
    const clearance = await CustomsClearance.create(data);

    await logAudit({ user: req.user._id, action: 'create_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    // Clear the cache before broadcasting: whoever hears the event reads immediately (see announce-before-invalidate).
    cache.clear('customs:');
    try { emitToAll('customs:created', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to create clearance');
  }
};

/**
 * When a customer or agent is chosen from their file, the name is copied into the transaction, with the email if the agent has one.
 * The name stays stored as text because exports and reports read it. The email used to be typed in each transaction from memory, so one wrong letter sent the request to nobody.
 */
async function attachPartyFields(data) {
  if (data.customerParty) {
    const p = await CustomsParty.findById(data.customerParty).select('name').lean();
    if (p) data.customerName = p.name;
  }
  if (data.agentParty) {
    const p = await CustomsParty.findById(data.agentParty).select('name email').lean();
    if (p) {
      data.shippingAgent = p.name;
      // A manually typed email is not erased if the agent file has none.
      if (p.email) data.shippingAgentEmail = p.email;
    }
  }
}

exports.updateClearance = async (req, res) => {
  try {
    const existing = await CustomsClearance.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ message: 'Clearance not found' });
    // Old app changes the stage from here
    // Stages are now marked through `PATCH /:id/stage` with their rules, and `stage` is not written here. An old app version would be told "done" with nothing written, which is worse than rejecting, so it is rejected explicitly. (The web screen never sends `stage`.)
    if (req.body.stage !== undefined && req.body.stage !== existing.stage) {
      return res.status(400).json({ message: 'المراحلُ تُعلَّم من شاشتها الجديدة — حدِّث التطبيق إلى آخر نسخة.', code: 'STAGE_VIA_ENDPOINT' });
    }
    const data = pick(req.body, existing);
    data.lastModifiedBy = req.user._id;
    await attachPartyFields(data);
    // Customer or container count changed: contract prices follow
    // Clearance fees are per container, so an extra container is an extra fee. Only values still equal to the contract are overwritten; manual edits stay (see fillRevenue).
    const partyChanged = data.customerParty !== undefined && String(data.customerParty || '') !== String(existing.customerParty || '');
    const countChanged = data.containerCount !== undefined && Number(data.containerCount) !== Number(existing.containerCount || 0);
    if (partyChanged || countChanged) {
      const partyId = data.customerParty !== undefined ? data.customerParty : existing.customerParty;
      const contract = await contractPricing.activeCustomerContract(partyId).catch(() => null);
      if (contract && contractPricing.fillRevenue(data, existing, contract)) {
        const merged = { costs: { ...(existing.costs || {}), ...(data.costs || {}) }, revenue: data.revenue };
        recomputeTotals(merged);
        data.costs = merged.costs;
        data.revenue = merged.revenue;
      }
    }
    const clearance = await CustomsClearance.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: clearance.stage } }, ipAddress: req.ip });
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to update clearance');
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
    // Profit and analytics are for management only; neither a section stamp nor a page grant opens them.
    if (!seesMoney(req)) return res.status(403).json({ message: 'تحليلاتُ القسم لمدير النظام ومدير القسم', code: 'CUSTOMS_ANALYTICS_MANAGERS' });
    const q = req.query || {};
    const { year, from, to } = q;
    // Upcoming transactions are excluded from the numbers: they have not happened, so no revenue or cost.
    const filter = { cancelled: { $ne: true }, upcoming: { $ne: true } };
    if (year) filter.periodYear = Number(year);
    // Analytics accept what the list accepts
    // It accepted only year and range, so a question like profit with this customer at this port meant exporting and computing by hand. Questions asked of the table are asked of the analysis, so filters are the same.
    const eq = {
      branch: 'branch', stage: 'stage', port: 'port', currency: 'currency',
      invoiceType: 'invoiceType', city: 'city', countryOfOrigin: 'countryOfOrigin',
      customerParty: 'customerParty', agentParty: 'agentParty',
      invoiceStatus: 'billing.invoiceStatus',
    };
    for (const [k, path] of Object.entries(eq)) if (q[k]) filter[path] = q[k];
    // Transaction type and status, queried like customer and port.
    if (CARGO_TYPES.includes(q.cargoType)) filter.cargoType = q.cargoType === 'vehicles' ? 'vehicles' : { $ne: 'vehicles' };
    if (q.state === 'closed' || q.state === 'closedInvoiced' || q.state === 'closedNotInvoiced') filter.isCompleted = true;
    if (q.state === 'open') filter.isCompleted = { $ne: true };
    const mq2 = parseMonth(q.month);
    if (mq2.month) filter.periodMonth = mq2.month;
    if (mq2.year && !year) filter.periodYear = mq2.year;

    // Only what is aggregated is read from `costs`, `revenue` and `billing`, the heaviest fields; the cluster round trip is the whole cost (see dashboard-performance).
    // Cached for a minute: the dashboard is read-only and opens on every page open and live update. Writes in the section clear `customs:`, so stale numbers are not read.
    const ak = `customs:analytics:${JSON.stringify(q)}`;
    const hit = cache.get(ak);
    if (hit !== undefined) return res.json(hit);

    // The range is also filtered in the database, so two years are not transferred to show one month. The in-memory filter afterwards remains authoritative; this one only reduces the payload.
    if (from || to) {
      const lo0 = from ? Number(String(from).slice(0, 4)) * 100 + Number(String(from).slice(5, 7) || 1) : 0;
      const hi0 = to ? Number(String(to).slice(0, 4)) * 100 + Number(String(to).slice(5, 7) || 12) : 999999;
      const pk = { $add: [{ $multiply: [{ $ifNull: ['$periodYear', 0] }, 100] }, { $ifNull: ['$periodMonth', 0] }] };
      filter.$expr = { $and: [{ $gte: [pk, lo0] }, { $lte: [pk, hi0] }] };
    }
    let list = await CustomsClearance.find(filter)
      .select('blNumber refNumber customerName shippingAgent carrierName port stage city branch containerCount periodMonth periodYear costs revenue billing.invoiceStatus '
        + 'cargoType isCompleted saleInvoiceNumber stagesDone transportRoute pipelineVersion stageDone.doInvoicePaid containers.route containers.stagesDone '
        + require('../utils/customsInvoice').MONEY_SELECT)
      .lean();
    // Revenue, cost and profit per transaction, with one rule shared with the clearance finance view (utils/customsInvoice.moneyOf).
    for (const r of list) r._m = require('../utils/customsInvoice').moneyOf(r);
    // Quick filters, like the section dashboard
    const invOf = (r) => !!r.saleInvoiceNumber || !!String((r.billing && r.billing.invoiceStatus) || '').trim()
      || pipelineOf(r).steps.some((x) => x.key === 'invoiced' && x.done);
    const STATE_AR = { open: 'مفتوحة', closedInvoiced: 'مغلقة مفوترة', closedNotInvoiced: 'مغلقة لم تُفوتَر' };
    const quick = applyQuick(list, [
      { key: 'qState', get: (r) => (r.isCompleted ? (invOf(r) ? 'closedInvoiced' : 'closedNotInvoiced') : 'open'), label: (v) => STATE_AR[v] || v },
      { key: 'qCustomer', get: (r) => r.customerName || '' },
      { key: 'qAgent', get: (r) => r.shippingAgent || '' },
      { key: 'qCarrier', get: (r) => r.carrierName || '' },
      { key: 'qPort', get: (r) => r.port || '' },
      { key: 'qBranch', get: (r) => r.branch || '', label: (v) => (v === 'dammam' ? 'الدمام' : v === 'jeddah' ? 'جدة' : v) },
      { key: 'qCargo', get: (r) => (r.cargoType === 'vehicles' ? 'vehicles' : 'containers'), label: (v) => (v === 'vehicles' ? 'سيّارات' : 'حاويات') },
      { key: 'qMonth', get: (r) => (r.periodYear && r.periodMonth ? `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}` : '') },
    ], q);
    list = quick.list;
    // Closed has two kinds: invoiced and not invoiced, with the same definition of invoiced as the dashboard.
    if (q.state === 'closedInvoiced' || q.state === 'closedNotInvoiced') {
      const inv = (r) => !!r.saleInvoiceNumber || !!String((r.billing && r.billing.invoiceStatus) || '').trim()
        || pipelineOf(r).steps.some((x) => x.key === 'invoiced' && x.done);
      list = list.filter((r) => (q.state === 'closedInvoiced') === inv(r));
    }

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
      bucket.revenue += r._m.revenue;
      bucket.costs += r._m.cost;
      bucket.vat += r._m.vat;
      bucket.profit += r._m.profit;
      bucket.clearanceFee += num(r.revenue && r.revenue.clearanceFee);
      if (r.branch === 'dammam') bucket.dammam += 1; else bucket.jeddah += 1;
      return bucket;
    };
    const blank = () => ({ count: 0, containers: 0, revenue: 0, costs: 0, vat: 0, profit: 0, clearanceFee: 0, jeddah: 0, dammam: 0 });
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
        profit: round(b.profit),
        avgContainers: b.count ? round(b.containers / b.count) : 0,
        containerShare: totalContainers ? b.containers / totalContainers : 0,
      }))
      .sort((a, b) => b.containers - a.containers || b.count - a.count)
      .map((b, i) => ({ ...b, rank: i + 1 }));

    const totalContainers = list.reduce((a, r) => a + num(r.containerCount), 0);
    const totalRevenue = round(list.reduce((a, r) => a + r._m.revenue, 0));
    const totalCosts = round(list.reduce((a, r) => a + r._m.cost, 0));
    const totalVat = round(list.reduce((a, r) => a + r._m.vat, 0));
    const clearanceFees = round(list.reduce((a, r) => a + num(r.revenue && r.revenue.clearanceFee), 0));
    const months = new Set(list.filter((r) => key(r) !== null).map((r) => key(r)));

    const byMonth = group(list.filter((r) => key(r) !== null), (r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`)
      .map((b) => ({
        ...b,
        revenue: round(b.revenue),
        costs: round(b.costs),
        profit: round(b.profit),
        year: Number(b.key.slice(0, 4)),
        month: Number(b.key.slice(5, 7)),
      }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    // Where money goes and where it comes from
    // A total cost tells management nothing until broken down: which line eats it. Same for profit: clearance fees, transport difference or storage.
    const breakdown = (keys, of) => keys
      .map((key) => ({ key, amount: round(list.reduce((a, r) => a + num(of(r)[key]), 0)), deals: list.filter((r) => num(of(r)[key]) !== 0).length }))
      .filter((x) => x.amount !== 0).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const costBreakdown = breakdown(COST_KEYS, (r) => r.costs || {});
    const marginBreakdown = breakdown(MARGIN_KEYS, (r) => r.revenue || {});
    const isInvoiced = (r) => !!r.saleInvoiceNumber || !!String((r.billing && r.billing.invoiceStatus) || '').trim()
      || pipelineOf(r).steps.some((x) => x.key === 'invoiced' && x.done);
    const sumRev = (rows) => round(rows.reduce((a, r) => a + r._m.revenue, 0));
    const openRows = list.filter((r) => !r.isCompleted);
    const notInvoicedRows = list.filter((r) => !isInvoiced(r));
    const byCust = finish(group(list, (r) => r.customerName), totalContainers).sort((a, b) => b.profit - a.profit);
    // Profit counts invoiced transactions only (moneyOf): for uninvoiced ones the cost exists but the revenue has not arrived.
    const profitAll = list.reduce((a, r) => a + r._m.profit, 0);
    const billedNet = list.filter((r) => !r._m.pending).reduce((a, r) => a + r._m.revenue - r._m.vat, 0);
    const share = (n) => (profitAll > 0 ? byCust.slice(0, n).reduce((a, b) => a + Math.max(0, b.profit), 0) / profitAll : 0);

    const payload = {
      filters: quick.filters,
      costBreakdown,
      marginBreakdown,
      byCargo: finish(group(list, (r) => (r.cargoType === 'vehicles' ? 'vehicles' : 'containers')), totalContainers),
      byCarrier: finish(group(list.filter((r) => (r.carrierName || '').trim()), (r) => r.carrierName), totalContainers),
      byState: finish(group(list, (r) => (r.isCompleted ? 'closed' : 'open')), totalContainers),
      insight: {
        open: openRows.length, closed: list.length - openRows.length,
        openValue: sumRev(openRows),
        notInvoiced: notInvoicedRows.length, notInvoicedValue: sumRev(notInvoicedRows),
        notInvoicedCosts: round(notInvoicedRows.reduce((a, r) => a + r._m.cost, 0)),
        profitPerContainer: totalContainers ? round(profitAll / totalContainers) : 0,
        revenuePerContainer: totalContainers ? round(totalRevenue / totalContainers) : 0,
        costPerContainer: totalContainers ? round(totalCosts / totalContainers) : 0,
        avgProfit: list.length ? round(profitAll / list.length) : 0,
        losing: list.filter((r) => isInvoiced(r) && r._m.profit < 0).length,
        // How much profit the largest customer and the top five produce: concentration, known before it surprises.
        top1Share: share(1), top5Share: share(5),
      },
      totals: {
        clearances: list.length,
        containers: totalContainers,
        customers: new Set(list.map((r) => (r.customerName || '').trim()).filter(Boolean)).size,
        agents: new Set(list.map((r) => (r.shippingAgent || '').trim()).filter(Boolean)).size,
        invoiced: list.length - notInvoicedRows.length,
        notInvoiced: notInvoicedRows.length,
        avgContainersPerBl: list.length ? round(totalContainers / list.length) : 0,
        totalRevenue,
        clearanceFees,
        totalCosts,
        totalVat,
        netProfit: round(profitAll),
        margin: billedNet ? profitAll / billedNet : 0,
        jeddah: list.filter((r) => r.branch !== 'dammam').length,
        dammam: list.filter((r) => r.branch === 'dammam').length,
        avgInvoice: list.length ? round(totalRevenue / list.length) : 0,
        monthsCovered: months.size,
        avgPerMonth: months.size ? round(list.length / months.size) : 0,
      },
      byCustomer: finish(group(list, (r) => r.customerName), totalContainers),
      byAgent: finish(group(list, (r) => r.shippingAgent), totalContainers),
      byCity: finish(group(list, (r) => r.city || (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      // Other dimensions that are asked about but were not aggregated: where we work (port), where transactions stall (stage), and which branch carries more.
      byPort: finish(group(list, (r) => r.port), totalContainers),
      byStage: finish(group(list, (r) => r.stage), totalContainers),
      byBranch: finish(group(list, (r) => (r.branch === 'dammam' ? 'الدمام' : 'جدة')), totalContainers),
      byMonth,
      // Highest and lowest profit transactions: the aggregate does not say which deal produced it.
      topDeals: list.map((r) => ({
        refNumber: r.refNumber, blNumber: r.blNumber, customerName: r.customerName,
        shippingAgent: r.shippingAgent, port: r.port, containers: num(r.containerCount),
        revenue: round(r._m.revenue),
        costs: round(r._m.cost),
        profit: round(r._m.profit),
      })).sort((a, b) => b.profit - a.profit).slice(0, 20),
      losingDeals: list.map((r) => ({
        refNumber: r.refNumber, blNumber: r.blNumber, customerName: r.customerName,
        revenue: round(r._m.revenue),
        costs: round(r._m.cost),
        profit: round(r._m.profit),
      })).filter((d) => d.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 20),
    };
    cache.set(ak, payload, 60000);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load customs analytics' });
  }
};

exports.deleteClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findByIdAndDelete(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    await logAudit({ user: req.user._id, action: 'delete_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { refNumber: clearance.refNumber } }, ipAddress: req.ip });
    cache.clear('customs:');
    try { emitToAll('customs:deleted', { clearanceId: clearance._id }); } catch (e) {}

    res.json({ message: 'Clearance deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete clearance' });
  }
};

// Attachments
// Transaction papers are uploaded with the transaction and tagged with the stage that produced them, so they are read in place in the procedure cycle. Upload is base64 in the same request, no multer, as elsewhere in the system.

const { saveUploadFile, deleteStoredFile } = require('../utils/fileStore');
const { STAGES } = require('../models/CustomsClearance');

exports.addAttachments = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    if (!incoming.length) return res.status(400).json({ message: 'No files' });
    if ((clearance.attachments || []).length + incoming.length > 40) {
      return res.status(400).json({ message: 'لا يُرفَق أكثر من ٤٠ ملفًّا للمعاملة' });
    }

    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const stage = STAGES.includes(String(f.stage || '')) ? String(f.stage) : '';
      const doc = {
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        stage,
        uploadedBy: req.user._id,
        uploadedByName: req.user.name || '',
        uploadedAt: new Date(),
      };
      clearance.attachments.push(doc);
      added.push(doc);
    }
    if (!added.length) return res.status(400).json({ message: 'No files' });

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();

    await logAudit({ user: req.user._id, action: 'add_customs_attachment', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, files: added.map((a) => a.fileName) } }, ipAddress: req.ip });
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to attach file');
  }
};

exports.updateAttachment = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const att = clearance.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'Attachment not found' });

    if (req.body.title !== undefined) att.title = String(req.body.title).trim().slice(0, 200);
    if (req.body.stage !== undefined) att.stage = STAGES.includes(String(req.body.stage)) ? String(req.body.stage) : '';
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, error.message || 'Failed to update attachment');
  }
};

/** One file on disk may be referenced in several places (transaction attachments, a payment stage entry, an invoice line). It is not deleted from disk while any of them still references it. */
const fileStillUsed = (clearance, url) => !!url && (
  (clearance.attachments || []).some((a) => a.fileUrl === url)
  || (clearance.paymentStages || []).some((p) => p.fileUrl === url || (p.proofFiles || []).some((f) => f.fileUrl === url))
  || (clearance.saleItems || []).some((x) => x.fileUrl === url)
  || (clearance.transportInvoice && clearance.transportInvoice.fileUrl === url));
const dropIfUnused = (clearance, urls) => {
  for (const u of new Set(urls.filter(Boolean))) if (!fileStillUsed(clearance, u)) { try { deleteStoredFile(u); } catch (_) { /* */ } }
};

/**
 * Delete an attachment along with what points to it.
 * Deleting from the transaction attachments used to leave its payment-stage entry pointing at a missing file (and the reverse: deleting the entry left its paper in attachments). They are two faces of one thing, so deleting one deletes the other. The screen says so before confirming.
 */
exports.deleteAttachment = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const att = clearance.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'Attachment not found' });

    const url = att.fileUrl;
    const name = att.title || att.fileName;
    att.deleteOne();
    // And every other reference to the same file in attachments.
    for (const other of clearance.attachments.filter((a) => a.fileUrl === url)) other.deleteOne();
    const removedStages = [];
    for (const p of [...(clearance.paymentStages || [])]) {
      if (p.fileUrl === url) { removedStages.push(p.label || p.key); p.deleteOne(); continue; }
      if ((p.proofFiles || []).some((f) => f.fileUrl === url)) p.proofFiles = p.proofFiles.filter((f) => f.fileUrl !== url);
    }
    // The invoice line stays with its price; only its attachment is removed.
    for (const x of clearance.saleItems || []) {
      if (x.fileUrl === url) Object.assign(x, { fileUrl: '', fileName: '', mimeType: '', size: 0 });
    }
    if (clearance.transportInvoice && clearance.transportInvoice.fileUrl === url) {
      Object.assign(clearance.transportInvoice, { fileUrl: '', fileName: '', mimeType: '', size: 0, receivedAt: null, receivedBy: null, receivedByName: '' });
    }
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    dropIfUnused(clearance, [url]);
    cache.clear('customs:');

    await logAudit({ user: req.user._id, action: 'delete_customs_attachment', entity: 'CustomsClearance', entityId: clearance._id, changes: { before: { fileName: name, paymentStages: removedStages } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}

    res.json({ clearance, removedStages });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to delete attachment' });
  }
};

// Clearance parties: customers and shipping agents
const CustomsParty = require('../models/CustomsParty');
const CustomsContract = require('../models/CustomsContract');
const { fold: foldName } = require('../models/CustomsParty');

/** Search ignores spaces, dashes and Arabic letter-form differences, as elsewhere in the system. "050-123 4567" and "0501234567" are the same number, and one alef form finds the other. */
const partyRx = (s) => {
  const bare = searchKey(s);
  if (!bare) return null;
  const cls = { ا: '[اأإآٱ]', ه: '[هة]', ي: '[يىئ]', و: '[وؤ]' };
  const parts = [...bare].map((ch) => cls[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join('[\\s\\-_./\\\\,:#ـ]*'), 'i');
};

// Three roles, each with its own field on the transaction
// The customer owns the goods, the agent clears them, the carrier moves them. See CustomsParty.
const PARTY_KINDS = ['customer', 'agent', 'carrier'];
const partyField = (kind) => (kind === 'agent' ? 'agentParty' : kind === 'carrier' ? 'carrierParty' : 'customerParty');

exports.listParties = async (req, res) => {
  try {
    // `kind=all`: all parties with their roles, to pick a contract owner from one list.
    const all = req.query.kind === 'all';
    const kind = PARTY_KINDS.includes(req.query.kind) ? req.query.kind : 'customer';
    const filter = all ? {} : { kind };
    if (req.query.active !== 'all') filter.isActive = { $ne: false };
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = partyRx(q);
      // Searched by name and by every number in the file: any name or any number.
      filter.$or = [{ customerCode: rx }, { name: rx }, { email: rx }, { phone: rx }, { contactPerson: rx },
        { commercialRegister: rx }, { taxNumber: rx }, { city: rx }];
      // `deep=1` (parties page): also finds a party by what is in its transactions (container, bill of lading or declaration number). Not requested in pick lists, where the name is typed.
      if (req.query.deep === '1') {
        const hits = (await searchClearances(q)) || [];
        const ids = [...new Set(hits.flatMap((h) => h.parties))];
        if (ids.length) filter.$or.push({ _id: { $in: ids } });
      }
    }
    const parties = await CustomsParty.find(filter).sort({ name: 1 }).lean();

    // Each party comes with its volume: a list without numbers is names that cannot be compared.
    const ids = parties.map((p) => p._id);
    if (all) return res.json({ parties });          // List for picking, without computed numbers
    const field = partyField(kind);
    const agg = await CustomsClearance.aggregate([
      { $match: { [field]: { $in: ids }, cancelled: { $ne: true } } },
      { $group: {
        _id: `$${field}`,
        deals: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$revenue.totalInvoiced', 0] } },
        profit: { $sum: { $ifNull: ['$revenue.profit', 0] } },
        containers: { $sum: { $ifNull: ['$containerCount', 0] } },
        last: { $max: '$createdAt' },
      } },
    ]);
    const stats = new Map(agg.map((a) => [String(a._id), a]));
    const money = seesMoney(req);
    res.json({
      // Profit is for management only (see MONEY_ROLES).
      money,
      parties: parties.map((p) => {
        const s = stats.get(String(p._id)) || {};
        return {
          ...p, deals: s.deals || 0, revenue: Math.round(s.revenue || 0),
          ...(money ? { profit: Math.round(s.profit || 0) } : {}),
          containers: s.containers || 0, lastDealAt: s.last || null,
        };
      }),
    });
  } catch (e) {
    console.error('listParties error:', e);
    res.status(500).json({ message: 'تعذّر تحميل القائمة' });
  }
};

/** Contacts from the request body: cleaned, empty ones dropped, and the first is copied into the legacy fields (email/phone/contactPerson) that email templates and older code read. */
function mirrorContacts(body) {
  if (!Array.isArray(body.contacts)) return body;
  const S = (v) => String(v ?? '').trim();
  const contacts = body.contacts.slice(0, 20)
    .map((c) => ({ name: S(c?.name).slice(0, 120), email: S(c?.email).slice(0, 160), phone: S(c?.phone).slice(0, 40), description: S(c?.description).slice(0, 200) }))
    .filter((c) => c.name || c.email || c.phone);
  const first = contacts[0] || { name: '', email: '', phone: '' };
  return { ...body, contacts, contactPerson: first.name, email: first.email, phone: first.phone };
}

exports.createParty = async (req, res) => {
  try {
    const kind = PARTY_KINDS.includes(req.body.kind) ? req.body.kind : 'customer';
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'الاسم مطلوب' });
    const exists = await CustomsParty.findOne({ kind, nameKey: foldName(name) }).lean();
    if (exists) return res.status(409).json({ message: 'موجودٌ بالاسم نفسِه', party: exists });
    const party = await CustomsParty.create({ ...mirrorContacts(req.body), kind, name, createdBy: req.user._id });
    cache.clear('customs:');
    // Its name is shown on transactions, the list and the dashboard; they reload.
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (_) { /* */ }
    res.status(201).json({ party });
  } catch (e) {
    return sendMongooseError(res, e, e.message || 'تعذّر الحفظ');
  }
};

exports.updateParty = async (req, res) => {
  try {
    // Attachments have their own endpoints; they are not overwritten from here.
    const { kind, _id, __v, attachments, ...raw } = req.body;
    const body = mirrorContacts(raw);
    const party = await CustomsParty.findByIdAndUpdate(req.params.id, { $set: body }, { new: true });
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    // The name is also stored as text in transactions (exports read it), so it is updated too; otherwise the table shows the old name and the file the new one.
    const field = party.kind === 'agent' ? 'shippingAgent' : 'customerName';
    const link = party.kind === 'agent' ? 'agentParty' : 'customerParty';
    await CustomsClearance.updateMany({ [link]: party._id }, { $set: { [field]: party.name } });
    cache.clear('customs:');
    // Its name is shown on transactions, the list and the dashboard; they reload.
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (_) { /* */ }
    res.json({ party });
  } catch (e) {
    return sendMongooseError(res, e, e.message || 'تعذّر الحفظ');
  }
};

exports.deleteParty = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const link = party.kind === 'agent' ? 'agentParty' : 'customerParty';
    const used = await CustomsClearance.countDocuments({ [link]: party._id });
    // A party with history is not deleted: deleting would cut its transactions from their file. It is deactivated, so it leaves lists while its history stays readable.
    if (used > 0) {
      party.isActive = false;
      await party.save();
      cache.clear('customs:');
    // Its name is shown on transactions, the list and the dashboard; they reload.
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (_) { /* */ }
      return res.json({ deactivated: true, used, message: `له ${used} معاملة — عُطِّل ولم يُحذَف كي لا ينقطع تاريخُه.` });
    }
    await party.deleteOne();
    cache.clear('customs:');
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ message: e.message || 'تعذّر الحذف' });
  }
};

/** One party's file: its data, numbers and all its transactions. */
exports.getPartyProfile = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id).lean();
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const field = partyField(party.kind);

    const deals = await CustomsClearance.find({ [field]: party._id })
      .select('-documents -attachments -containers -stageLog').sort({ createdAt: -1 }).lean();
    const { moneyOf } = require('../utils/customsInvoice');
    for (const d of deals) d._m = moneyOf(d);
    const money = seesMoney(req);

    const live = deals.filter((d) => !d.cancelled);
    const sum = (f) => Math.round(live.reduce((t, d) => t + (Number(f(d)) || 0), 0));
    const revenue = sum((d) => d._m.revenue);
    const profit = sum((d) => d._m.profit);
    const cost = sum((d) => d._m.cost);

    // By month, so growth can be read and not only the total.
    const byMonth = {};
    live.forEach((d) => {
      const k = d.periodYear && d.periodMonth
        ? `${d.periodYear}-${String(d.periodMonth).padStart(2, '0')}`
        : (d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 7) : '—');
      if (!byMonth[k]) byMonth[k] = { key: k, deals: 0, revenue: 0, profit: 0, containers: 0 };
      byMonth[k].deals += 1;
      byMonth[k].revenue += d._m.revenue;
      byMonth[k].profit += d._m.profit;
      byMonth[k].containers += Number(d.containerCount) || 0;
    });

    const tally = (get) => {
      const m = new Map();
      live.forEach((d) => { const v = String(get(d) || '—'); m.set(v, (m.get(v) || 0) + 1); });
      return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 12);
    };

    res.json({
      party,
      money,
      totals: {
        deals: live.length,
        cancelled: deals.length - live.length,
        containers: sum((d) => d.containerCount),
        weight: sum((d) => d.totalWeight),
        revenue, cost,
        ...(money ? {
          profit,
          margin: revenue ? Math.round((profit / revenue) * 1000) / 10 : 0,
          avgProfit: live.length ? Math.round(profit / live.length) : 0,
        } : {}),
        firstDealAt: deals.length ? deals[deals.length - 1].createdAt : null,
        lastDealAt: deals.length ? deals[0].createdAt : null,
        // What is not yet invoiced: the first question about a customer file.
        uninvoiced: live.filter((d) => (d.billing?.invoiceStatus || 'not_invoiced') !== 'invoiced').length,
      },
      byMonth: Object.values(byMonth).sort((a, b) => a.key.localeCompare(b.key))
        .map((b) => ({ ...b, revenue: Math.round(b.revenue), profit: money ? Math.round(b.profit) : undefined })),
      byStage: tally((d) => d.stage),
      byPort: tally((d) => d.port),
      byCounterparty: tally((d) => (party.kind === 'customer' ? d.shippingAgent : d.customerName)),
      // Our contracts with the party, read in its file and not in another screen. See CustomsContract.
      contracts: await CustomsContract.find({ party: party._id }).sort({ createdAt: -1 }).lean(),
      deals: deals.map((d) => {
        const p = pipelineOf(d);
        // Transaction money (`_m`) is for management only; payment stages and sale lines were read for the computation and are not sent.
        const { _m, paymentStages, saleItems, ...rest } = d;
        const out = { ...rest, pipeline: { percent: p.percent, next: p.next }, ...(money ? { money: _m } : {}) };
        if (!money && out.revenue) out.revenue = { ...out.revenue, profit: undefined, transportNet: undefined };
        return out;
      }),
    });
  } catch (e) {
    console.error('getPartyProfile error:', e);
    res.status(500).json({ message: 'تعذّر تحميل الملفّ' });
  }
};

// Section settings, upcoming transactions, payment requests

const CustomsSettings = require('../models/CustomsSettings');

/** Section settings: currently the alert days number. */
exports.getSettings = async (req, res) => {
  try {
    res.json({ settings: await CustomsSettings.get() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الإعدادات' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const days = Number(req.body.upcomingAlertDays);
    if (!Number.isFinite(days) || days < 0 || days > 60) {
      return res.status(400).json({ message: 'عدد الأيّام بين صفر وستّين' });
    }
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    const settings = await CustomsSettings.findOneAndUpdate(
      { key: 'customs' },
      { $set: { upcomingAlertDays: Math.round(days), updatedBy: req.user._id, updatedByName: who } },
      { new: true, upsert: true },
    ).lean();
    try { cache.clear('customs:'); } catch (_) { /* */ }
    // The upcoming window changes what the dashboard flags.
    try { emitToAll('customs:updated', { settings: true }); } catch (_) { /* */ }
    res.json({ settings });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حفظ الإعدادات' });
  }
};

/**
 * Upcoming transactions badge
 * Count of those whose date is near. The window comes from section settings, not a number in code, so changing it to three days takes effect on the next call without a deploy.
 * Overdue ones stay in the count: a transaction whose time came and was not converted deserves the alert more than one two days away.
 */
exports.upcomingAlerts = async (req, res) => {
  try {
    const { upcomingAlertDays } = await CustomsSettings.get();
    const days = Number.isFinite(Number(upcomingAlertDays)) ? Number(upcomingAlertDays) : 2;
    // Today in company time, not server time
    // `todayKey` returns "YYYY-MM-DD" for Riyadh, the same shape as the stored `expectedDate`, so the comparison is a direct string compare with no timezone conversion. See utils/companyDay (`startOfDay` takes a day key, not a Date).
    const { todayKey, DAY_MS, startOfDay } = require('../utils/companyDay');
    const today = todayKey();
    const until = new Date(startOfDay(today).getTime() + days * DAY_MS)
      .toISOString().slice(0, 10);

    const rows = await CustomsClearance.find({
      upcoming: true,
      cancelled: { $ne: true },
      expectedDate: { $gt: '', $lte: until },
    }).select('refNumber blNumber customerName shippingAgent port expectedDate containerCount branch notes')
      .sort({ expectedDate: 1 }).lean();

    // All upcoming ones in the same window
    // The upcoming transactions page was raised at the section's request: the window is enough. It carries every upcoming one, not only near ones, each with days remaining and its five papers, so papers are marked and the date edited from the window without opening the transaction.
    const all = await CustomsClearance.find({ upcoming: true, cancelled: { $ne: true } })
      .select('refNumber blNumber customerName shippingAgent expectedDate containerCount branch notes documents')
      .sort({ expectedDate: 1 }).lean();
    const t0 = startOfDay(today).getTime();
    const daysLeft = (d) => (d ? Math.round((startOfDay(d).getTime() - t0) / DAY_MS) : null);

    res.json({
      days,
      count: rows.length,
      today,
      // Overdue ones deserve the alert more than those not yet due, so they are flagged.
      items: rows.map((r) => ({ ...r, overdue: r.expectedDate < today })),
      upcoming: all.map((r) => ({
        ...r,
        daysLeft: daysLeft(r.expectedDate),
        overdue: !!r.expectedDate && r.expectedDate < today,
        dueSoon: !!r.expectedDate && r.expectedDate <= until,
      })),
      total: all.length,
    });
  } catch (e) {
    console.error('customs upcomingAlerts:', e);
    res.status(500).json({ message: 'تعذّر قراءة المعاملات القادمة' });
  }
};

/**
 * Convert an upcoming transaction to current: the same record, now that it happened.
 * It is not created anew: everything written in it (customer, agent, port, containers) was written once, and rewriting it invites errors and a second copy.
 */
exports.activateClearance = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (!clearance.upcoming) return res.json({ clearance });
    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    clearance.upcoming = false;
    clearance.activatedAt = new Date();
    clearance.activatedBy = req.user._id;
    clearance.activatedByName = who;
    await clearance.save();
    try { cache.clear('customs:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }
    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { after: { upcoming: false } }, ipAddress: req.ip,
    });
    res.json({ clearance });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحويل المعاملة' });
  }
};

/**
 * Payment requests as finance sees them
 * Payment stage entries across all transactions, flattened into one list: each line says which transaction, which stage, how much and its attachment, so all the work reads on one screen instead of opening transactions one by one.
 */
/**
 * Counting and filtering happen in the database: loading all transactions with all stages on every open and decision took seconds for a few dozen displayed rows. Counters run in one pass, the displayed page in another.
 * The carried-over log is not a payment: import turned every done in the master into a paid entry with no amount. It is not a finance decision, so it is counted separately and shown only on request.
 */
const LEGACY_DECIDER = 'سجلّ سابق';

exports.listPaymentRequests = async (req, res) => {
  try {
    const status = ['pending', 'paid', 'returned', 'rejected', 'all'].includes(String(req.query.status))
      ? String(req.query.status) : 'pending';
    const legacy = String(req.query.legacy || '') === '1';
    const q = String(req.query.search || '').trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const key = `customs:payreq:${status}:${legacy ? 1 : 0}:${q}:${page}:${limit}`;

    const body = await cache.wrap(key, 30000, async () => {
      const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
      const rowMatch = {
        ...(status !== 'all' ? { st: status } : {}),
        ...(legacy ? {} : { legacy: false }),
        ...(rx ? { $or: [
          { refNumber: rx }, { blNumber: rx }, { customerName: rx },
          { 'paymentStages.label': rx }, { 'paymentStages.addedByName': rx },
        ] } : {}),
      };
      const [agg] = await CustomsClearance.aggregate([
        { $match: { cancelled: { $ne: true }, 'paymentStages.0': { $exists: true } } },
        { $project: { refNumber: 1, blNumber: 1, customerName: 1, shippingAgent: 1, port: 1, branch: 1, paymentStages: 1 } },
        { $unwind: '$paymentStages' },
        { $addFields: {
          st: { $ifNull: ['$paymentStages.payStatus', 'pending'] },
          legacy: { $eq: ['$paymentStages.decidedByName', LEGACY_DECIDER] },
        } },
        { $facet: {
          counts: [
            { $group: {
              _id: { st: '$st', legacy: '$legacy' },
              n: { $sum: 1 },
              amount: { $sum: { $ifNull: ['$paymentStages.amount', 0] } },
            } },
          ],
          total: [{ $match: rowMatch }, { $count: 'n' }],
          page: [
            { $match: rowMatch },
            { $sort: { 'paymentStages.addedAt': -1, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
        } },
      ]);

      const counts = { pending: 0, paid: 0, returned: 0, rejected: 0, legacy: 0, amountPending: 0, amountPaid: 0 };
      for (const c of agg?.counts || []) {
        if (c._id.legacy) { counts.legacy += c.n; continue; }
        if (counts[c._id.st] !== undefined) counts[c._id.st] += c.n;
        if (c._id.st === 'pending') counts.amountPending += c.amount;
        if (c._id.st === 'paid') counts.amountPaid += c.amount;
      }
      counts.amountPending = Math.round(counts.amountPending * 100) / 100;
      counts.amountPaid = Math.round(counts.amountPaid * 100) / 100;

      const total = agg?.total?.[0]?.n || 0;
      const requests = (agg?.page || []).map((c) => {
        const e = c.paymentStages;
        return {
          clearanceId: String(c._id),
          refNumber: c.refNumber,
          blNumber: c.blNumber,
          customerName: c.customerName,
          shippingAgent: c.shippingAgent,
          port: c.port,
          branch: c.branch,
          entryId: String(e._id),
          key: e.key,
          label: e.label,
          date: e.date,
          amount: e.amount,
          note: e.note,
          fileUrl: e.fileUrl,
          fileName: e.fileName,
          addedByName: e.addedByName,
          addedAt: e.addedAt,
          payStatus: c.st,
          legacy: c.legacy,
          decisionNote: e.decisionNote || '',
          decidedByName: e.decidedByName || '',
          decidedAt: e.decidedAt || null,
          proofFiles: e.proofFiles || [],
        };
      });
      return { requests, counts, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    });
    res.json(body);
  } catch (e) {
    console.error('customs listPaymentRequests:', e);
    res.status(500).json({ message: 'تعذّر تحميل طلبات الصرف' });
  }
};

/**
 * Finance decision on a payment request.
 * Three answers: paid (with optional proof), returned for correction (with a reason), or rejected. The reason is optional in both cases since it may be said verbally, but it is stored where it is read: next to the entry itself in the clearance screen, not in email.
 */
exports.decidePaymentStage = async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    if (!['paid', 'returned', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'قرارٌ غير معروف' });
    }
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = (clearance.paymentStages || []).id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });

    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || '';
    const files = Array.isArray(req.body.files) ? req.body.files.slice(0, 10) : [];
    const stored = [];
    for (const f of files) {
      if (!f || !f.dataUrl) continue;
      try { stored.push(saveUploadFile(f.dataUrl, 'customs', f.fileName || '')); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }

    const wasPaid = entry.payStatus === 'paid';
    entry.payStatus = decision;
    entry.decisionNote = String(req.body.note || '').trim().slice(0, 500);
    entry.decidedBy = req.user._id;
    entry.decidedByName = who;
    entry.decidedAt = new Date();
    if (stored.length) entry.proofFiles = [...(entry.proofFiles || []), ...stored];

    // Paid writes the amount into its line in costs (see STAGE_COST).
    if (costFieldOf(entry.key)) applyPaidCosts(clearance, [entry.key], wasPaid || decision === 'paid');

    // Payment proof is also placed with the transaction papers, where someone who does not know which stage it came from will look (same rule as the entry attachment).
    for (const f of stored) {
      clearance.attachments.push({
        ...f, title: `إثبات دفع · ${entry.label || entry.key}`, stage: '',
        uploadedBy: req.user._id, uploadedByName: who, uploadedAt: new Date(),
      });
    }

    await clearance.save();
    try { cache.clear('customs:'); cache.clear('finance:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }

    // Respond before the tail work
    // Notification and audit are two database calls (90 ms each from the server) that the accountant should not wait on. The response returns the decision and both complete afterwards.
    res.json({ ok: true, clearanceId: String(clearance._id), entryId: String(entry._id), payStatus: decision });

    // The requester is told what became of the request, without opening the screen.
    try {
      const { createNotification } = require('../services/notificationService');
      const label = { paid: 'تمّ الدفع', returned: 'أُعيد للتصحيح', rejected: 'رُفض' }[decision];
      if (entry.addedBy && String(entry.addedBy) !== String(req.user._id)) {
        await createNotification({
          recipient: entry.addedBy,
          type: 'status_changed',
          title: `طلب صرف: ${label}`,
          message: `${clearance.refNumber || ''} · ${entry.label || entry.key}${entry.decisionNote ? ` — ${entry.decisionNote}` : ''}`,
          relatedEntity: 'CustomsClearance',
          relatedEntityId: clearance._id,
        });
      }
    } catch (_) { /* */ }

    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { after: { paymentDecision: decision, entry: String(entry._id) } }, ipAddress: req.ip,
    }).catch(() => { /* */ });
  } catch (e) {
    console.error('customs decidePaymentStage:', e);
    if (res.headersSent) return;
    res.status(500).json({ message: 'تعذّر تسجيل القرار' });
  }
};

// Payment stages: an entry with its date and attachment, repeatable
/** The stage a transaction cannot close without. Its key is read in code and its name is editable in section settings (see `customs_payment_stage` in lookupTypes). */
const REQUIRED_STAGE_KEY = 'transportInvoice';

/** Allowed stages as currently set in section settings. */
const allowedStages = async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'customs_payment_stage', deleted: { $ne: true } })
    .sort({ order: 1 }).lean();
  return rows;
};

/**
 * Add a stage entry: date, attachment and possibly an amount.
 * The attachment is written in two places: in the entry, to read in place in the stage, and in `attachments`, to be found with the other transaction papers by someone who does not know which stage it came from. It is one file on disk referenced twice, not two copies.
 */
/**
 * The three transport invoices in payment stages are two paths that never coexist:
 * port to customer  XOR  port to yard (then yard to customer).
 * If the first is recorded the other two are not; if "to yard" is recorded the first is not, and "yard to customer" becomes possible, never before it.
 */
const TRANSPORT_KEYS = { direct: 'transportPortToCustomer', toYard: 'transportPortToYard', fromYard: 'transportYardToCustomer' };
function transportBlock(clearance, key) {
  const has = (k) => (clearance.paymentStages || []).some((p) => p && p.key === k);
  if (key === TRANSPORT_KEYS.direct && (has(TRANSPORT_KEYS.toYard) || has(TRANSPORT_KEYS.fromYard))) {
    return 'سُجّل النقلُ عبر الساحة — لا تُسجَّل فاتورةُ النقل من الميناء إلى العميل معه';
  }
  if (key === TRANSPORT_KEYS.toYard && has(TRANSPORT_KEYS.direct)) {
    return 'سُجّلت فاتورةُ النقل من الميناء إلى العميل — لا يُسجَّل النقلُ إلى الساحة معها';
  }
  if (key === TRANSPORT_KEYS.fromYard) {
    if (has(TRANSPORT_KEYS.direct)) return 'سُجّلت فاتورةُ النقل من الميناء إلى العميل — لا يُسجَّل النقلُ من الساحة معها';
    if (!has(TRANSPORT_KEYS.toYard)) return 'سجّل فاتورةَ النقل من الميناء إلى الساحة أوّلًا';
  }
  return '';
}

exports.addPaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const stages = await allowedStages();
    const key = String(req.body.key || '').trim();
    const def = stages.find((s) => s.key === key);
    if (!def) return res.status(400).json({ message: 'مرحلة غير معروفة — أضِفها من إعدادات القسم' });
    const blocked = transportBlock(clearance, key);
    if (blocked) return res.status(400).json({ message: blocked, code: 'TRANSPORT_ROUTE' });
    if ((clearance.paymentStages || []).length >= 60) {
      return res.status(400).json({ message: 'بلغت المعاملةُ حدَّ إدخالات المراحل' });
    }

    const date = String(req.body.date || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'التاريخ غير صالح' });
    }

    let stored = null;
    if (req.body.dataUrl) {
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }
    if (!date && !stored) {
      return res.status(400).json({ message: 'اختر تاريخًا أو ارفع ملفًّا — الإدخال الفارغ لا يُسجَّل' });
    }
    // Amount is required for what is paid
    // The stage is a payment request to finance, and the cost line is written from it on payment. A request without an amount cannot be paid or written. (Correspondence entries have no amount.)
    const amountNum = req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : null;
    if (STAGE_COST[key] && !(Number.isFinite(amountNum) && amountNum > 0)) {
      return res.status(400).json({ message: 'اكتب المبلغ — مرحلةُ السداد طلبُ صرفٍ ولا تُضاف بلا مبلغ', code: 'AMOUNT_REQUIRED' });
    }

    const who = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || '';
    const entry = {
      key,
      label: def.nameAr || def.nameEn || key,
      date,
      amount: amountNum,
      note: String(req.body.note || '').trim().slice(0, 500),
      ...(stored || {}),
      addedBy: req.user._id,
      addedByName: who,
      addedAt: new Date(),
    };
    clearance.paymentStages.push(entry);

    if (stored) {
      clearance.attachments.push({
        ...stored,
        title: entry.label,
        stage: '',   // A payment stage is not one of `STAGES` (the procedure cycle), so it stays general.
        uploadedBy: req.user._id,
        uploadedByName: who,
        uploadedAt: new Date(),
      });
    }

    // Transport invoice arrived for an invoiced transaction? Then it is finished now; see settleClosure.
    if (TRANSPORT_STAGE_KEYS.includes(key) && stored) settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: 'add_customs_payment_stage', entity: 'CustomsClearance',
      entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, stage: entry.label, date, file: entry.fileName || '' } },
      ipAddress: req.ip,
    });
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.status(201).json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إضافة المرحلة');
  }
};

/** Edit an existing entry: its date, amount or note. */
exports.updatePaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = clearance.paymentStages.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });

    if (req.body.date !== undefined) {
      const d = String(req.body.date || '').trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ message: 'التاريخ غير صالح' });
      entry.date = d;
    }
    if (req.body.amount !== undefined) {
      const a = req.body.amount === '' || req.body.amount == null ? null : Number(req.body.amount);
      if (STAGE_COST[entry.key] && !(Number.isFinite(a) && a > 0)) {
        return res.status(400).json({ message: 'اكتب المبلغ — مرحلةُ السداد لا تبقى بلا مبلغ', code: 'AMOUNT_REQUIRED' });
      }
      entry.amount = a;
      // Amount of a paid stage changed? Its cost line follows.
      if (costFieldOf(entry.key) && entry.payStatus === 'paid') applyPaidCosts(clearance, [entry.key], true);
    }
    if (req.body.note !== undefined) entry.note = String(req.body.note).trim().slice(0, 500);

    // A new file replaces the old one, and the old one is deleted from disk so it is not orphaned.
    if (req.body.dataUrl) {
      let stored;
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const old = entry.fileUrl;
      Object.assign(entry, stored);
      clearance.attachments.push({
        ...stored,
        title: entry.label,
        stage: '',
        uploadedBy: req.user._id,
        uploadedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
        uploadedAt: new Date(),
      });
      if (old) {
        // Not deleted from disk if referenced in other attachments: the same file is referenced twice, and deleting it would empty the other line too.
        const stillUsed = clearance.attachments.some((a) => a.fileUrl === old)
          || clearance.paymentStages.some((p) => String(p._id) !== String(entry._id) && p.fileUrl === old);
        if (!stillUsed) { try { deleteStoredFile(old); } catch (e) { /* */ } }
      }
    }

    if (TRANSPORT_STAGE_KEYS.includes(entry.key) && req.body.dataUrl) settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تعديل المرحلة');
  }
};

/** Delete an entry; its paper is removed from the transaction attachments too (see deleteAttachment). */
exports.deletePaymentStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const entry = clearance.paymentStages.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'الإدخال غير موجود' });
    const label = entry.label;
    const urls = [entry.fileUrl, ...(entry.proofFiles || []).map((f) => f.fileUrl)].filter(Boolean);
    const paidKey = entry.payStatus === 'paid' && costFieldOf(entry.key) ? entry.key : '';
    entry.deleteOne();
    // Paid entry deleted? Its cost line returns to the sum of what remains paid.
    if (paidKey) applyPaidCosts(clearance, [paidKey], true);
    for (const a of clearance.attachments.filter((x) => urls.includes(x.fileUrl))) a.deleteOne();
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    dropIfUnused(clearance, urls);
    await logAudit({
      user: req.user._id, action: 'delete_customs_payment_stage', entity: 'CustomsClearance',
      entityId: clearance._id, changes: { before: { stage: label, files: urls.length } }, ipAddress: req.ip,
    });
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر حذف المرحلة');
  }
};

/**
 * Close the transaction, with the explicitly requested condition: it cannot close until the transport invoice has both a date and an attachment.
 * Closing removes it from follow-up lists, so closing without one hides unclaimed money until inventory.
 * The error states the reason plainly.
 */
/** Allowed customer invoice lines, from section settings (`customs_sale_item`). Read, not hard-coded: lines grow with the business, and adding one is a setting, not a release. */
const saleItemDefs = async () => {
  const Lookup = require('../models/Lookup');
  const rows = await Lookup.find({ type: 'customs_sale_item', isActive: { $ne: false } })
    .sort({ order: 1 }).lean().catch(() => []);
  if (rows.length) return rows.map((r) => ({ key: r.key, nameAr: r.nameAr, nameEn: r.nameEn }));
  // A transaction is not blocked from closing because the list was not seeded yet; the definition seed is read.
  const { REGISTRY } = require('../config/lookupTypes');
  const def = (REGISTRY || []).find((x) => x.type === 'customs_sale_item');
  return (def?.seed || []).map((r) => ({ key: r.key, nameAr: r.nameAr, nameEn: r.nameEn }));
};

/** New invoice number: a clearance-specific sequence ("CUS-1001") not confused with others. The largest issued is read and incremented; a number is never reused or changed once given. */
const nextSaleInvoiceNumber = async () => {
  const last = await CustomsClearance.find({ saleInvoiceNumber: /^CUS-\d+$/ })
    .sort({ saleInvoiceNumber: -1 }).limit(1).select('saleInvoiceNumber').lean();
  const prev = Number(String(last?.[0]?.saleInvoiceNumber || '').replace('CUS-', '')) || 1000;
  return `CUS-${prev + 1}`;
};

/**
 * GET /:id/invoice - the customer invoice computed from its lines.
 * Totals are not stored: they are derived on read; see utils/customsInvoice.
 */
exports.getClearanceInvoice = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id)
      .populate('customer', 'name nameEn vatNumber')
      .lean();
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const { buildClearanceInvoice } = require('../utils/customsInvoice');
    res.json({
      invoice: buildClearanceInvoice(clearance),
      saleItemDefs: await saleItemDefs(),
      clearance: {
        _id: clearance._id, refNumber: clearance.refNumber,
        customerName: clearance.customerName || clearance.customer?.name || '',
        declarationNumber: clearance.declarationNumber || '',
        billOfLading: clearance.billOfLading || '',
        containers: clearance.containers?.length || 0,
        isCompleted: clearance.isCompleted,
        completedAt: clearance.completedAt,
      },
    });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر بناء الفاتورة');
  }
};

/**
 * GET /invoices - customer invoices awaiting finance.
 * The list finance reads: closed transactions that have an invoice, with its lines and totals.
 */
exports.listClearanceInvoices = async (req, res) => {
  try {
    const f = { saleInvoiceNumber: { $gt: '' } };
    if (req.query.from || req.query.to) {
      f.saleInvoiceAt = {};
      if (req.query.from) f.saleInvoiceAt.$gte = new Date(req.query.from);
      if (req.query.to) f.saleInvoiceAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    if (req.query.customer) f.customerName = new RegExp(String(req.query.customer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = await CustomsClearance.find(f)
      .sort({ saleInvoiceAt: -1 })
      .limit(Math.min(500, Math.max(1, Number(req.query.limit) || 200)))
      .select('refNumber blNumber customerName declarationNumber billOfLading saleInvoiceNumber saleInvoiceAt saleVatRate saleItems paymentStages isCompleted completedAt cancelled transportInvoice transportInvoiceReceived')
      .lean();
    const { buildClearanceInvoice } = require('../utils/customsInvoice');
    const invoices = rows.map((c) => {
      const inv = buildClearanceInvoice(c);
      return {
        _id: c._id, refNumber: c.refNumber, customerName: c.customerName || '',
        declarationNumber: c.declarationNumber || '', billOfLading: c.billOfLading || '',
        invoiceNumber: c.saleInvoiceNumber, invoiceAt: c.saleInvoiceAt,
        completedAt: c.completedAt, isCompleted: !!c.isCompleted, blNumber: c.blNumber || '',
        // Invoiced but its transport invoice has not arrived: shown red in finance too.
        awaitingTransportInvoice: awaitsTransportInvoice(c),
        lines: inv.lines.length, passThrough: inv.passThrough, billed: inv.billed, totals: inv.totals,
      };
    });
    res.json({
      invoices,
      summary: invoices.reduce((a, i) => ({
        count: a.count + 1,
        net: Math.round((a.net + i.totals.net) * 100) / 100,
        vat: Math.round((a.vat + i.totals.vat) * 100) / 100,
        grand: Math.round((a.grand + i.totals.grand) * 100) / 100,
        awaitingTransportInvoice: a.awaitingTransportInvoice + (i.awaitingTransportInvoice ? 1 : 0),
      }), { count: 0, net: 0, vat: 0, grand: 0, awaitingTransportInvoice: 0 }),
    });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر تحميل الفواتير');
  }
};

const whoIs = (req) => [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || '';

/**
 * Finishing follows the transport invoice
 * A transaction whose invoice was issued and whose transport invoice arrived (or is stated as not expected) is finished: no work or awaited paper remains. It finishes the moment both hold, not through a third click that gets forgotten and leaves a finished transaction open.
 * Called before saving; returns whether it finished it.
 */
/** Has an invoicing request been sent (or actually invoiced)? The invoice-side condition for closing. */
const invoiceSent = (c) => !!c.saleInvoiceNumber || ['pending', 'invoiced'].includes(c.invoiceRequest?.status);

function settleClosure(clearance, req) {
  // Closes when the invoicing request is sent and the transport invoice arrives, without waiting for finance's answer: if closed before being invoiced it is closed-not-invoiced until finance decides.
  if (clearance.isCompleted || clearance.cancelled || !invoiceSent(clearance)) return false;
  // Payment stages play no part in closing: it closes on the invoicing request with its three lines (the transport invoice among them), not on the transport invoice payment stage.
  clearance.isCompleted = true;
  clearance.completedAt = new Date();
  clearance.completedBy = req.user._id;
  clearance.completedByName = whoIs(req);
  return true;
}

/** Writes the customer invoice lines from the request body. Returns the error text or null. */
async function writeSaleItems(clearance, sent, req) {
  const allowed = await saleItemDefs();
  const byKey = new Map(allowed.map((x) => [x.key, x]));
  const prev = new Map((clearance.saleItems || []).map((x) => [x.key, x]));
  const built = [];
  for (const raw of sent) {
    const key = String(raw?.key || '').trim();
    const def = byKey.get(key);
    if (!def) return `بندٌ غير معروف: «${key || '—'}»`;
    const amount = Number(raw?.amount);
    // A line without a price in an invoice going to finance is an amount claimed but unknown.
    if (!Number.isFinite(amount) || amount < 0) return `اكتب سعرَ «${def.nameAr}»`;
    const item = {
      key, label: def.nameAr || key, amount: Math.round(amount * 100) / 100,
      note: String(raw?.note || '').trim(),
      addedBy: req.user._id, addedByName: whoIs(req), addedAt: new Date(),
    };
    if (raw?.file) {
      try {
        const saved = saveUploadFile(raw.file, 'customs', raw.fileName || def.nameAr);
        Object.assign(item, { fileUrl: saved.fileUrl, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size });
        // The attachment is also placed with the other transaction papers: one place for all papers.
        clearance.attachments.push({
          title: `فاتورة العميل — ${item.label}`,
          fileUrl: saved.fileUrl, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size,
          uploadedBy: req.user._id, uploadedByName: whoIs(req), uploadedAt: new Date(),
        });
      } catch (err) { return `مرفقُ «${def.nameAr}»: ${err.message}`; }
    } else {
      // What was attached in an earlier issue stays: reissuing to correct a price does not drop papers.
      const old = prev.get(key);
      const src = raw?.fileUrl ? raw : old;
      if (src?.fileUrl) {
        Object.assign(item, {
          fileUrl: String(src.fileUrl), fileName: String(src.fileName || ''),
          mimeType: String(src.mimeType || ''), size: Number(src.size) || 0,
        });
      }
    }
    built.push(item);
  }
  clearance.saleItems = built;
  return null;
}

/**
 * PATCH /:id/invoice - issue the customer invoice (invoicing).
 * The transport invoice is not a precondition
 * Issuing used to wait for the transport invoice with its price and attachment. It is delayed at the carrier, delaying the whole customer invoice. Now the invoice is issued with what is known, goes to finance like any invoice, and the transaction stays flagged red as awaiting the transport invoice until attached, when it finishes.
 */
exports.issueInvoice = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (clearance.cancelled) return res.status(400).json({ message: 'المعاملةُ ملغاة — لا تُفوتَر' });
    if (clearance.upcoming) return res.status(400).json({ message: 'معاملةٌ قادمةٌ لم تبدأ — حوِّلها إلى جاريةٍ أوّلًا' });
    // What finance invoiced is not re-requested from here; its correction is on their side.
    if (clearance.saleInvoiceNumber) {
      return res.status(400).json({ message: `فوترتها الإدارةُ الماليّة (${clearance.saleInvoiceNumber}) — أيُّ تصحيحٍ يُطلَب منها`, code: 'ALREADY_INVOICED' });
    }

    const sent = Array.isArray(req.body.saleItems) ? req.body.saleItems : [];
    const err = await writeSaleItems(clearance, sent, req);
    if (err) return res.status(400).json({ message: err });
    // All three lines
    // Transport invoice, customs fees and appointment booking are all written at the selling price; they are unrelated to payment stages, which are what we pay while these are what we invoice.
    const defs = await saleItemDefs();
    const missing = defs.filter((d) => !clearance.saleItems.some((x) => x.key === d.key));
    if (missing.length) return res.status(400).json({ message: `اكتب سعرَ: ${missing.map((d) => d.nameAr).join('، ')}`, code: 'SALE_ITEMS_REQUIRED' });
    const hasPassThrough = (clearance.paymentStages || []).some((p) => Number(p.amount) > 0);
    if (!clearance.saleItems.length && !hasPassThrough) {
      return res.status(400).json({ message: 'طلبُ فوترةٍ بلا بنود — اكتب سعرَ بندٍ واحدٍ على الأقلّ' });
    }
    clearance.saleVatRate = 0.15;

    // An invoicing request to finance, not an invoice
    // Finance invoices it in its own system and says here that invoicing is done; only then is it counted as invoiced. See decideInvoiceRequest.
    const ir = clearance.invoiceRequest || {};
    const again = ['pending', 'returned', 'rejected'].includes(ir.status);
    clearance.invoiceRequest = {
      status: 'pending',
      requestedAt: new Date(), requestedBy: req.user._id, requestedByName: whoIs(req),
      note: String(req.body.note || '').trim().slice(0, 500),
      decidedAt: null, decidedBy: null, decidedByName: '', decisionNote: '',
      fileUrl: '', fileName: '', mimeType: '', size: 0,
    };

    const closed = settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: closed ? 'complete_customs_clearance' : 'invoice_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { details: `${again ? 'إعادة طلب' : 'طلب'} فوترة · ${clearance.refNumber || ''}`, after: { refNumber: clearance.refNumber, invoiceRequest: 'pending', closed } }, ipAddress: req.ip,
    });
    cache.clear('customs:'); try { cache.clear('finance:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance, closed, requested: true, awaitingTransportInvoice: false });

    // Finance is notified of the request, without waiting for the screen to be opened.
    try {
      const User = require('../models/User');
      const { createNotification } = require('../services/notificationService');
      const fin = await User.find({ role: { $in: ['cfo', 'accounting_manager', 'accountant'] }, isActive: { $ne: false } }).select('_id').lean();
      await Promise.all(fin.map((u) => createNotification({
        recipient: u._id, type: 'status_changed',
        title: 'طلب فوترة — تخليص جمركي',
        message: `${clearance.refNumber || ''} · ${clearance.customerName || ''}`,
        relatedEntity: 'CustomsClearance', relatedEntityId: clearance._id,
      }).catch(() => {})));
    } catch (_) { /* */ }
  } catch (error) {
    if (res.headersSent) return;
    return sendMongooseError(res, error, 'تعذّر إرسال طلب الفوترة');
  }
};

/**
 * PATCH /:id/invoice-request/decision - finance's answer on the invoicing request.
 * { decision: 'invoiced', invoiceNumber?, file?: {dataUrl, fileName}, note? }
 * { decision: 'returned' | 'rejected', note }
 * Only the invoiced decision makes the transaction invoiced: the invoice number (from finance, else our sequential number), the final invoice in the transaction attachments, and the invoice stage.
 */
exports.decideInvoiceRequest = async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    if (!['invoiced', 'returned', 'rejected'].includes(decision)) return res.status(400).json({ message: 'قرارٌ غير معروف' });
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const ir = clearance.invoiceRequest || {};
    if (ir.status !== 'pending') return res.status(400).json({ message: 'لا طلبَ فوترةٍ معلّقًا على هذه المعاملة' });
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (decision !== 'invoiced' && !note) return res.status(400).json({ message: 'اكتب السبب ليعرف التخليصُ ما يصحّح' });
    const who = whoIs(req);

    let stored = null;
    if (decision === 'invoiced' && req.body.file?.dataUrl) {
      try { stored = saveUploadFile(req.body.file.dataUrl, 'customs', req.body.file.fileName || 'الفاتورة النهائية'); }
      catch (e) { return res.status(400).json({ message: e.message }); }
    }
    Object.assign(clearance.invoiceRequest, {
      status: decision, decidedAt: new Date(), decidedBy: req.user._id, decidedByName: who, decisionNote: note,
      ...(stored || {}),
    });

    let closed = false;
    if (decision === 'invoiced') {
      const given = String(req.body.invoiceNumber || '').trim().slice(0, 60);
      clearance.saleInvoiceNumber = given || await nextSaleInvoiceNumber();
      clearance.saleInvoiceAt = new Date();
      const { todayKey } = require('../utils/companyDay');
      if (!clearance.billing) clearance.billing = {};
      clearance.billing.invoiceStatus = 'مفوترة';
      clearance.billing.ourInvoiceNumber = clearance.saleInvoiceNumber;
      clearance.billing.invoicedAt = todayKey();
      if (stored) {
        clearance.attachments.push({
          ...stored, title: `الفاتورة النهائية · ${clearance.saleInvoiceNumber}`, stage: '',
          uploadedBy: req.user._id, uploadedByName: who, uploadedAt: new Date(),
        });
      }
      const { done, route } = readStages(clearance);
      done.add('invoiced');
      clearance.stagesDone = CustomsClearance.STAGES.filter((k) => done.has(k));
      clearance.transportRoute = route;
      if (!(clearance.pipelineVersion >= 2)) clearance.pipelineVersion = 2;
      clearance.stage = 'invoiced';
      clearance.stageLog.push({ key: 'invoiced', done: true, by: req.user._id, byName: who, at: new Date() });
      closed = settleClosure(clearance, req);
    }
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    cache.clear('customs:'); try { cache.clear('finance:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }
    res.json({ ok: true, clearance, closed });

    try {
      const { createNotification } = require('../services/notificationService');
      const label = { invoiced: 'تمّت الفوترة', returned: 'أُعيد للتصحيح', rejected: 'رُفض' }[decision];
      if (ir.requestedBy && String(ir.requestedBy) !== String(req.user._id)) {
        await createNotification({
          recipient: ir.requestedBy, type: 'status_changed',
          title: `طلب الفوترة: ${label}`,
          message: `${clearance.refNumber || ''}${decision === 'invoiced' ? ` · ${clearance.saleInvoiceNumber}` : ''}${note ? ` — ${note}` : ''}`,
          relatedEntity: 'CustomsClearance', relatedEntityId: clearance._id,
        });
      }
    } catch (_) { /* */ }
    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id,
      changes: { details: `طلب الفوترة: ${decision}${clearance.saleInvoiceNumber ? ` · ${clearance.saleInvoiceNumber}` : ''}`, after: { invoiceRequest: decision } }, ipAddress: req.ip,
    }).catch(() => {});
  } catch (e) {
    console.error('customs decideInvoiceRequest:', e);
    if (res.headersSent) return;
    res.status(500).json({ message: 'تعذّر تسجيل القرار' });
  }
};

/** GET /invoice-requests?status=pending|invoiced|returned|rejected|all - invoicing requests. */
exports.listInvoiceRequests = async (req, res) => {
  try {
    const status = ['pending', 'invoiced', 'returned', 'rejected', 'all'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
    const match = { cancelled: { $ne: true }, 'invoiceRequest.status': status === 'all' ? { $in: ['pending', 'invoiced', 'returned', 'rejected'] } : status };
    const rows = await CustomsClearance.find(match)
      .select(`refNumber blNumber customerName branch port isCompleted invoiceRequest saleInvoiceNumber saleInvoiceAt containerCount ${require('../utils/customsInvoice').MONEY_SELECT} costs revenue`)
      .sort({ 'invoiceRequest.requestedAt': -1 }).limit(300).lean();
    const { buildClearanceInvoice } = require('../utils/customsInvoice');
    const agg = await CustomsClearance.aggregate([
      { $match: { cancelled: { $ne: true }, 'invoiceRequest.status': { $in: ['pending', 'invoiced', 'returned', 'rejected'] } } },
      { $group: { _id: '$invoiceRequest.status', n: { $sum: 1 } } },
    ]);
    const counts = { pending: 0, invoiced: 0, returned: 0, rejected: 0 };
    for (const a of agg) counts[a._id] = a.n;
    res.json({
      counts,
      requests: rows.map((c) => {
        const inv = buildClearanceInvoice(c);
        return {
          clearanceId: String(c._id), refNumber: c.refNumber, blNumber: c.blNumber, customerName: c.customerName,
          branch: c.branch, port: c.port, isCompleted: !!c.isCompleted, containerCount: c.containerCount,
          ...c.invoiceRequest, invoiceNumber: c.saleInvoiceNumber || '',
          total: inv.totals.grand, vat: inv.totals.vat, lines: inv.lines.map((l) => ({ label: l.label, amount: l.amount, vat: l.vat, total: l.total, from: l.from, fileUrl: l.fileUrl })),
        };
      }),
    });
  } catch (e) {
    console.error('customs listInvoiceRequests:', e);
    res.status(500).json({ message: 'تعذّر تحميل طلبات الفوترة' });
  }
};

/** Count of items awaiting finance in clearance: pending payment requests plus pending invoicing requests. */
exports.financePendingCount = async () => {
  const [pay] = await CustomsClearance.aggregate([
    { $match: { cancelled: { $ne: true }, 'paymentStages.payStatus': 'pending' } },
    { $unwind: '$paymentStages' },
    { $match: { 'paymentStages.payStatus': 'pending' } },
    { $count: 'n' },
  ]);
  const inv = await CustomsClearance.countDocuments({ cancelled: { $ne: true }, 'invoiceRequest.status': 'pending' });
  return { payments: pay?.n || 0, invoices: inv, total: (pay?.n || 0) + inv };
};

/**
 * POST /:id/transport-invoice - the transport invoice arrived (or is not expected).
 * { dataUrl, fileName, date? }      attached and shown in transaction attachments
 * { notRequired: true, note? }      moved with company vehicles, no carrier invoice
 * When the transaction is already invoiced it finishes immediately.
 */
exports.receiveTransportInvoice = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    if (!clearance.transportInvoice) clearance.transportInvoice = {};
    const t = clearance.transportInvoice;
    if (req.body.notRequired === true) {
      t.notRequired = true;
      t.note = String(req.body.note || '').trim().slice(0, 300);
    } else {
      if (!req.body.dataUrl) return res.status(400).json({ message: 'أرفِق فاتورةَ النقل' });
      const date = String(req.body.date || '').trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'التاريخ غير صالح' });
      let stored;
      try { stored = saveUploadFile(req.body.dataUrl, 'customs', req.body.fileName || 'فاتورة النقل'); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const old = t.fileUrl;
      Object.assign(t, stored, { date, notRequired: false });
      for (const a of clearance.attachments.filter((x) => old && x.fileUrl === old)) a.deleteOne();
      clearance.attachments.push({
        ...stored, title: 'فاتورة النقل', stage: '',
        uploadedBy: req.user._id, uploadedByName: whoIs(req), uploadedAt: new Date(),
      });
      if (old) dropIfUnused(clearance, [old]);
    }
    t.receivedAt = new Date(); t.receivedBy = req.user._id; t.receivedByName = whoIs(req);
    const closed = settleClosure(clearance, req);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: closed ? 'complete_customs_clearance' : 'update_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, transportInvoice: t.notRequired ? 'not required' : t.fileName } }, ipAddress: req.ip,
    });
    cache.clear('customs:'); try { cache.clear('finance:'); } catch (_) { /* */ }
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance, closed });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر حفظ فاتورة النقل');
  }
};

/**
 * PATCH /:id/complete — close or reopen ({ completed: false }).
 * Closing needs no invoice: a closed file without one is "closed, not invoiced",
 * and its invoice request can be sent from inside it later (issueInvoice).
 */
exports.completeClearance = async (req, res) => {
  try {
    // An old app sends the lines with the close: that is issuing an invoice.
    if (req.body.completed !== false && Array.isArray(req.body.saleItems)) return exports.issueInvoice(req, res);

    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });

    const reopen = req.body.completed === false;
    if (reopen) {
      clearance.isCompleted = false;
      clearance.completedAt = null;
      clearance.completedBy = null;
      clearance.completedByName = '';
    } else {
      if (clearance.cancelled) return res.status(400).json({ message: 'المعاملةُ ملغاة — لا تُغلَق' });
      if (clearance.upcoming) return res.status(400).json({ message: 'معاملةٌ قادمةٌ لم تبدأ — حوِّلها إلى جاريةٍ أوّلًا' });
      if (clearance.isCompleted) return res.json({ clearance });
      clearance.isCompleted = true;
      clearance.completedAt = new Date();
      clearance.completedBy = req.user._id;
      clearance.completedByName = whoIs(req);
    }

    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: reopen ? 'reopen_customs_clearance' : 'complete_customs_clearance',
      entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber } }, ipAddress: req.ip,
    });
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });
  } catch (error) {
    return sendMongooseError(res, error, 'تعذّر إنهاء المعاملة');
  }
};

/**
 * PATCH /:id/stage - mark a stage or clear its flag. { key, done }
 * Rules live here, not in the screen: the two port stages are mutually exclusive (marking one closes the other);
 * stages not on the transaction path are locked (no unloading when moved straight to the customer, no container return for vehicles);
 * invoice issuing is marked by issuing it, not by hand.
 */
exports.setStage = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const key = String(req.body.key || '');
    if (!CustomsClearance.STAGES.includes(key)) return res.status(400).json({ message: 'مرحلةٌ غير معروفة' });
    const on = req.body.done !== false;
    if (key === 'invoiced') {
      return res.status(400).json({ message: 'هذه المرحلةُ تُعلَّم بإصدار الفاتورة — من «إصدار الفاتورة» أعلى الصفحة.', code: 'STAGE_AUTO' });
    }

    const before = clearance.stage;
    const read = readUnits(clearance);
    let { done, route } = read;
    const cargo = clearance.cargoType;
    let unitNote = '';

    if (UNIT_STAGES.includes(key) && read.units) {
      // Unit stage: for one container, or for all
      // `unit` is the slot number (from zero) or 'all'. Absence means all, so an app unaware of units marks the whole transaction as before.
      const all = req.body.unit === undefined || req.body.unit === null || req.body.unit === 'all';
      const idx = all ? -1 : Number(req.body.unit);
      if (!all && !(Number.isInteger(idx) && idx >= 0 && idx < read.units.length)) {
        return res.status(400).json({ message: 'وحدةٌ غير موجودةٍ في هذه المعاملة' });
      }
      const units = read.units.map((u) => ({ route: u.route, done: new Set(u.done) }));
      const targets = all ? units : [units[idx]];
      const touched = new Set();
      let applied = 0; let refusal = '';
      for (const u of targets) {
        if (on) {
          // The path is switched with one click: the first one's flag and what was built on it are cleared, and the second is marked.
          if (PORT_LEGS.includes(key) && u.route && lockReason(key, u.route, cargo)) {
            for (const k of ['transport_to_yard', 'transport_to_customer', 'unloaded_stored', 'yard_to_customer']) u.done.delete(k);
            u.route = '';
          }
          const reason = lockReason(key, u.route, cargo);
          if (reason) { refusal = reason; continue; }
          if (!u.done.has(key)) touched.add(u);
          u.done.add(key);
          if (PORT_LEGS.includes(key)) u.route = key === 'transport_to_yard' ? 'yard' : 'customer';
        } else {
          u.done.delete(key);
          if (PORT_LEGS.includes(key)) { u.route = ''; u.done.delete('unloaded_stored'); u.done.delete('yard_to_customer'); }
        }
        applied += 1;
      }
      if (!applied) return res.status(400).json({ message: `هذه المرحلةُ غيرُ متاحة: ${refusal}`, code: 'STAGE_LOCKED' });

      // Each unit's stages are written in its slot, along with what was on the whole transaction.
      const { todayKey } = require('../utils/companyDay');
      const rows = syncUnits(clearance.containers, Math.max(Number(clearance.containerCount) || 0, units.length));
      units.forEach((u, i) => {
        rows[i].route = u.route;
        rows[i].stagesDone = UNIT_STAGES.filter((k) => u.done.has(k));
        // A return just marked without a date is dated today.
        if (on && key === 'containers_returned' && touched.has(u) && !rows[i].returnDate) rows[i].returnDate = todayKey();
      });
      clearance.containers = rows;
      clearance.containerCount = rows.length;
      for (const k of UNIT_STAGES) done.delete(k);
      const routes = [...new Set(units.map((u) => u.route))];
      route = routes.length === 1 ? routes[0] : '';
      clearance.stagesDone = CustomsClearance.STAGES.filter((k) => done.has(k));
      clearance.transportRoute = route;
      clearance.pipelineVersion = 3;
      clearance.stage = key;
      unitNote = all ? 'all' : String(idx);
    } else {
      const isPortLeg = PORT_LEGS.includes(key);
      if (on) {
        // The path is switched with one click; see above.
        if (isPortLeg && route && lockReason(key, route, cargo)) {
          for (const k of ['transport_to_yard', 'transport_to_customer', 'unloaded_stored', 'yard_to_customer']) done.delete(k);
          route = '';
        }
        const reason = lockReason(key, route, cargo);
        if (reason) return res.status(400).json({ message: `هذه المرحلةُ غيرُ متاحة: ${reason}`, code: 'STAGE_LOCKED' });
        done.add(key);
        if (isPortLeg) route = key === 'transport_to_yard' ? 'yard' : 'customer';
      } else {
        done.delete(key);
        // Clearing the path flag reopens the choice, and what was built on it goes with it.
        if (isPortLeg) { route = ''; done.delete('unloaded_stored'); done.delete('yard_to_customer'); }
      }
      // Transaction stage (pre-transport) on a transaction with units: what is on the units stays where it is, either written on them (3) or inherited from the transaction (fewer).
      const keepUnits = read.units && clearance.pipelineVersion !== 3;
      const legacy = keepUnits ? readStages(clearance).done : null;
      clearance.stagesDone = CustomsClearance.STAGES.filter((k) => done.has(k) || (legacy && UNIT_STAGES.includes(k) && legacy.has(k)));
      if (!read.units || keepUnits) clearance.transportRoute = keepUnits ? readStages(clearance).route : route;
      if (!(clearance.pipelineVersion >= 2)) clearance.pipelineVersion = 2;
      // Where it is now: what was just marked, or the last one still marked if a flag was cleared.
      const lastDone = [...CustomsClearance.STAGES].reverse().find((k) => done.has(k) && !lockReason(k, route, cargo));
      clearance.stage = on ? key : (lastDone || 'papers_received');
    }
    clearance.stageLog.push({ key: unitNote ? `${key}#${unitNote}` : key, done: on, by: req.user._id, byName: whoIs(req), at: new Date() });
    if (clearance.stageLog.length > 300) clearance.stageLog = clearance.stageLog.slice(-300);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    cache.clear('customs:');

    await logAudit({ user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { refNumber: clearance.refNumber, stage: key, done: on } }, ipAddress: req.ip });
    try { emitToAll('customs:updated', { clearance }); } catch (e) {}
    res.json({ clearance });

    // The transaction's creator is notified of its progress, unless they made the mark.
    if (on && before !== clearance.stage && clearance.createdBy && String(clearance.createdBy) !== String(req.user._id)) {
      try {
        const { CUSTOMS_STAGE_AR } = require('../config/customsStages');
        await createNotification({
          recipient: clearance.createdBy, type: 'status_changed', title: 'تحديث معاملة تخليص',
          message: `${clearance.blNumber || clearance.refNumber} — ${CUSTOMS_STAGE_AR[key] || key}`,
          relatedEntity: 'CustomsClearance', relatedEntityId: clearance._id,
        });
      } catch (e) { /* Notification is extra */ }
    }
  } catch (error) {
    if (res.headersSent) return undefined;
    return sendMongooseError(res, error, 'تعذّر تعليم المرحلة');
  }
};

/** GET /release-sheets?numbers=a,b - which release sheet numbers exist in the operations workflow. The number is typed in the container slot when moved by a company vehicle and equals `reportNumber` there, so the employee is told at once whether it is linked. */
exports.releaseSheets = async (req, res) => {
  try {
    const numbers = [...new Set(String(req.query.numbers || '').split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 300);
    if (!numbers.length) return res.json({ found: {} });
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const rows = await OperationsWorkflow.find({ reportNumber: { $in: numbers } }).select('reportNumber').lean();
    res.json({ found: Object.fromEntries(rows.map((r) => [r.reportNumber, String(r._id)])) });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر التحقّق من كشوف التخريج' });
  }
};

/**
 * GET /:id/ops-reports - linked operations reports.
 * Every release sheet linked to this transaction (transport slots, document matching its bill of lading or container, or manual link), with invoicing and collection progress. Numbers typed in transport slots whose sheet has not arrived are listed in `pendingRefs`.
 * Each sheet carries `detail`, as the role sees it in the workflow (`stripRowFor`). Editing goes through `PUT /api/workflows/:id`; `access` says which fields are editable.
 */
exports.getOpsReports = async (req, res) => {
  try {
    const OperationsWorkflow = require('../models/OperationsWorkflow');
    const CollectionInvoice = require('../models/CollectionInvoice');
    const clearance = await CustomsClearance.findById(req.params.id)
      .select('refNumber blNumber containers.containerNumber containers.moves containers.returnRef containers.returnVehicleKind').lean();
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const wfc = require('./workflowController');
    // The whole sheet is read then masked by the workflow's own rule (`stripRowFor`), not a list written here that would drift from it.
    const rows = await OperationsWorkflow.find({ 'customsLink.clearance': clearance._id })
      .select(`${wfc.FULL_FIELDS.join(' ')} cashCollectionStatus sellingValueSource customsLink stage lockedBy lockedByName lockedAt updatedAt`)
      .sort({ reportDate: 1, reportNumber: 1 }).lean();

    // Tax invoice status from the collections ledger first, which is what the section works on.
    const nos = [...new Set(rows.map((r) => String(r.invoiceNumber || '').trim()).filter(Boolean))];
    const ledger = nos.length ? await CollectionInvoice.find({ invoiceNumber: { $in: nos } }).select('invoiceNumber status collectedAmount total').lean() : [];
    const ledgerOf = new Map(ledger.map((i) => [String(i.invoiceNumber).trim(), i]));
    const NO_INV = /^\s*(no\s*inv|بدون|لا\s*يوجد|-|—)\s*$/i;

    // Amounts follow the workflow rule, not the section rule
    // The amount used to be shown to the section's money roles (MONEY_ROLES), so the clearance manager saw the selling value while it is hidden from them in the workflow itself (SELLING_ROLES). It is one sheet: what a role cannot see there it cannot see here.
    const role = req.user.role;
    const money = wfc.canSeeMoney(role);
    const selling = wfc.canSeeSelling(role);
    const write = await wfc.canWriteWorkflows(role);
    const ids = rows.map((r) => String(r._id));
    const att = require('./collectionsAttachmentsController');
    const [fuCounts, cashAtt, taxAtt] = await Promise.all([
      require('./workflowFollowUpController').countsFor(ids),
      att.countsFor('cash', rows.filter((r) => r.paymentType === 'cash').map((r) => String(r._id))),
      att.countsFor('tax', nos),
    ]);
    const DETAIL = new Set([...wfc.FULL_FIELDS, 'stage', 'lockedByName', 'lockedAt', 'updatedAt', 'sellingValueSource']);
    const detailOf = (r) => {
      const plain = wfc.stripRowFor(role, { ...r });
      const out = {};
      for (const k of Object.keys(plain)) if (DETAIL.has(k)) out[k] = plain[k];
      out.lockedBy = r.lockedBy ? String(r.lockedBy) : null;
      return out;
    };
    const reports = rows.map((r) => {
      const no = String(r.invoiceNumber || '').trim();
      const cash = r.paymentType === 'cash';
      const led = no ? ledgerOf.get(no) : null;
      const collected = !!r.collectionDate || r.cashCollectionStatus === 'collected' || (led && /collected/i.test(led.status || ''));
      // Four states read as one word: collected, invoiced not collected, cash not collected, not invoiced.
      const billing = collected ? 'collected' : cash ? 'cash_pending' : (no && !NO_INV.test(no)) ? 'invoiced' : 'not_invoiced';
      return {
        _id: String(r._id),
        reportNumber: r.reportNumber || '',
        reportDate: r.reportDate || null,
        route: [r.fromLocation, r.toLocation].filter(Boolean).join(' — '),
        carNumber: r.carNumber || '',
        driverName: r.driverName || '',
        customer: r.username || '',
        applicationStatus: r.applicationStatus || '',
        paymentType: r.paymentType || '',
        invoiceNumber: cash ? '' : no,
        invoiceDate: r.invoiceDate || null,
        deliveryDate: r.deliveryDate || null,
        collectionDate: r.collectionDate || null,
        billing,
        via: (r.customsLink && r.customsLink.via) || '',
        containers: (r.customsLink && r.customsLink.containers) || [],
        executionStatus: r.executionStatus || '',
        paymentSubtype: r.paymentSubtype || '',
        documentNumber: r.documentNumber || '',
        followUps: fuCounts.get(String(r._id)) || 0,
        attachments: cash ? (cashAtt.get(String(r._id)) || 0) : (no ? (taxAtt.get(no) || 0) : 0),
        ...(selling ? { sellingValue: Number(r.sellingValue) || 0 } : {}),
        ...(money ? { totalInvoice: Number(r.totalInvoice) || 0 } : {}),
        // The whole sheet as this role sees it in the workflow, for the opened row and for editing.
        detail: detailOf(r),
      };
    });

    // Numbers typed in transport slots for a company vehicle whose sheet has not arrived.
    const written = new Set();
    for (const u of clearance.containers || []) {
      for (const m of u.moves || []) if (m && m.vehicleKind === 'energize' && String(m.ref || '').trim()) written.add(String(m.ref).trim());
      if (u.returnVehicleKind === 'energize' && String(u.returnRef || '').trim()) written.add(String(u.returnRef).trim());
    }
    const have = new Set(rows.map((r) => String(r.reportNumber || '').trim()));
    const missing = [...written].filter((n) => !have.has(n));
    // Ones that exist but are not linked to this transaction (operations linked them to another by hand) are reported too.
    const elsewhere = missing.length
      ? await OperationsWorkflow.find({ reportNumber: { $in: missing } }).select('reportNumber customsLink').lean()
      : [];
    const elsewhereOf = new Map(elsewhere.map((w) => [String(w.reportNumber).trim(), w]));
    const pendingRefs = missing.map((n) => {
      const w = elsewhereOf.get(n);
      return w
        ? { reportNumber: n, state: 'linked_elsewhere', workflowId: String(w._id), otherRef: (w.customsLink && w.customsLink.refNumber) || '' }
        : { reportNumber: n, state: 'not_arrived' };
    });

    const count = (k) => reports.filter((r) => r.billing === k).length;
    // Linked shipment orders
    // By the bill of lading or container written on the shipment, or by its number in the container transport slot; services/customsOpsLink.resolveShipments. Shown read-only and the order opens from them.
    const ShipmentOrder = require('../models/ShipmentOrder');
    const shipmentOrders = (await ShipmentOrder.find({ 'customsLink.clearance': clearance._id })
      .select('waybillNumber reference graduationNumber source customerName fromCity toCity status driverName vehiclePlate pickupTime blNumber containerNumber customsLink createdAt')
      .sort({ createdAt: 1 }).lean())
      .map((o) => ({
        _id: String(o._id),
        ref: String(o.reference || o.waybillNumber || ''),
        source: o.source, customerName: o.customerName || '', fromCity: o.fromCity || '', toCity: o.toCity || '',
        status: o.status, driverName: o.driverName || '', vehiclePlate: o.vehiclePlate || '', pickupTime: o.pickupTime || null,
        blNumber: o.blNumber || '', containerNumber: o.containerNumber || '', via: (o.customsLink && o.customsLink.via) || '',
      }));
    res.json({
      reports,
      pendingRefs,
      shipmentOrders,
      summary: {
        total: reports.length,
        collected: count('collected'), invoiced: count('invoiced'),
        cashPending: count('cash_pending'), notInvoiced: count('not_invoiced'),
        ...(selling ? {
          selling: Math.round(reports.reduce((a, r) => a + (r.sellingValue || 0), 0) * 100) / 100,
        } : {}),
      },
      // What can be edited on the sheet from here: the fields `PUT /api/workflows/:id` accepts from this role, and whether the role reaches them at all (the operations section guard). Saving happens there.
      access: { canEdit: write.canEdit, fields: write.canEdit ? write.fields : [], money, selling },
    });
  } catch (e) {
    console.error('customs ops reports', e);
    res.status(500).json({ message: 'تعذّر تحميل كشوف التشغيل المرتبطة' });
  }
};

module.exports.REQUIRED_STAGE_KEY = REQUIRED_STAGE_KEY;


// Section dashboard: operations, not profit
/**
 * GET /dashboard - what the team needs to work: upcoming, open and closed counts, where each stands, customers, transactions awaiting transport invoice, and per-member activity. No financial number: profit is in clearance analytics, for management only.
 * Filters: customerParty, agentParty, carrierParty, branch, cargoType, member (creator), from/to (creation date); each card is computed on what remains after them.
 * Rows are sent with the numbers so a card click filters the table below with no second call.
 */
/** Applies multi-value quick filters to an in-memory list, and computes each filter's values and counts under all filters except its own, like the HR filters. */
function applyQuick(list, defs, q) {
  const picked = Object.fromEntries(defs.map((f) => [f.key, String(q[f.key] || '').split(',').map((x) => x.trim()).filter(Boolean)]));
  const passes = (r, skip) => defs.every((f) => f.key === skip || !picked[f.key].length || picked[f.key].includes(f.get(r)));
  const filters = defs.map((f) => {
    const m = new Map();
    for (const r of list) { if (!passes(r, f.key)) continue; const v = f.get(r); if (!v) continue; m.set(v, (m.get(v) || 0) + 1); }
    return { key: f.key, values: [...m.entries()].map(([value, count]) => ({ value, count, label: f.label ? f.label(value) : value })).sort((a, b) => b.count - a.count) };
  });
  return { list: list.filter((r) => passes(r, null)), filters };
}

/** Section dashboard quick filters: key and value from the dashboard row, plus the display name. */
function dashQuickFilters() {
  const STATE = { upcoming: 'قادمة', open: 'مفتوحة', closedInvoiced: 'مغلقة مفوترة', closedNotInvoiced: 'مغلقة لم تُفوتَر', cancelled: 'ملغاة' };
  const INV = { invoiced: 'مفوترة', requested: 'طلب فوترة عند المالية', returned: 'أُعيد طلب الفوترة', rejected: 'رُفض طلب الفوترة', none: 'لم تُفوتَر' };
  return [
    { key: 'qState', get: (r) => (r.bucket === 'closed' ? (r.invoiced ? 'closedInvoiced' : 'closedNotInvoiced') : r.bucket), label: (v) => STATE[v] || v },
    { key: 'qInvoice', get: (r) => (r.bucket === 'cancelled' ? '' : r.invoiced ? 'invoiced' : r.invoiceRequest === 'pending' ? 'requested' : ['returned', 'rejected'].includes(r.invoiceRequest) ? r.invoiceRequest : 'none'), label: (v) => INV[v] || v },
    { key: 'qCustomer', get: (r) => r.customerName || '' },
    { key: 'qAgent', get: (r) => r.shippingAgent || '' },
    { key: 'qCarrier', get: (r) => r.carrierName || '' },
    { key: 'qPort', get: (r) => r.port || '' },
    { key: 'qBranch', get: (r) => r.branch || '', label: (v) => (v === 'dammam' ? 'الدمام' : v === 'jeddah' ? 'جدة' : v) },
    { key: 'qCargo', get: (r) => r.cargoType, label: (v) => (v === 'vehicles' ? 'سيّارات' : 'حاويات') },
    { key: 'qStage', get: (r) => (r.bucket === 'open' ? (r.nextLabel || 'اكتملت مراحلُها — تنتظر الإنهاء') : '') },
    { key: 'qBy', get: (r) => r.createdByName || '' },
    { key: 'qMonth', get: (r) => String(r.date || '').slice(0, 7) },
  ];
}

exports.getDashboard = async (req, res) => {
  try {
    const q = req.query || {};
    const mongoose = require('mongoose');
    const { todayKey, startOfDay, DAY_MS } = require('../utils/companyDay');
    const { stageLabel } = require('../config/customsStages');
    const User = require('../models/User');
    const { JpTask } = require('../models/JpModels');
    const { JP_SECTIONS } = require('../config/jpSections');
    const jp = JP_SECTIONS.customs;
    const isManager = require('../config/constants').isTopRole(req.user.role) || jp.managerRoles.includes(req.user.role);

    const filter = {};
    for (const k of ['customerParty', 'agentParty', 'carrierParty']) {
      if (q[k] && mongoose.isValidObjectId(q[k])) filter[k] = q[k];
    }
    if (q.branch === 'jeddah' || q.branch === 'dammam') filter.branch = q.branch;
    if (CARGO_TYPES.includes(q.cargoType)) filter.cargoType = q.cargoType === 'vehicles' ? 'vehicles' : { $ne: 'vehicles' };
    if (q.member && mongoose.isValidObjectId(q.member)) filter.createdBy = q.member;
    // The range is measured on the transaction date (txDateOf) after reading, not on the entry day.
    const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    const dFrom = ymd(q.from); const dTo = ymd(q.to);

    const ck = `customs:dash:${isManager ? 'm' : String(req.user._id)}:${JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]]))}`;
    const body = await cache.wrap(ck, 30000, async () => {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const oid = (v) => new mongoose.Types.ObjectId(String(v));
      const aggMatch = { ...filter };
      for (const k of ['customerParty', 'agentParty', 'carrierParty', 'createdBy']) if (aggMatch[k]) aggMatch[k] = oid(aggMatch[k]);
      // The creator filter is not applied to team activity: activity is read per member.
      const actMatch = { ...aggMatch }; delete actMatch.createdBy;
      const act = (path, by, at) => CustomsClearance.aggregate([
        { $match: { ...actMatch, [`${path}.0`]: { $exists: true } } },
        { $project: { [path]: 1 } }, { $unwind: `$${path}` },
        { $match: { [`${path}.${at}`]: { $gte: since } } },
        { $group: { _id: `$${path}.${by}`, n: { $sum: 1 }, last: { $max: `$${path}.${at}` } } },
      ]);
      const jpVisible = { scope: 'section', section: 'customs' };
      if (!isManager) jpVisible.$or = [{ assignedTo: req.user._id }, { createdBy: req.user._id }];

      const [rows, users, notes, pays, ticks, pendingPay, tasks, ended] = await Promise.all([
        CustomsClearance.find(filter)
          .select('refNumber blNumber customerName customerParty shippingAgent agentParty carrierName carrierParty branch cargoType containerCount '
            + 'containers.route containers.stagesDone stage stagesDone transportRoute pipelineVersion stageDone.doInvoicePaid stageDone.containersReturned saleInvoiceNumber saleInvoiceAt '
            + 'transportInvoiceReceived isCompleted completedAt completedBy cancelled upcoming expectedDate returnDeadline createdAt createdBy updatedAt declarationNumber port '
            + 'papersReceivedDate declarationDate periodYear periodMonth invoiceRequest.status')
          .sort({ createdAt: -1 }).lean()
          // Upcoming ones are measured by their expected date, their only date.
          .then((list) => (dFrom || dTo ? list.filter((c) => {
            const d = c.upcoming ? String(c.expectedDate || '').slice(0, 10) : txDateOf(c);
            return !!d && (!dFrom || d >= dFrom) && (!dTo || d <= dTo);
          }) : list)),
        User.find({ role: { $in: jp.memberRoles }, isActive: { $ne: false } }).select('firstName lastName role').lean(),
        act('notesLog', 'by', 'at'),
        act('paymentStages', 'addedBy', 'addedAt'),
        act('stageLog', 'by', 'at'),
        CustomsClearance.aggregate([
          { $match: { ...aggMatch, cancelled: { $ne: true }, 'paymentStages.payStatus': 'pending' } },
          { $project: { paymentStages: 1 } }, { $unwind: '$paymentStages' },
          { $match: { 'paymentStages.payStatus': 'pending' } },
          { $group: { _id: '$_id', n: { $sum: 1 } } },
        ]),
        JpTask.find(jpVisible).select('status deadlineAt assignedTo links title').lean(),
        endedStaff(),
      ]);

      const today = todayKey();
      const soon = new Date(startOfDay(today).getTime() + 7 * DAY_MS).toISOString().slice(0, 10);
      const pendingBy = new Map(pendingPay.map((x) => [String(x._id), x.n]));
      const now = Date.now();
      const taskState = (t) => (t.status === 'done' ? 'done' : (t.deadlineAt && new Date(t.deadlineAt).getTime() < now ? 'overdue' : 'open'));
      const tasksByClearance = new Map();
      for (const t of tasks) {
        if (t.status === 'done') continue;
        for (const l of t.links || []) {
          if (l.kind !== 'clearance') continue;
          tasksByClearance.set(String(l.ref), (tasksByClearance.get(String(l.ref)) || 0) + 1);
        }
      }
      const nameOf = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : '');
      const userName = new Map(users.map((u) => [String(u._id), nameOf(u)]));

      const allOut = rows.map((c) => {
        const p = pipelineOf(c);
        const bucket = c.cancelled ? 'cancelled' : c.upcoming ? 'upcoming' : c.isCompleted ? 'closed' : 'open';
        const returned = p.steps.some((s) => s.key === 'containers_returned' && s.done) || !!(c.stageDone && c.stageDone.containersReturned);
        const needsReturn = bucket === 'open' && c.cargoType !== 'vehicles' && !returned;
        const d = String(c.returnDeadline || '').slice(0, 10);
        // Where each container is
        // A transaction is counted by its units: how many are still at the port, how many in the yard, how many delivered, how many not returned, and how many of those are past their return deadline.
        const U = { total: 0, atPort: 0, inYard: 0, delivered: 0, returned: 0, notReturned: 0, late: 0 };
        if (bucket === 'open') {
          for (const u of p.units || []) {
            const has = (k) => u.steps.some((s) => s.key === k && s.done);
            U.total += 1;
            if (has('transport_to_customer') || has('yard_to_customer')) U.delivered += 1;
            else if (has('transport_to_yard')) U.inYard += 1;
            else U.atPort += 1;
            if (c.cargoType !== 'vehicles') {
              if (has('containers_returned')) U.returned += 1;
              else { U.notReturned += 1; if (d && d < today) U.late += 1; }
            }
          }
        }
        const row = {
          _id: c._id, refNumber: c.refNumber, blNumber: c.blNumber || '', customerName: c.customerName || '',
          customerParty: c.customerParty || null, shippingAgent: c.shippingAgent || '', carrierName: c.carrierName || '',
          branch: c.branch, cargoType: c.cargoType === 'vehicles' ? 'vehicles' : 'containers', units: Number(c.containerCount) || 0,
          bucket, percent: p.percent, next: bucket === 'open' ? p.next : '',
          nextLabel: bucket === 'open' && p.next ? stageLabel(p.next, c.cargoType) : '',
          route: p.route,
          date: c.upcoming ? String(c.expectedDate || '').slice(0, 10) : txDateOf(c),
          port: c.port || '', declarationNumber: c.declarationNumber || '',
          createdAt: c.createdAt, createdBy: c.createdBy || null, createdByName: userName.get(String(c.createdBy || '')) || '',
          expectedDate: c.expectedDate || '', completedAt: c.completedAt || null,
          invoiceNumber: c.saleInvoiceNumber || '',
          // Invoiced includes what was invoiced before the system (stage marked, no invoice number here).
          invoiced: !!c.saleInvoiceNumber || p.steps.some((s) => s.key === 'invoiced' && s.done),
          awaitingTransportInvoice: awaitsTransportInvoice(c),
          // Invoicing request at finance: '' · pending · invoiced · returned · rejected.
          invoiceRequest: c.invoiceRequest?.status || '',
          returnDeadline: d, unitsState: U,
          returnState: !needsReturn || !d ? '' : (d < today ? 'overdue' : d <= soon ? 'due' : ''),
          pendingPayments: pendingBy.get(String(c._id)) || 0,
          openTasks: tasksByClearance.get(String(c._id)) || 0,
        };
        if (bucket === 'upcoming' && row.expectedDate) row.expectedState = row.expectedDate < today ? 'overdue' : '';
        return row;
      });

      // Quick filters, HR style
      // Multi-value (comma separated), applied to every number on the dashboard. The count beside each value is computed under all filters except its own, so what it moves to is visible before choosing.
      const { list: out, filters } = applyQuick(allOut, dashQuickFilters(), q);

      const open = out.filter((r) => r.bucket === 'open');
      const count = (f) => out.filter(f).length;
      const customersOf = (list) => new Set(list.map((r) => String(r.customerParty || r.customerName || '')).filter(Boolean));

      // Where open ones stand: by the stage each is waiting on.
      const stageOrder = CustomsClearance.STAGES;
      const byNext = new Map();
      for (const r of open) {
        const k = r.next || 'done';
        const e = byNext.get(k) || { key: k, label: k === 'done' ? 'اكتملت مراحلُها — تنتظر الإنهاء' : stageLabel(k), count: 0, units: 0 };
        e.count += 1; e.units += r.units; byNext.set(k, e);
      }
      const byStage = [...byNext.values()].sort((a, b) => (a.key === 'done' ? 99 : stageOrder.indexOf(a.key)) - (b.key === 'done' ? 99 : stageOrder.indexOf(b.key)));

      const custMap = new Map();
      for (const r of out) {
        if (r.bucket === 'cancelled') continue;
        const k = String(r.customerParty || r.customerName || '—');
        const e = custMap.get(k) || { key: k, party: r.customerParty || null, name: r.customerName || '—', upcoming: 0, open: 0, closed: 0, awaiting: 0, units: 0 };
        e[r.bucket] += 1; if (r.awaitingTransportInvoice) e.awaiting += 1; if (r.bucket === 'open') e.units += r.units;
        custMap.set(k, e);
      }

      // Team: what each member has now and did in thirty days
      const idx = (list) => new Map(list.map((x) => [String(x._id), x]));
      const N = idx(notes); const P = idx(pays); const S = idx(ticks);
      const monthStart = startOfDay(`${today.slice(0, 7)}-01`).getTime();
      // Numbers are over all transactions, not what the creator filter narrowed.
      const scope = filter.createdBy
        ? await CustomsClearance.find((({ createdBy, ...rest }) => rest)(filter)).select('createdBy completedBy completedAt isCompleted cancelled upcoming').lean()
          .then((all) => all.map((c) => ({ ...c, bucket: c.cancelled ? 'cancelled' : c.upcoming ? 'upcoming' : c.isCompleted ? 'closed' : 'open' })))
        : rows.map((c, i) => ({ createdBy: c.createdBy, completedBy: c.completedBy, completedAt: c.completedAt, bucket: allOut[i].bucket }));
      // Someone whose service HR ended is not counted in the team; their name stays on what they created.
      const team = users.filter((u) => !userEnded(ended, u)).map((u) => {
        const id = String(u._id);
        const mine = tasks.filter((t) => String(t.assignedTo) === id);
        const last = [N.get(id)?.last, P.get(id)?.last, S.get(id)?.last].filter(Boolean).map((d) => new Date(d).getTime());
        return {
          _id: u._id, name: nameOf(u), role: u.role, isManager: jp.managerRoles.includes(u.role),
          openCreated: scope.filter((c) => String(c.createdBy || '') === id && c.bucket === 'open').length,
          upcomingCreated: scope.filter((c) => String(c.createdBy || '') === id && c.bucket === 'upcoming').length,
          closedThisMonth: scope.filter((c) => String(c.completedBy || '') === id && c.completedAt && new Date(c.completedAt).getTime() >= monthStart).length,
          stages30: S.get(id)?.n || 0, notes30: N.get(id)?.n || 0, payments30: P.get(id)?.n || 0,
          tasksOpen: mine.filter((t) => taskState(t) !== 'done').length,
          tasksOverdue: mine.filter((t) => taskState(t) === 'overdue').length,
          lastActivityAt: last.length ? new Date(Math.max(...last)) : null,
        };
      }).sort((a, b) => (b.stages30 + b.notes30 + b.payments30) - (a.stages30 + a.notes30 + a.payments30));

      return {
        today,
        filters,
        counts: {
          total: count((r) => r.bucket !== 'cancelled'),
          upcoming: count((r) => r.bucket === 'upcoming'),
          upcomingOverdue: count((r) => r.bucket === 'upcoming' && r.expectedState === 'overdue'),
          open: open.length,
          closed: count((r) => r.bucket === 'closed'),
          // Closed but not invoiced, from the legacy record; stays visible until their invoices are issued.
          closedNotInvoiced: count((r) => r.bucket === 'closed' && !r.invoiced),
          // And closed invoiced ones: when the invoice of a closed-not-invoiced one is issued it moves here by itself.
          closedInvoiced: count((r) => r.bucket === 'closed' && r.invoiced),
          cancelled: count((r) => r.bucket === 'cancelled'),
          awaitingTransportInvoice: count((r) => r.awaitingTransportInvoice),
          notInvoiced: open.filter((r) => !r.invoiced).length,
          activeCustomers: customersOf(open).size,
          customers: customersOf(out.filter((r) => r.bucket !== 'cancelled')).size,
          openUnits: open.reduce((a, r) => a + r.units, 0),
          openContainers: open.filter((r) => r.cargoType === 'containers').reduce((a, r) => a + r.units, 0),
          openVehicles: open.filter((r) => r.cargoType === 'vehicles').reduce((a, r) => a + r.units, 0),
          unitsAtPort: open.reduce((a, r) => a + r.unitsState.atPort, 0),
          unitsInYard: open.reduce((a, r) => a + r.unitsState.inYard, 0),
          unitsDelivered: open.reduce((a, r) => a + r.unitsState.delivered, 0),
          unitsNotReturned: open.reduce((a, r) => a + r.unitsState.notReturned, 0),
          unitsLate: open.reduce((a, r) => a + r.unitsState.late, 0),
          returnOverdue: count((r) => r.returnState === 'overdue'),
          returnDue: count((r) => r.returnState === 'due'),
          pendingPayments: open.reduce((a, r) => a + r.pendingPayments, 0),
          withPendingPayments: open.filter((r) => r.pendingPayments > 0).length,
          tasksOpen: tasks.filter((t) => taskState(t) !== 'done').length,
          tasksOverdue: tasks.filter((t) => taskState(t) === 'overdue').length,
          closedThisMonth: out.filter((r) => r.bucket === 'closed' && r.completedAt && new Date(r.completedAt).getTime() >= monthStart).length,
        },
        byStage,
        byCustomer: [...custMap.values()].sort((a, b) => b.open - a.open || b.upcoming - a.upcoming || b.closed - a.closed),
        byBranch: ['jeddah', 'dammam'].map((b) => ({ key: b, upcoming: count((r) => r.branch === b && r.bucket === 'upcoming'), open: count((r) => r.branch === b && r.bucket === 'open'), closed: count((r) => r.branch === b && r.bucket === 'closed') })),
        team,
        rows: out,
      };
    });
    res.json({ ...body, canManage: isManager, canSeeAnalytics: seesMoney(req) });
  } catch (e) {
    console.error('customs getDashboard:', e);
    res.status(500).json({ message: 'تعذّر تحميل لوحة القسم' });
  }
};

// Notes: a line is added and the last is read in the table
const touchCustoms = (id) => {
  try { cache.clear('customs:'); } catch (_) { /* */ }
  try { emitToAll('customs:updated', { id: String(id || '') }); } catch (_) { /* */ }
};

exports.addNote = async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ message: 'اكتب الملاحظة' });
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const note = {
      text,
      by: req.user._id,
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.name || '',
      at: new Date(),
    };
    clearance.notesLog.push(note);
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({ user: req.user._id, action: 'customs_note', entity: 'CustomsClearance', entityId: clearance._id, changes: { after: { note: text } }, ipAddress: req.ip });
    touchCustoms(clearance._id);
    res.status(201).json({ note, notesLog: clearance.notesLog });
  } catch (e) { sendMongooseError(res, e, 'تعذّرت إضافة الملاحظة'); }
};

exports.deleteNote = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'المعاملة غير موجودة' });
    const note = clearance.notesLog.id(req.params.noteId);
    if (!note) return res.status(404).json({ message: 'الملاحظة غير موجودة' });
    // Another person's note is deleted only by the manager: it is a trace of its author.
    const boss = ['super_admin', 'admin', 'customs_manager'].includes(req.user.role);
    if (!boss && String(note.by || '') !== String(req.user._id)) {
      return res.status(403).json({ message: 'لا تُحذف ملاحظةُ غيرك' });
    }
    note.deleteOne();
    await clearance.save();
    touchCustoms(clearance._id);
    res.json({ notesLog: clearance.notesLog });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الملاحظة'); }
};

// Contracts: our contract with a customer, agent or carrier
const CONTRACT_FIELDS = ['title', 'contractNumber', 'startDate', 'endDate', 'value', 'valueBasis',
  'paymentTermDays', 'autoRenew', 'status', 'scope', 'notes'];

/** Contract prices as stored: numbers or empty, and destinations with a name and price. */
const cleanPricing = (p) => {
  if (!p || typeof p !== 'object') return undefined;
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  return {
    clearanceFeePerContainer: num(p.clearanceFeePerContainer),
    portToYard: num(p.portToYard),
    yardToCustomer: num(p.yardToCustomer),
    routes: (Array.isArray(p.routes) ? p.routes : []).slice(0, 100)
      .map((r) => ({ from: String(r?.from || '').trim().slice(0, 80), to: String(r?.to || '').trim().slice(0, 80), price: num(r?.price) }))
      .filter((r) => r.from || r.to || r.price !== null),
  };
};

/** An expired contract reads as expired even if marked active: the date is more reliable than the field. */
const withState = (c) => {
  const end = c.endDate ? new Date(c.endDate) : null;
  const expired = !!end && end.getTime() < Date.now();
  const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
  return { ...c, expired, daysLeft, state: c.status === 'terminated' ? 'terminated' : expired ? 'expired' : c.status };
};

exports.listContracts = async (req, res) => {
  try {
    const filter = {};
    if (PARTY_KINDS.includes(req.query.kind)) filter.partyKind = req.query.kind;
    if (req.query.party) filter.party = req.query.party;
    if (req.query.status) filter.status = req.query.status;
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = partyRx(q);
      filter.$or = [{ title: rx }, { contractNumber: rx }, { partyName: rx }, { scope: rx }];
    }
    const rows = await CustomsContract.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ contracts: rows.map(withState) });
  } catch (e) {
    console.error('listContracts error:', e);
    res.status(500).json({ message: 'تعذّر تحميل العقود' });
  }
};

exports.createContract = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.body.party).lean();
    if (!party) return res.status(400).json({ message: 'اختر الطرف' });
    // There are no contracts with shipping agents.
    if (party.kind === 'agent') return res.status(400).json({ message: 'لا عقود مع وكلاء الشحن — العقود للعملاء والناقلين' });
    if (!String(req.body.title || '').trim()) return res.status(400).json({ message: 'اسم العقد مطلوب' });
    const body = stripEmpty(req.body, CustomsContract.schema);
    const doc = await CustomsContract.create({
      ...Object.fromEntries(CONTRACT_FIELDS.map((f) => [f, body[f]]).filter(([, v]) => v !== undefined)),
      ...(cleanPricing(req.body.pricing) ? { pricing: cleanPricing(req.body.pricing) } : {}),
      party: party._id,
      partyKind: party.kind,
      partyName: party.name,
      createdBy: req.user._id,
      createdByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    await logAudit({ user: req.user._id, action: 'create_customs_contract', entity: 'CustomsContract', entityId: doc._id, changes: { after: { title: doc.title, party: party.name } }, ipAddress: req.ip });
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.status(201).json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ العقد'); }
};

exports.updateContract = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    if (req.body.party && String(req.body.party) !== String(doc.party)) {
      const party = await CustomsParty.findById(req.body.party).lean();
      if (!party) return res.status(400).json({ message: 'الطرف غير موجود' });
      if (party.kind === 'agent') return res.status(400).json({ message: 'لا عقود مع وكلاء الشحن' });
      doc.party = party._id; doc.partyKind = party.kind; doc.partyName = party.name;
    }
    for (const f of CONTRACT_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f] === '' ? (doc.schema.path(f)?.instance === 'Number' ? null : '') : req.body[f];
    if (req.body.pricing !== undefined) doc.pricing = cleanPricing(req.body.pricing) || {};
    doc.lastModifiedBy = req.user._id;
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ العقد'); }
};

exports.deleteContract = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    // Papers are deleted with their row; otherwise a file nothing refers to would remain.
    for (const a of doc.attachments || []) { try { deleteStoredFile(a.fileUrl); } catch (_) { /* */ } }
    await doc.deleteOne();
    await logAudit({ user: req.user._id, action: 'delete_customs_contract', entity: 'CustomsContract', entityId: doc._id, changes: { before: { title: doc.title, party: doc.partyName } }, ipAddress: req.ip });
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ ok: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف العقد'); }
};

exports.addContractFiles = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    const incoming = Array.isArray(req.body.files) ? req.body.files : [req.body];
    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: e.message }); }
      const att = {
        ...stored,
        title: String(f.title || '').trim().slice(0, 200),
        uploadedBy: req.user._id,
        uploadedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        uploadedAt: new Date(),
      };
      doc.attachments.push(att);
      added.push(att);
    }
    if (!added.length) return res.status(400).json({ message: 'لا ملفات' });
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.status(201).json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر رفع الملف'); }
};

exports.deleteContractFile = async (req, res) => {
  try {
    const doc = await CustomsContract.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'العقد غير موجود' });
    const att = doc.attachments.id(req.params.attId);
    if (!att) return res.status(404).json({ message: 'الملف غير موجود' });
    try { deleteStoredFile(att.fileUrl); } catch (_) { /* */ }
    att.deleteOne();
    await doc.save();
    try { emitToAll('customs:contract', { id: String(doc._id) }); } catch (_) { /* */ }
    res.json({ contract: withState(doc.toObject()) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الملف'); }
};

// Party attachments: customer, agent and carrier
const partyCardOf = (p) => ({
  _id: p._id, kind: p.kind, name: p.name, phone: p.phone, email: p.email, contactPerson: p.contactPerson,
  commercialRegister: p.commercialRegister, taxNumber: p.taxNumber, address: p.address, city: p.city, notes: p.notes,
  attachments: p.attachments || [],
});

/** GET /:id/parties-card - cards of the transaction's parties (customer, agent, carrier): their data and attachments, read on the transaction page without opening each file. */
exports.getClearanceParties = async (req, res) => {
  try {
    const c = await CustomsClearance.findById(req.params.id).select('customerParty agentParty carrierParty customerName shippingAgent carrierName').lean();
    if (!c) return res.status(404).json({ message: 'Clearance not found' });
    const ids = [c.customerParty, c.agentParty, c.carrierParty].filter(Boolean);
    const rows = await CustomsParty.find({ _id: { $in: ids } }).lean();
    const by = new Map(rows.map((p) => [String(p._id), partyCardOf(p)]));
    const pick = (id, kind, name) => (id && by.get(String(id))) || (name ? { kind, name, attachments: [], unlinked: true } : null);
    res.json({
      customer: pick(c.customerParty, 'customer', c.customerName),
      agent: pick(c.agentParty, 'agent', c.shippingAgent),
      carrier: pick(c.carrierParty, 'carrier', c.carrierName),
    });
  } catch (e) { res.status(500).json({ message: 'تعذّر تحميل الأطراف' }); }
};

// POST /parties/:id/attachments { files: [{ dataUrl, fileName, title }] }
exports.addPartyAttachments = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'غير موجود' });
    const incoming = Array.isArray(req.body.files) ? req.body.files : [];
    if ((party.attachments || []).length + incoming.length > 40) return res.status(400).json({ message: 'لا يُرفَق أكثر من ٤٠ ملفًّا للطرف' });
    const added = [];
    for (const f of incoming) {
      if (!f || !f.dataUrl) continue;
      let stored;
      try { stored = saveUploadFile(f.dataUrl, 'customs', f.fileName || ''); }
      catch (e) { return res.status(400).json({ message: 'نوعُ الملفّ غير مدعوم أو حجمُه أكبر من ٢٠ ميغابايت' }); }
      added.push({ ...stored, title: String(f.title || f.fileName || '').trim().slice(0, 200), uploadedByName: [req.user.firstName, req.user.lastName].filter(Boolean).join(' '), uploadedAt: new Date() });
    }
    if (!added.length) return res.status(400).json({ message: 'لا ملفّات' });
    party.attachments.push(...added);
    await party.save();
    logAudit({ user: req.user, action: 'customs_party_attach', entity: 'CustomsParty', entityId: party._id, changes: { details: `${party.name}: ${added.map((a) => a.title).join('، ')}` }, ipAddress: req.ip }).catch(() => {});
    cache.clear('customs:');
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (e) { /* */ }
    res.status(201).json({ party: partyCardOf(party.toObject()) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر رفع الملفّات'); }
};

// PUT /parties/:id/attachments/:attId { title } · DELETE /parties/:id/attachments/:attId
exports.updatePartyAttachment = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    const a = party && party.attachments.id(req.params.attId);
    if (!a) return res.status(404).json({ message: 'غير موجود' });
    a.title = String(req.body.title || '').trim().slice(0, 200);
    await party.save();
    cache.clear('customs:');
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (e) { /* */ }
    res.json({ party: partyCardOf(party.toObject()) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحفظ'); }
};
exports.deletePartyAttachment = async (req, res) => {
  try {
    const party = await CustomsParty.findById(req.params.id);
    const a = party && party.attachments.id(req.params.attId);
    if (!a) return res.status(404).json({ message: 'غير موجود' });
    const gone = { title: a.title, fileUrl: a.fileUrl };
    a.deleteOne();
    await party.save();
    try { require('../utils/fileStore').deleteStoredFile(gone.fileUrl); } catch (e) { /* The file stays if deleting it fails */ }
    logAudit({ user: req.user, action: 'customs_party_detach', entity: 'CustomsParty', entityId: party._id, changes: { details: `${party.name}: ${gone.title}` }, ipAddress: req.ip }).catch(() => {});
    cache.clear('customs:');
    try { emitToAll('customs:updated', { party: String(party._id) }); } catch (e) { /* */ }
    res.json({ party: partyCardOf(party.toObject()) });
  } catch (e) { return sendMongooseError(res, e, 'تعذّر الحذف'); }
};

// Customer contract prices to revenue and invoicing
/** GET /:id/contract-pricing - the customer's active contract, its destinations and what it says for this transaction. */
exports.getContractPricing = async (req, res) => {
  try {
    const c = await CustomsClearance.findById(req.params.id).select('customerParty containerCount city contractPricing').lean();
    if (!c) return res.status(404).json({ message: 'Clearance not found' });
    const contract = await contractPricing.activeCustomerContract(c.customerParty);
    res.json({ contract: contractPricing.contractSummary(contract, c) });
  } catch (e) {
    console.error('getContractPricing:', e);
    res.status(500).json({ message: 'تعذّر قراءة عقد العميل' });
  }
};

/** POST /:id/apply-contract { from?, to? } - fill from the contract: writes contract prices into all revenue slots (even if edited), and with a destination chosen its price is written. */
exports.applyContractPricing = async (req, res) => {
  try {
    const clearance = await CustomsClearance.findById(req.params.id);
    if (!clearance) return res.status(404).json({ message: 'Clearance not found' });
    const contract = await contractPricing.activeCustomerContract(clearance.customerParty);
    if (!contract) return res.status(400).json({ message: 'لا يوجد عقدٌ ساري بأسعار لهذا العميل — أضِف الأسعار في عقده أوّلًا', code: 'NO_CONTRACT' });
    const current = clearance.toObject();
    const target = {};
    const opts = { overwrite: true };
    if (req.body.from !== undefined || req.body.to !== undefined) { opts.from = String(req.body.from || ''); opts.to = String(req.body.to || ''); }
    contractPricing.fillRevenue(target, current, contract, opts);
    clearance.revenue = { ...current.revenue, ...target.revenue };
    clearance.contractPricing = target.contractPricing;
    clearance.lastModifiedBy = req.user._id;
    await clearance.save();
    await logAudit({
      user: req.user._id, action: 'update_customs_clearance', entity: 'CustomsClearance', entityId: clearance._id,
      changes: { after: { refNumber: clearance.refNumber, contractPricing: contract.title, route: `${target.contractPricing.routeFrom} → ${target.contractPricing.routeTo}` } },
      ipAddress: req.ip,
    }).catch(() => {});
    cache.clear('customs:');
    try { emitToAll('customs:updated', { clearance }); } catch (_) { /* */ }
    res.json({ clearance, contract: contractPricing.contractSummary(contract, clearance.toObject()) });
  } catch (e) {
    return sendMongooseError(res, e, 'تعذّر التعبئة من العقد');
  }
};
