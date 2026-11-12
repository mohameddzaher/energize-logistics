/**
 * Collections ledger: ageing, invoices, alerts, plan and team scoring.
 * Kept apart from collectionsDeptController, which reads operations sheets; this reads the ledger itself (many invoices have no sheet here).
 * Age counts from the invoicing date; due date counts from the delivery date, since the credit term starts when the customer receives the invoice.
 */
const CollectionsParty = require('../models/CollectionsParty');
const CollectionInvoice = require('../models/CollectionInvoice');
const CollectionTask = require('../models/CollectionTask');
const CreditAlertAck = require('../models/CreditAlertAck');
const PartyLinkSuggestion = require('../models/PartyLinkSuggestion');
const cache = require('../utils/ttlCache');
// Folds Arabic spelling and whitespace variants; same helper as the invoice pages.
const { flexSpaceRegex } = require('../utils/plateKey');
// Effective collections officer: the named employee, else the department manager, never unassigned.
const {
  collectionsManager, officerCondition, effectiveOfficer, isDefaultOfficer, withManager,
} = require('../utils/collectionsOfficer');

const CACHE_PREFIX = 'colledger:';
const DAY = 86400000;

/**
 * Responses are cached for a minute: read-only screens opened by many devices, and writes invalidate the cache immediately.
 * The single-flight wrapper makes concurrent openers share one computation.
 */
const TTL = 60000;
const keyOf = (name, req) => {
  const q = req.query || {};
  const parts = Object.keys(q).sort().map((k) => `${k}=${[].concat(q[k]).join(',')}`);
  // The role is part of the cache key so a manager's wider view never leaks to a narrower role.
  return `${CACHE_PREFIX}${name}:${req.user?.role || ''}:${parts.join('&')}`;
};

/** Age bands as in the ledger; lower bounds are inclusive (>=). */
const BANDS = [
  { key: '15-', label: '15-', min: 0 },
  { key: '30-', label: '30-', min: 15 },
  { key: '45-', label: '45-', min: 30 },
  { key: '60-', label: '60-', min: 45 },
  { key: '60+', label: '60+', min: 60 },
  { key: '90+', label: '90+', min: 90 },
  { key: '120+', label: '120+', min: 120 },
  { key: '1Y+', label: '1 Year +', min: 365 },
  // Extra band for invoices with no date: otherwise they count in the total but in no band, and the bands would not sum to the total.
  // Every amount must appear in some band.
  { key: 'noDate', label: 'بلا تاريخ', min: null },
];
const AGE_BANDS = BANDS.filter((b) => b.min !== null);
const bandOf = (days) => {
  if (days == null || Number.isNaN(days)) return 'noDate';
  for (let i = AGE_BANDS.length - 1; i >= 0; i -= 1) if (days >= AGE_BANDS[i].min) return AGE_BANDS[i].key;
  return AGE_BANDS[0].key;
};

const startOfToday = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const daysBetween = (from, to) => (from ? Math.floor((to - new Date(from)) / DAY) : null);

// One definition of open for the whole department: see models/CollectionInvoice.OPEN.
const OPEN = CollectionInvoice.OPEN;

/**
 * The department sees what is owed to us, not what we owe.
 * Duplicated from collectionsDeptController on purpose, to avoid mutual coupling between the two files.
 */
const RECEIVABLES_ONLY = ['collections_manager', 'collections_team_leader', 'collections_staff'];
const receivablesOnly = (user) => RECEIVABLES_ONLY.includes(user?.role);

// Ledger filters, built in one place so the table, stats and export never disagree.
// A party is in the registry if it has a code or an open invoice: cash parties often have no code and were missing from the ageing registry while counted on the dashboard.
async function ledgerPartyBase() {
  return cache.wrap(`${CACHE_PREFIX}partybase`, TTL, async () => {
    const holders = (await CollectionInvoice.distinct('party', OPEN)).filter(Boolean);
    return { kind: 'customer', $or: [{ code: { $gt: '' } }, { _id: { $in: holders } }] };
  });
}

function partyFilter(q = {}, base = { kind: 'customer', code: { $gt: '' } }, mgr = null) {
  const f = { $and: [base] };
  const { officer, grade, department, hoLocation, kind, creditDays, status, region } = q;
  // The app sends the search as q and the website as search; both are accepted.
  const search = q.search || q.q;
  const list = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  // The manager's name opens their own accounts plus every unassigned one: see utils/collectionsOfficer.
  const oc = officerCondition(officer, mgr);
  if (oc) f.$and.push(oc);
  if (grade) f.grade = { $in: list(grade) };
  if (department) f.department = { $in: list(department) };
  if (hoLocation) f.hoLocation = { $in: list(hoLocation) };
  if (region) f.region = { $in: list(region) };
  if (status) f.status = { $in: list(status) };
  if (kind) f.paymentType = { $in: list(kind) };
  if (creditDays) f.creditDays = { $in: list(creditDays).map(Number).filter(Number.isFinite) };
  if (search) {
    // Search folds spelling variants like the rest of the system, using flexSpaceRegex (as the invoice and customer pages do); a plain escaped regex missed alef-maqsura and ta-marbuta variants.
    const rx = flexSpaceRegex(String(search));
    f.$or = [{ name: rx }, { code: rx }, { collectionOfficer: rx }, { aliases: rx }];
  }
  return f;
}

/**
 * Debt ageing per account, computed from invoices rather than stored.
 * The sheet snapshot goes stale; differences between snapshot and ledger are shown, not hidden.
 */
/**
 * Cash comes from the ledger itself, not from operations sheets.
 * The old add-on counted cash twice once the cash shipments sheet was imported, and the sheet value is the purchase price, not what the customer owes (see real-selling-price).
 */
async function agingByParty(partyIds) {
  const today = startOfToday();
  // Aggregate in the database, not in Node: reading all open invoices made the ageing, alerts and scoring endpoints take seconds to over ten.
  // The band is computed with a single $switch on the date difference.
  const rows = await CollectionInvoice.aggregate([
    { $match: { ...OPEN, party: { $in: partyIds } } },
    { $addFields: {
      _base: { $ifNull: ['$invoiceDate', '$deliveryDate'] },
    } },
    { $addFields: {
      _days: { $cond: [{ $eq: ['$_base', null] }, null, { $dateDiff: { startDate: '$_base', endDate: today, unit: 'day' } }] },
    } },
    { $addFields: {
      _band: { $switch: { branches: [
        { case: { $eq: ['$_days', null] }, then: 'noDate' },
        { case: { $gte: ['$_days', 365] }, then: '1Y+' },
        { case: { $gte: ['$_days', 120] }, then: '120+' },
        { case: { $gte: ['$_days', 90] }, then: '90+' },
        { case: { $gte: ['$_days', 60] }, then: '60+' },
        { case: { $gte: ['$_days', 45] }, then: '60-' },
        { case: { $gte: ['$_days', 30] }, then: '45-' },
        { case: { $gte: ['$_days', 15] }, then: '30-' },
      ], default: '15-' } },
    } },
    // Open means the remaining amount; a partial payment is not counted at full value (CollectionInvoice.remainingExpr).
    { $group: { _id: { p: '$party', b: '$_band', k: '$kind' }, sum: { $sum: CollectionInvoice.remainingExpr }, n: { $sum: 1 } } },
  ]);

  const out = new Map();
  const blank = () => ({
    outstanding: 0, count: 0, tax: 0, cash: 0,
    bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
    counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])),
  });
  for (const r of rows) {
    const k = String(r._id.p);
    if (!out.has(k)) out.set(k, blank());
    const e = out.get(k);
    e.outstanding += r.sum; e.count += r.n;
    if (r._id.k === 'cash') e.cash += r.sum; else e.tax += r.sum;
    e.bands[r._id.b] += r.sum; e.counts[r._id.b] += r.n;
  }
  return out;
}

// GET /api/collections-dept/ledger/aging
exports.aging = async (req, res) => {
  try {
    const { page = 1, limit = 50, band, sort = 'outstanding' } = req.query;
    const cacheKey = keyOf('aging', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const mgr = await collectionsManager();
    const filter = partyFilter(req.query, await ledgerPartyBase(), mgr);
    const parties = await CollectionsParty.find(filter)
      .select('code name paymentType collectionOfficer hoLocation grade salesManagers department region creditLimit creditDays status')
      .lean();

    // Ledger only, both types: see the comment above agingByParty.
    const ageMap = await agingByParty(parties.map((p) => p._id));
    let rows = parties.map((p) => {
      const a = ageMap.get(String(p._id))
        || { outstanding: 0, count: 0, tax: 0, cash: 0, bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])), counts: Object.fromEntries(BANDS.map((b) => [b.key, 0])) };
      const pct = p.creditLimit > 0 ? (a.outstanding / p.creditLimit) * 100 : null;
      return {
        ...p, outstanding: a.outstanding, taxOutstanding: a.tax, cashOutstanding: a.cash, invoiceCount: a.count, bands: a.bands, bandCounts: a.counts, limitUsedPct: pct,
        effectiveOfficer: effectiveOfficer(p.collectionOfficer, mgr), officerIsDefault: isDefaultOfficer(p.collectionOfficer),
      };
    });
    // A specific band is applied after grouping, otherwise the bands would not sum to the total.
    if (band && BANDS.some((b) => b.key === band)) rows = rows.filter((r) => r.bands[band] !== 0);

    const totals = { outstanding: 0, invoices: 0, creditLimit: 0, bands: Object.fromEntries(BANDS.map((b) => [b.key, 0])) };
    for (const r of rows) {
      totals.outstanding += r.outstanding; totals.invoices += r.invoiceCount; totals.creditLimit += r.creditLimit || 0;
      for (const b of BANDS) totals.bands[b.key] += r.bands[b.key];
    }

    const dir = String(req.query.dir || 'desc') === 'asc' ? 1 : -1;
    const key = ['outstanding', 'creditLimit', 'creditDays', 'name', 'code', 'limitUsedPct'].includes(sort) ? sort : 'outstanding';
    rows.sort((a, b) => {
      const x = a[key]; const y = b[key];
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x || '').localeCompare(String(y || ''));
      return dir * ((x || 0) - (y || 0));
    });

    // Cap fits the export size the screen requests (5000); a lower cap silently truncated the file.
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(20000, Math.max(1, parseInt(limit, 10)));
    const out = { rows: rows.slice((p - 1) * l, p * l), total: rows.length, page: p, pages: Math.ceil(rows.length / l), totals, bands: BANDS };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) {
    console.error('aging error:', e);
    res.status(500).json({ message: 'تعذّر حسابُ أعمار الديون' });
  }
};

// GET /api/collections-dept/ledger/aging/filters
exports.agingFilters = async (req, res) => {
  try {
    const mgr = await collectionsManager();
    const key = `${CACHE_PREFIX}agingfilters:${mgr?.name || ''}`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const base = { kind: 'customer', code: { $gt: '' } };
    const [officers, grades, departments, locations, creditDays, statuses, regions] = await Promise.all([
      CollectionsParty.distinct('collectionOfficer', base),
      CollectionsParty.distinct('grade', base),
      CollectionsParty.distinct('department', base),
      CollectionsParty.distinct('hoLocation', base),
      CollectionsParty.distinct('creditDays', base),
      CollectionsParty.distinct('status', base),
      CollectionsParty.distinct('region', base),
    ]);
    const clean = (a) => a.filter((x) => x !== null && x !== undefined && x !== '').sort();
    const out = {
      officers: withManager(clean(officers), mgr), grades: clean(grades), departments: clean(departments),
      locations: clean(locations), creditDays: creditDays.filter((n) => n > 0).sort((a, b) => a - b),
      statuses: clean(statuses), regions: clean(regions), bands: BANDS,
    };
    cache.set(key, out, 300);
    res.json(out);
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ قيم الفلاتر' }); }
};

// Invoices
function invoiceFilter(q = {}) {
  const f = {};
  const list = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
  const { kind, status, partyCode, officer, from, to, dateField = 'invoiceDate', open, band } = q;
  const search = q.search || q.q;
  if (kind) f.kind = { $in: list(kind) };
  if (status) f.status = { $in: list(status) };
  if (partyCode) f.partyCode = { $in: list(partyCode) };
  if (open === 'true') Object.assign(f, OPEN);
  if (open === 'false') Object.assign(f, CollectionInvoice.COLLECTED);
  if (from || to) {
    const field = ['invoiceDate', 'deliveryDate', 'collectionDate'].includes(dateField) ? dateField : 'invoiceDate';
    f[field] = {};
    if (from) f[field].$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) f[field].$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (search) {
    // Folds Arabic spelling variants: see partyFilter above.
    const rx = flexSpaceRegex(String(search));
    f.$or = [{ invoiceNumber: rx }, { partyName: rx }, { partyCode: rx }, { comments: rx }];
  }
  return f;
}

/** The three dates an invoice age is read from; computed, not stored. */
function decorate(v, today, creditDaysOf) {
  const toDelivery = v.deliveryDate && v.invoiceDate ? Math.floor((new Date(v.deliveryDate) - new Date(v.invoiceDate)) / DAY) : null;
  const toCollection = v.collectionDate && v.deliveryDate ? Math.floor((new Date(v.collectionDate) - new Date(v.deliveryDate)) / DAY) : null;
  const ageDays = daysBetween(v.invoiceDate || v.deliveryDate, today);
  const cd = creditDaysOf ? creditDaysOf(v) : 0;
  // Due date counts from delivery; the credit term does not start before the invoice reaches the customer.
  const dueDate = v.deliveryDate && cd ? new Date(new Date(v.deliveryDate).getTime() + cd * DAY) : null;
  // A collected invoice is neither late nor owed; it is settled.
  const isCollected = CollectionInvoice.isCollected(v);
  const daysToDue = dueDate && !isCollected ? Math.floor((dueDate - today) / DAY) : null;
  return {
    ...v,
    ageDays, band: ageDays == null ? '' : bandOf(ageDays),
    daysInvoiceToDelivery: toDelivery,
    daysDeliveryToCollection: toCollection,
    daysTotal: v.collectionDate && v.invoiceDate ? Math.floor((new Date(v.collectionDate) - new Date(v.invoiceDate)) / DAY) : null,
    creditDays: cd, dueDate, daysToDue,
    collected: isCollected,
    overdue: daysToDue != null && daysToDue < 0 && !isCollected,
  };
}

/**
 * Operations sheets under each invoice, read live rather than from the stored reportNumbers copy.
 * Sheets arrive every minute from the operations platform, so the stored copy lags the latest import.
 * An invoice can group several sheets; most older ledger invoices legitimately have none.
 */
async function attachReportNumbers(rows) {
  const { invoiceNumberKey } = require('../utils/invoiceNumberKey');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const keys = new Map();   // Folded key to invoice numbers as written
  for (const r of rows) {
    const k = invoiceNumberKey(r.invoiceNumber);
    if (k) keys.set(k, true);
  }
  if (!keys.size) return rows;
  // Query by the numbers as written (indexed), then match by folded key so a leading-zero variant in either record is not missed.
  const raw = rows.map((r) => String(r.invoiceNumber || '')).filter(Boolean);
  const sheets = await OperationsWorkflow.find({ invoiceNumber: { $in: raw } })
    .select('reportNumber invoiceNumber').lean();
  const byKey = new Map();
  for (const w of sheets) {
    const k = invoiceNumberKey(w.invoiceNumber);
    const rn = String(w.reportNumber || '').trim();
    if (!k || !rn) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(rn);
  }
  for (const r of rows) {
    const k = invoiceNumberKey(r.invoiceNumber);
    const hit = k && byKey.get(k);
    if (hit) r.reportNumbers = [...hit].sort();
  }
  return rows;
}

// GET /api/collections-dept/ledger/invoices
exports.invoices = async (req, res) => {
  try {
    const { page = 1, limit = 50, band } = req.query;
    const filter = invoiceFilter(req.query);

    // The officer filter goes through the account; the invoice does not carry the name.
    if (req.query.officer) {
      // Filter by link, not code: some cash shipments in the ledger have no code but a known account.
      // The manager's name also includes unassigned accounts (see utils/collectionsOfficer).
      filter.party = { $in: await CollectionsParty.distinct('_id', {
        kind: 'customer',
        ...officerCondition(req.query.officer, await collectionsManager()),
      }) };
    }

    const today = startOfToday();
    // Cap fits the export size the screen requests (5000); a lower cap silently truncated the file.
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(20000, Math.max(1, parseInt(limit, 10)));

    // Credit term is an account property: read once and attached to its invoices.
    const cdById = new Map((await CollectionsParty.find({ kind: 'customer', creditDays: { $gt: 0 } })
      .select('creditDays').lean()).map((x) => [String(x._id), x.creditDays || 0]));
    const creditDaysOf = (v) => cdById.get(String(v.party)) || 0;

    if (band && BANDS.some((b) => b.key === band)) {
      // The band is a condition on a computed value, so it is applied after the read; totals cover the whole result, not the page.
      const all = await CollectionInvoice.find(filter).select('-__v').lean();
      const dec = all.map((v) => decorate(v, today, creditDaysOf)).filter((v) => v.band === band);
      const sum = dec.reduce((s, v) => s + v.total, 0);
      const slice = await attachReportNumbers(dec.slice((p - 1) * l, p * l));
      return res.json({ rows: slice, total: dec.length, page: p, pages: Math.ceil(dec.length / l), sum, bands: BANDS });
    }

    const [rows, total, agg] = await Promise.all([
      CollectionInvoice.find(filter).select('-__v').sort({ invoiceDate: -1, invoiceNumber: -1 }).skip((p - 1) * l).limit(l).lean(),
      CollectionInvoice.countDocuments(filter),
      CollectionInvoice.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$total' } } }]),
    ]);
    res.json({
      rows: await attachReportNumbers(rows.map((v) => decorate(v, today, creditDaysOf))),
      total, page: p, pages: Math.ceil(total / l), sum: agg[0]?.sum || 0, bands: BANDS,
    });
  } catch (e) {
    console.error('ledger invoices error:', e);
    res.status(500).json({ message: 'تعذّر جلبُ الفواتير' });
  }
};

// GET /api/collections-dept/ledger/invoices/filters
exports.invoiceFilters = async (req, res) => {
  try {
    const mgr = await collectionsManager();
    const key = `${CACHE_PREFIX}invfilters:${mgr?.name || ''}`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);
    const [statuses, kinds] = await Promise.all([
      CollectionInvoice.distinct('status'),
      CollectionInvoice.distinct('kind'),
    ]);
    const officers = await CollectionsParty.distinct('collectionOfficer', { kind: 'customer', code: { $gt: '' } });
    const out = {
      statuses: statuses.filter(Boolean).sort(),
      kinds: kinds.filter(Boolean).sort(),
      officers: withManager(officers.filter(Boolean), mgr),
      bands: BANDS,
    };
    cache.set(key, out, 300);
    res.json(out);
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ قيم الفلاتر' }); }
};

// Alerts: computed, never stored
/**
 * Two alert kinds. Credit limit: customer debt nears the agreed ceiling, flagged before it is reached.
 * Due date: a delivered invoice whose term ends in a few days, counted from delivery.
 * Alerts are computed on each open; only the acknowledgement (a human decision) is stored.
 */
const LIMIT_WARN_PCT = 80;     // Nearing means 80 percent of the limit.
const DUE_WARN_DAYS = 3;       // Alerts fire three days before the due date.

/**
 * The screen shows five rows and a count of the rest. Counts are computed over all rows; rows are truncated at `rows`.
 * Truncation happens after the cache so the key does not depend on rows and callers share one computation.
 */
const ALERT_ROWS_MAX = 1000;
/** Counts stay complete and rows are truncated; the cached answer is untouched. */
const sliceAlerts = (out, rows) => ({
  ...out,
  limit: out.limit.length > rows ? out.limit.slice(0, rows) : out.limit,
  due: out.due.length > rows ? out.due.slice(0, rows) : out.due,
  rows,
});
// GET /api/collections-dept/ledger/alerts
exports.alerts = async (req, res) => {
  try {
    // No count requested means all rows, so an old client that does not send the parameter loses nothing.
    const { rows: rowsQ, ...rest } = req.query || {};
    const rows = Math.min(ALERT_ROWS_MAX, Math.max(1, parseInt(rowsQ, 10) || ALERT_ROWS_MAX));
    const cacheKey = keyOf('alerts', { query: rest, user: req.user });
    const cached = cache.get(cacheKey);
    if (cached) return res.json(sliceAlerts(cached, rows));
    const warnPct = Number(req.query.warnPct) || LIMIT_WARN_PCT;
    const warnDays = Number(req.query.warnDays) || DUE_WARN_DAYS;
    const today = startOfToday();

    const mgr = await collectionsManager();
    const parties = await CollectionsParty.find({ ...partyFilter(req.query, await ledgerPartyBase(), mgr), isActive: { $ne: false } })
      .select('code name creditLimit creditDays collectionOfficer hoLocation grade paymentType').lean();
    const ids = parties.map((p) => p._id);
    // Run the three queries in parallel: none depends on another, and sequential trips to the shared cluster tripled the latency.
    // Use the link, not the written code: an invoice code may be empty while its account is known.
    const cdByCode = new Map(parties.filter((p) => p.creditDays > 0).map((p) => [String(p._id), p]));
    const [ageMap, acks, open] = await Promise.all([
      agingByParty(ids),
      CreditAlertAck.find({ party: { $in: ids } }).lean(),
      CollectionInvoice.find({ ...OPEN, party: { $in: [...cdByCode.keys()] }, deliveryDate: { $ne: null } })
        .select('invoiceNumber partyCode partyName party total deliveryDate invoiceDate').lean(),
    ]);

    // Credit limit alert
    const ackLimit = new Map(acks.filter((a) => a.kind === 'limit').map((a) => [String(a.party), a]));
    const limitAlerts = [];
    for (const p of parties) {
      if (!p.creditLimit || p.creditLimit <= 0) continue;
      // The limit is measured against the customer's whole balance, tax or cash.
      const out = ageMap.get(String(p._id))?.outstanding || 0;
      const pct = (out / p.creditLimit) * 100;
      if (pct < warnPct) continue;
      // An acknowledgement lapses if debt rises afterwards: seen at 90 percent does not silence 120 percent.
      const ack = ackLimit.get(String(p._id));
      if (ack && out <= (ack.atOutstanding || 0)) continue;
      limitAlerts.push({
        kind: 'limit', party: p._id, code: p.code, name: p.name,
        officer: effectiveOfficer(p.collectionOfficer, mgr), outstanding: out, creditLimit: p.creditLimit,
        pct, over: out > p.creditLimit,
      });
    }
    limitAlerts.sort((a, b) => b.pct - a.pct);

    // Due date alert
    const ackDue = new Set(acks.filter((a) => a.kind === 'due').map((a) => `${a.party}::${a.invoiceNumber}`));
    const dueAlerts = [];
    for (const v of open) {
      const p = cdByCode.get(String(v.party)); if (!p) continue;
      const due = new Date(new Date(v.deliveryDate).getTime() + p.creditDays * DAY);
      const inDays = Math.floor((due - today) / DAY);
      if (inDays > warnDays) continue;                       // Not yet due
      if (ackDue.has(`${v.party}::${v.invoiceNumber}`)) continue;
      // dueDate, severity and code are derived and not exposed: the screen writes the term from deliveryDate + creditDays and colours from the sign of daysToDue.
      dueAlerts.push({
        kind: 'due', party: v.party, name: v.partyName,
        officer: effectiveOfficer(p.collectionOfficer, mgr), invoiceNumber: v.invoiceNumber, total: v.total,
        deliveryDate: v.deliveryDate, creditDays: p.creditDays, daysToDue: inDays,
      });
    }
    dueAlerts.sort((a, b) => a.daysToDue - b.daysToDue);

    const out = {
      limit: limitAlerts,
      due: dueAlerts,
      counts: {
        limitNear: limitAlerts.filter((a) => !a.over).length,
        limitOver: limitAlerts.filter((a) => a.over).length,
        dueSoon: dueAlerts.filter((a) => a.daysToDue >= 0).length,
        overdue: dueAlerts.filter((a) => a.daysToDue < 0).length,
        // Full row count, so the screen can show how many more exist after truncation.
        limitTotal: limitAlerts.length,
        dueTotal: dueAlerts.length,
      },
      settings: { warnPct, warnDays },
    };
    cache.set(cacheKey, out, TTL);
    res.json(sliceAlerts(out, rows));
  } catch (e) {
    console.error('alerts error:', e);
    res.status(500).json({ message: 'تعذّر حسابُ التنبيهات' });
  }
};

// POST /api/collections-dept/ledger/alerts/ack (mark as seen)
exports.ackAlert = async (req, res) => {
  try {
    const { party, kind, invoiceNumber = '', note = '' } = req.body || {};
    if (!party || !['limit', 'due'].includes(kind)) return res.status(400).json({ message: 'بياناتٌ ناقصة' });
    const p = await CollectionsParty.findById(party).select('_id').lean();
    if (!p) return res.status(404).json({ message: 'الحساب غير موجود' });
    // The balance is recorded at acknowledgement time so the alert returns if it rises later.
    const at = kind === 'limit'
      ? (await agingByParty([p._id])).get(String(p._id))?.outstanding || 0 : 0;
    exports.invalidate();
    await CreditAlertAck.findOneAndUpdate(
      { party: p._id, kind, invoiceNumber },
      { $set: { party: p._id, kind, invoiceNumber, atOutstanding: at, note, ackedBy: req.user._id, ackedAt: new Date() } },
      { upsert: true },
    );
    exports.invalidate();
    res.json({ ok: true, atOutstanding: at });
  } catch (e) { res.status(500).json({ message: 'تعذّر إغلاق التنبيه' }); }
};

// Daily plan
// GET /api/collections-dept/ledger/tasks
exports.listTasks = async (req, res) => {
  try {
    const { from, to, officer, party, status, page = 1, limit = 200 } = req.query;
    const f = {};
    if (from || to) { f.date = {}; if (from) f.date.$gte = from; if (to) f.date.$lte = to; }
    if (officer) f.officerName = { $in: Array.isArray(officer) ? officer : [officer] };
    if (party) f.party = party;
    if (status) f.status = { $in: Array.isArray(status) ? status : [status] };
    const p = Math.max(1, parseInt(page, 10)); const l = Math.min(1000, Math.max(1, parseInt(limit, 10)));
    const [rows, total, agg] = await Promise.all([
      CollectionTask.find(f).sort({ date: -1, partyName: 1 }).skip((p - 1) * l).limit(l).lean(),
      CollectionTask.countDocuments(f),
      CollectionTask.aggregate([{ $match: f }, { $group: { _id: null, collected: { $sum: '$collected' } } }]),
    ]);
    res.json({ rows, total, page: p, pages: Math.ceil(total / l), collected: agg[0]?.collected || 0 });
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ المهامّ' }); }
};

// POST /api/collections-dept/ledger/tasks
exports.createTask = async (req, res) => {
  try {
    const { party, date, requestType = '', officerName = '', action = '', status = '', collected = 0, notes = '' } = req.body || {};
    if (!party || !date) return res.status(400).json({ message: 'العميل والتاريخ مطلوبان' });
    const p = await CollectionsParty.findById(party).select('code name collectionOfficer').lean();
    if (!p) return res.status(404).json({ message: 'الحساب غير موجود' });
    const doc = await CollectionTask.findOneAndUpdate(
      { party: p._id, date, requestType },
      { $set: {
        party: p._id, partyCode: p.code, partyName: p.name, date, requestType,
        // A task with no named employee goes to the account officer, usually correct; an unassigned account's officer is the department manager.
        officerName: officerName || effectiveOfficer(p.collectionOfficer, await collectionsManager()),
        planned: true, action, status, collected: Number(collected) || 0, notes,
        createdBy: req.user._id,
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ task: doc });
  } catch (e) { res.status(500).json({ message: 'تعذّر إنشاءُ المهمّة' }); }
};

// PUT /api/collections-dept/ledger/tasks/:id
exports.updateTask = async (req, res) => {
  try {
    const allowed = ['requestType', 'officerName', 'status', 'collected', 'action', 'notes', 'planned', 'date'];
    const set = {};
    for (const k of allowed) if (req.body[k] !== undefined) set[k] = req.body[k];
    const t = await CollectionTask.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!t) return res.status(404).json({ message: 'المهمّة غير موجودة' });
    res.json({ task: t });
  } catch (e) { res.status(500).json({ message: 'تعذّر تعديلُ المهمّة' }); }
};

// DELETE /api/collections-dept/ledger/tasks/:id
exports.deleteTask = async (req, res) => {
  try {
    const t = await CollectionTask.findByIdAndDelete(req.params.id);
    if (!t) return res.status(404).json({ message: 'المهمّة غير موجودة' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'تعذّر حذفُ المهمّة' }); }
};

// Team: who handles whom and how they perform
// GET /api/collections-dept/ledger/team
exports.team = async (req, res) => {
  try {
    const cacheKey = keyOf('team', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const mgr = await collectionsManager();
    const parties = await CollectionsParty.find(await ledgerPartyBase())
      .select('code name collectionOfficer creditLimit paymentType').lean();
    const ageMap = await agingByParty(parties.map((p) => p._id));
    const byOfficer = new Map();
    for (const p of parties) {
      // No unassigned row: unassigned accounts count against the department manager, with a count of how many.
      const k = effectiveOfficer(p.collectionOfficer, mgr);
      if (!byOfficer.has(k)) byOfficer.set(k, { officer: k, isManager: !!mgr && k === mgr.name, defaulted: 0, accounts: 0, outstanding: 0, overLimit: 0, tax: 0, cash: 0 });
      const e = byOfficer.get(k);
      if (isDefaultOfficer(p.collectionOfficer)) e.defaulted += 1;
      // The limit is measured against the customer's whole balance, tax or cash.
      const out = ageMap.get(String(p._id))?.outstanding || 0;
      e.accounts += 1; e.outstanding += out;
      if (p.creditLimit > 0 && out > p.creditLimit) e.overLimit += 1;
      if (p.paymentType === 'cash') e.cash += 1; else e.tax += 1;
    }
    const out = {
      officers: [...byOfficer.values()].sort((a, b) => b.outstanding - a.outstanding),
      manager: mgr ? { name: mgr.name, email: mgr.email } : null,
    };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ الفريق' }); }
};

// PUT /api/collections-dept/ledger/team/assign (who handles these accounts)
exports.assignOfficer = async (req, res) => {
  try {
    const { parties, officer, officerUser } = req.body || {};
    if (!Array.isArray(parties) || !parties.length) return res.status(400).json({ message: 'اختر حسابًا واحدًا على الأقلّ' });
    // Assignment is stored on the account, not on a typed name: the name or id is resolved to its user, and the text is kept for display (as written if given, else the account name).
    const { resolveAssignment } = require('../utils/collectionsOfficer');
    const a = await resolveAssignment({ userId: officerUser, name: officer });
    const text = String(officer || '').trim() || a.text || '';
    const r = await CollectionsParty.updateMany({ _id: { $in: parties } }, {
      $set: { collectionOfficer: text, collectionOfficerUser: text ? (a.user || null) : null },
    });
    exports.invalidate();
    res.json({ ok: true, updated: r.modifiedCount });
  } catch (e) { res.status(500).json({ message: 'تعذّر إسنادُ الحسابات' }); }
};

// Team scoring
// GET /api/collections-dept/ledger/performance
exports.performance = async (req, res) => {
  try {
    const cacheKey = keyOf('performance', req);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const { from, to, officer } = req.query;
    const range = {};
    if (from) range.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) range.$lte = new Date(`${to}T23:59:59.999Z`);
    const hasRange = !!(from || to);

    // Group by the link, not the code typed in the sheet. partyCode is a copy of the invoice sheet's code, while party is the link settled by name matching; they differ for some customers, and grouping by code dropped hundreds of invoices from each employee's account.
    const mgr = await collectionsManager();
    const partyQ = { kind: 'customer', ...(officerCondition(officer, mgr) || {}) };
    const parties = await CollectionsParty.find(partyQ).select('code collectionOfficer creditDays').lean();
    // Effective officer: unassigned accounts are scored against the department manager.
    const officerOf = new Map(parties.map((p) => [String(p._id), effectiveOfficer(p.collectionOfficer, mgr)]));
    const cdOf = new Map(parties.map((p) => [String(p._id), p.creditDays || 0]));
    const ids = parties.map((p) => p._id);
    const today = startOfToday();

    // Totals are computed in the database: pulling thousands of invoices into Node took many seconds on production.
    // Reserved sequence numbers are nobody's work (see models/CollectionInvoice.unused).
    const collectedMatch = { party: { $in: ids }, ...CollectionInvoice.COLLECTED };
    if (hasRange) collectedMatch.collectionDate = range;
    const [collected, open] = await Promise.all([
      CollectionInvoice.aggregate([
        { $match: collectedMatch },
        { $addFields: { _base: { $ifNull: ['$deliveryDate', '$invoiceDate'] } } },
        { $group: {
          _id: '$party', n: { $sum: 1 }, amount: { $sum: '$total' },
          // Average collection days is computed here too: rows without a date are skipped, not counted as zero, which would drag the average down.
          days: { $avg: { $cond: [
            { $or: [{ $eq: ['$_base', null] }, { $eq: ['$collectionDate', null] }] }, null,
            { $dateDiff: { startDate: '$_base', endDate: '$collectionDate', unit: 'day' } },
          ] } },
        } },
      ]),
      CollectionInvoice.aggregate([
        { $match: { ...OPEN, party: { $in: ids } } },
        { $group: { _id: '$party', n: { $sum: 1 }, amount: { $sum: CollectionInvoice.remainingExpr },
          // Not measured by delivery date alone: an undelivered invoice still has an issue date, and dropping it would hide real debt.
          overdue: { $push: { d: { $ifNull: ['$deliveryDate', '$invoiceDate'] }, t: CollectionInvoice.remainingExpr } } } },
      ]),
    ]);

    const stats = new Map();
    const of = (id) => {
      const k = officerOf.get(String(id)) || '';
      if (!stats.has(k)) stats.set(k, { officer: k, accounts: 0, collectedCount: 0, collectedAmount: 0, openCount: 0, openAmount: 0, overdueCount: 0, overdueAmount: 0, withinTermsAmount: 0, agedOver60Amount: 0, _dayNum: 0, _dayDen: 0 });
      return stats.get(k);
    };
    for (const p of parties) of(p._id).accounts += 1;
    for (const c of collected) {
      const e = of(c._id);
      e.collectedCount += c.n; e.collectedAmount += c.amount;
      if (c.days != null) { e._dayNum += c.days * c.n; e._dayDen += c.n; }
    }
    for (const o of open) {
      const e = of(o._id);
      e.openCount += o.n; e.openAmount += o.amount;
      // A zero-day term is not no term: skipping it with `if (!cd) continue` excluded cash-on-delivery accounts from the late calculation, inverting the strictest terms.
      const cd = cdOf.get(String(o._id)) || 0;
      for (const x of o.overdue) {
        if (!x.d) continue;
        const due = new Date(new Date(x.d).getTime() + cd * DAY);
        if (due >= today) { e.withinTermsAmount += x.t; continue; }
        e.overdueCount += 1; e.overdueAmount += x.t;
        // More than sixty days past term is debt close to a loss, not mere lateness.
        if (due < new Date(today.getTime() - 60 * DAY)) e.agedOver60Amount += x.t;
      }
    }

    const rows = [...stats.values()].map((e) => {
      const avg = e._dayDen ? Math.round(e._dayNum / e._dayDen) : null;
      delete e._dayNum; delete e._dayDen;
      // Collection rate is collected out of what has fallen due.
      // The old collected / (collected + open) mixed all-time collections with today's balance, and counted money not yet due against the employee.
      // Now: collected / (collected + overdue), both sides drawn from amounts actually due; money within its term is not bad debt.
      const due = e.collectedAmount + e.overdueAmount;
      // Portfolio health is a separate question read alongside: how much of what they hold is not yet late. A heavy collector with a stale portfolio differs from a lighter one with a clean ledger.
      return {
        ...e,
        avgDaysToCollect: avg,
        collectionRate: due > 0 ? (e.collectedAmount / due) * 100 : null,
        withinTermsRate: e.openAmount > 0 ? (e.withinTermsAmount / e.openAmount) * 100 : null,
        agedOver60Rate: e.overdueAmount > 0 ? (e.agedOver60Amount / e.overdueAmount) * 100 : null,
      };
    }).sort((a, b) => b.collectedAmount - a.collectedAmount);

    const taskQ = {};
    if (from || to) { taskQ.date = {}; if (from) taskQ.date.$gte = from; if (to) taskQ.date.$lte = to; }
    const tasks = await CollectionTask.aggregate([
      { $match: taskQ },
      { $group: { _id: '$officerName', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'Done'] }, 1, 0] } }, collected: { $sum: '$collected' } } },
    ]);
    // A task with no employee name belongs to the manager too and is merged with theirs.
    const taskBy = new Map();
    for (const t of tasks) {
      const k = effectiveOfficer(t._id, mgr);
      const cur = taskBy.get(k) || { total: 0, done: 0, collected: 0 };
      taskBy.set(k, { total: cur.total + t.total, done: cur.done + t.done, collected: cur.collected + t.collected });
    }
    for (const r of rows) {
      const t = taskBy.get(r.officer);
      r.tasks = t?.total || 0; r.tasksDone = t?.done || 0; r.tasksCollected = t?.collected || 0;
    }

    const totals = rows.reduce((a, r) => ({
      accounts: a.accounts + r.accounts, collectedAmount: a.collectedAmount + r.collectedAmount,
      openAmount: a.openAmount + r.openAmount, overdueAmount: a.overdueAmount + r.overdueAmount,
      withinTermsAmount: a.withinTermsAmount + r.withinTermsAmount,
      agedOver60Amount: a.agedOver60Amount + r.agedOver60Amount,
      collectedCount: a.collectedCount + r.collectedCount, openCount: a.openCount + r.openCount,
    }), { accounts: 0, collectedAmount: 0, openAmount: 0, overdueAmount: 0, withinTermsAmount: 0, agedOver60Amount: 0, collectedCount: 0, openCount: 0 });

    const out = { rows, totals, range: { from: from || null, to: to || null } };
    cache.set(cacheKey, out, TTL);
    res.json(out);
  } catch (e) {
    console.error('performance error:', e);
    res.status(500).json({ message: 'تعذّر حسابُ التقييم' });
  }
};

// Link review
// GET /api/collections-dept/ledger/link-suggestions
exports.linkSuggestions = async (req, res) => {
  try {
    const decision = req.query.decision || 'pending';
    const rows = await PartyLinkSuggestion.find(decision === 'all' ? {} : { decision })
      .sort({ score: -1 }).limit(500).lean();
    const counts = await PartyLinkSuggestion.aggregate([{ $group: { _id: '$decision', n: { $sum: 1 } } }]);
    res.json({ rows, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
  } catch (e) { res.status(500).json({ message: 'تعذّر جلبُ الاقتراحات' }); }
};

// POST /api/collections-dept/ledger/link-suggestions/:id (human decision)
exports.decideLink = async (req, res) => {
  try {
    const { decision } = req.body || {};
    if (!['linked', 'separate'].includes(decision)) return res.status(400).json({ message: 'قرارٌ غير معروف' });
    const sug = await PartyLinkSuggestion.findById(req.params.id);
    if (!sug) return res.status(404).json({ message: 'الاقتراح غير موجود' });

    if (decision === 'linked' && sug.candidate && sug.party && String(sug.candidate) !== String(sug.party)) {
      // Merge moves the old record's data to the account: its name becomes another form of the account so operations sheets resolve to it.
      // The old record is disabled, not deleted: deletion breaks references, disabling hides it from lists and keeps the trail.
      const old = await CollectionsParty.findById(sug.candidate).select('name nameKey').lean();
      if (old) {
        await CollectionsParty.updateOne({ _id: sug.party }, {
          $addToSet: { aliases: old.name, aliasKeys: old.nameKey || old.name },
        });
        await CollectionsParty.updateOne({ _id: sug.candidate }, { $set: { isActive: false, notes: `دُمج في الحساب ${sug.code}` } });
      }
    }
    sug.decision = decision; sug.decidedBy = req.user._id; sug.decidedAt = new Date(); sug.decidedHow = 'manual';
    await sug.save();
    // A standalone account for an operations customer with no code takes its code now by its load type, so it does not stay outside the ageing. See classifyCodelessParty.
    if (decision === 'separate' && sug.candidate) {
      const cand = await CollectionsParty.findById(sug.candidate).lean();
      if (cand && !cand.code && cand.isActive !== false) {
        const { classifyCodelessParty } = require('../utils/ensureCollectionsParty');
        try { await classifyCodelessParty(cand, { apply: true }); } catch (_) { /* */ }
      }
    }
    exports.invalidate();
    res.json({ ok: true, suggestion: sug });
  } catch (e) {
    console.error('decideLink error:', e);
    res.status(500).json({ message: 'تعذّر حفظُ القرار' });
  }
};

module.exports.BANDS = BANDS;
module.exports._internals = { partyFilter, invoiceFilter, agingByParty, decorate, bandOf, startOfToday, OPEN, receivablesOnly };
// The dashboard (cdr: cache) reads the same accounts, so moving an employee or raising a limit changes it.
module.exports.invalidate = () => { cache.clear(CACHE_PREFIX); cache.clear('cdr:'); };
