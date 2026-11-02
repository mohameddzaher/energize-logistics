/**
 * Receivables: collections dashboard as a self-reconciling tree, read from the invoice ledger (most invoices have no operations sheet).
 * Invariants: total = tax + cash = sum of age bands (+ no date); band = normal + medium + high; each payment type = due + not due.
 * Every node's rows come from the same rows that were counted (loadBase() then passes()). Age counts from delivery date, else issue (see two-delivery-dates); due = that day + creditDays.
 * Severity: normal age <= N, medium <= N+30, high beyond; no saved term uses DEFAULT_TERM_DAYS for severity only (no term means due now, noterm).
 */
const mongoose = require('mongoose');
const CollectionInvoice = require('../models/CollectionInvoice');
const CollectionsParty = require('../models/CollectionsParty');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { SUBTYPE_KEYS, subtypeFamily, PAYMENT_KIND_AR } = require('../utils/paymentType');
const { collectionsManager, effectiveOfficer, isDefaultOfficer } = require('../utils/collectionsOfficer');

const DAY = 86400000;
const TTL = 30 * 1000;

/** Payment term used to measure severity for a customer with no saved term. */
const DEFAULT_TERM_DAYS = 30;
/** Width of the medium band after the term: (N, N+30]. */
const RISK_SPAN_DAYS = 30;
/** Age bands: upper bound inclusive; the first band includes zero and below. */
const AGE_BANDS = [
  { key: 'd1_15', max: 15, ar: '١ – ١٥ يومًا', en: '1–15 days' },
  { key: 'd16_30', max: 30, ar: '١٦ – ٣٠ يومًا', en: '16–30 days' },
  { key: 'd31_60', max: 60, ar: '٣١ – ٦٠ يومًا', en: '31–60 days' },
  { key: 'd61_90', max: 90, ar: '٦١ – ٩٠ يومًا', en: '61–90 days' },
  { key: 'd91_plus', max: null, ar: 'أكثر من ٩٠ يومًا', en: 'Over 90 days' },
];
const BAND_KEYS = [...AGE_BANDS.map((b) => b.key), 'nodate'];
const RISKS = ['normal', 'medium', 'hard'];
const PAY_KINDS = ['tax', 'cash', ...SUBTYPE_KEYS];
const DUE_STATES = ['within', 'late', 'noterm'];
const ISSUES = ['none', 'negotiating', 'legal'];

const ageBandOf = (age) => {
  if (age == null || Number.isNaN(age)) return 'nodate';
  return AGE_BANDS.find((b) => b.max == null || age <= b.max).key;
};
const termOf = (creditDays) => (Number(creditDays) > 0 ? Number(creditDays) : DEFAULT_TERM_DAYS);
const riskOf = (age, creditDays) => {
  if (age == null || Number.isNaN(age)) return 'nodate';
  const n = termOf(creditDays);
  if (age <= n) return 'normal';
  if (age <= n + RISK_SPAN_DAYS) return 'medium';
  return 'hard';
};

/** An invoice is outstanding unless collected or a reserved number. */
const OUTSTANDING = CollectionInvoice.OPEN;

/** Shared pipeline stages: join the customer's term, then derive due date, lateness, age and dispute state for every ledger invoice. */
const derive = () => [
  {
    $lookup: {
      from: 'collectionsparties',
      localField: 'party',
      foreignField: '_id',
      as: '_p',
      pipeline: [{ $project: { creditDays: 1, collectionOfficer: 1, issue: 1, name: 1, code: 1 } }],
    },
  },
  { $addFields: { _party: { $first: '$_p' } } },
  {
    $addFields: {
      creditDays: { $ifNull: ['$_party.creditDays', 0] },
      officer: { $ifNull: ['$_party.collectionOfficer', ''] },
      issueState: { $ifNull: ['$_party.issue.state', 'none'] },
      // Dispute state and since when; read by the cases page and the receivables table.
      issueNote: { $ifNull: ['$_party.issue.note', ''] },
      issueSince: { $ifNull: ['$_party.issue.since', null] },
      // Counting basis: delivery date if present, else issue date, and which one is reported.
      basis: { $cond: [{ $ne: ['$deliveryDate', null] }, 'delivery', 'invoice'] },
      basisDate: { $ifNull: ['$deliveryDate', '$invoiceDate'] },
    },
  },
  {
    $addFields: {
      age: {
        $cond: [{ $eq: ['$basisDate', null] }, null,
          { $dateDiff: { startDate: '$basisDate', endDate: '$$NOW', unit: 'day' } }],
      },
      dueDate: {
        $cond: [
          { $or: [{ $eq: ['$basisDate', null] }, { $lte: ['$creditDays', 0] }] }, null,
          { $dateAdd: { startDate: '$basisDate', unit: 'day', amount: '$creditDays' } },
        ],
      },
    },
  },
  {
    $addFields: {
      daysLate: {
        $cond: [{ $eq: ['$dueDate', null] }, null,
          { $dateDiff: { startDate: '$dueDate', endDate: '$$NOW', unit: 'day' } }],
      },
    },
  },
  {
    $addFields: {
      // No term is a visible third state: with no due date it cannot be called on time.
      dueState: {
        $switch: {
          branches: [
            { case: { $eq: ['$dueDate', null] }, then: 'noterm' },
            { case: { $lte: ['$daysLate', 0] }, then: 'within' },
          ],
          default: 'late',
        },
      },
      // Legacy lateness bands, kept in the response for already-installed app versions.
      lateBand: {
        $switch: {
          branches: [
            { case: { $eq: ['$dueDate', null] }, then: 'none' },
            { case: { $lte: ['$daysLate', 0] }, then: 'none' },
            { case: { $lte: ['$daysLate', 30] }, then: 'd1_30' },
            { case: { $lte: ['$daysLate', 60] }, then: 'd31_60' },
          ],
          default: 'd60_plus',
        },
      },
    },
  },
  { $project: { _p: 0, _party: 0 } },
];

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
/**
 * The amount left on the row, which the dashboard counts as debt.
 * A partial invoice stays open until complete, but only its remainder is owed, so value sums use this, not total.
 */
const owed = (r) => (Number(r.total) || 0) - (Number(r.collected) || 0);

// The four types: where each row's type is read from

const TAX_SUBS = SUBTYPE_KEYS.filter((k) => subtypeFamily(k) === 'tax');
const CASH_SUBS = SUBTYPE_KEYS.filter((k) => subtypeFamily(k) === 'cash');
const CANCELLED_EXEC = ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'];
/** Due means past its date or with no date; not due means within its term. */
const isDue = (dueState) => dueState !== 'within';

/**
 * Ledger invoice type, derived from its sheets at query time and not copied to the ledger.
 * When an invoice's sheets differ, the most common type wins; ties go to the new type over untyped tax (a hand-picked type is deliberate, blank is stale). An invoice with no local sheets has no type.
 * @returns {Map<string, string>} invoice number to type ('' = tax with no type)
 */
async function subtypeOfInvoices(numbers) {
  const list = [...new Set((numbers || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  const agg = await OperationsWorkflow.aggregate([
    { $match: { invoiceNumber: { $in: list }, paymentType: { $ne: 'cash' }, executionStatus: { $nin: CANCELLED_EXEC } } },
    { $group: { _id: { inv: '$invoiceNumber', sub: { $ifNull: ['$paymentSubtype', ''] } }, n: { $sum: 1 } } },
  ]);
  const best = new Map();
  for (const r of agg) {
    const inv = String(r._id.inv || '').trim();
    const sub = String(r._id.sub || '');
    const cur = best.get(inv);
    if (!cur || r.n > cur.n || (r.n === cur.n && sub && (!cur.sub || sub < cur.sub))) best.set(inv, { sub, n: r.n });
  }
  for (const [inv, b] of best) out.set(inv, b.sub);
  return out;
}

/** Type of a cash shipment in the ledger, from its workflow sheet if that has a cash type. The ledger's cash shipment number is the sheet number. Without a typed cash sheet it stays plain cash. */
async function cashSubtypeOfReports(numbers) {
  const list = [...new Set((numbers || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  const docs = await OperationsWorkflow.find({
    reportNumber: { $in: list }, paymentType: 'cash', paymentSubtype: { $in: CASH_SUBS },
    executionStatus: { $nin: CANCELLED_EXEC },
  }).select('reportNumber paymentSubtype').lean();
  for (const d of docs) out.set(String(d.reportNumber || '').trim(), d.paymentSubtype);
  return out;
}

/**
 * Outstanding cash sheets of the three types, from the workflow rather than the ledger.
 * Uses the cash invoices page's own filter (cashScreenFilter) and what is not yet collected. Value is the selling value; the term counts from customer delivery, else payment date, derived as derive() does for the ledger.
 */
async function cashSubtypeRows(q = {}, subs = CASH_SUBS) {
  const { cashScreenFilter } = require('./collectionsDeptController');
  // open: not complete; a partial one is still open for its remainder (see owed).
  const filter = cashScreenFilter({
    collected: 'open',
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
  });
  filter.paymentSubtype = { $in: subs };
  const docs = await OperationsWorkflow.find(filter)
    .select('reportNumber username paymentDate deliveryDate sellingValue collectedAmount paymentSubtype').lean();
  const keys = [...new Set(docs.map((w) => CollectionsParty.fold(w.username || '')).filter(Boolean))];
  const parties = keys.length
    ? await CollectionsParty.find({ kind: 'customer', nameKey: { $in: keys } })
      .select('_id name code nameKey creditDays collectionOfficer issue').lean()
    : [];
  const byKey = new Map(parties.map((p) => [p.nameKey, p]));
  const today = Math.floor(Date.now() / DAY);
  return docs.map((w) => {
    const p = byKey.get(CollectionsParty.fold(w.username || '')) || null;
    const creditDays = Number(p?.creditDays) || 0;
    const basisDate = w.deliveryDate || w.paymentDate || null;
    const dueDate = basisDate && creditDays > 0 ? new Date(new Date(basisDate).getTime() + creditDays * DAY) : null;
    // $dateDiff in days counts UTC day boundaries, so it is computed the same way here.
    const daysLate = dueDate ? today - Math.floor(dueDate.getTime() / DAY) : null;
    const age = basisDate ? today - Math.floor(new Date(basisDate).getTime() / DAY) : null;
    return {
      _id: w._id,
      invoiceNumber: String(w.reportNumber || ''),
      reportNumber: String(w.reportNumber || ''),
      kind: 'cash',
      source: 'workflow',
      payKind: w.paymentSubtype,
      total: r2(w.sellingValue),
      partyName: w.username || '',
      partyCode: p?.code || '',
      party: p?._id || null,
      invoiceDate: w.paymentDate || null,
      deliveryDate: w.deliveryDate || null,
      status: '',
      creditDays,
      officer: p?.collectionOfficer || '',
      issueState: p?.issue?.state || 'none',
      issueNote: p?.issue?.note || '',
      issueSince: p?.issue?.since || null,
      // An incomplete sheet may carry a partial payment, subtracted from its value in every total (owed).
      collected: r2(w.collectedAmount),
      basis: w.deliveryDate ? 'delivery' : 'payment',
      dueDate,
      daysLate,
      age,
      dueState: dueDate == null ? 'noterm' : (daysLate <= 0 ? 'within' : 'late'),
      lateBand: 'none',
    };
  });
}

// Rows once, then everything is counted from them

/**
 * Everything the dashboard counts, without filters (except the date range):
 * ledger: open ledger invoices of both types (total and age bands);
 * cashWf: cash sheets of the three types (their cards).
 * Loaded once: filtering about fifteen hundred open invoices in Node is cheaper than one aggregation per card or filter, and guarantees card and table use the same rows. Cached 30 seconds under a key holding only the range; every write in the department clears cdr:, which crosses both workers.
 */
async function loadBase(q = {}) {
  const from = String(q.from || ''); const to = String(q.to || '');
  return cache.wrap(`cdr:base:${from}|${to}`, TTL, async () => {
    const match = { ...OUTSTANDING };
    if (from || to) {
      match.invoiceDate = {};
      if (from) match.invoiceDate.$gte = new Date(from);
      if (to) match.invoiceDate.$lte = new Date(`${to}T23:59:59.999Z`);
    }
    const [ledger, cashWf] = await Promise.all([
      CollectionInvoice.aggregate([
        { $match: match },
        ...derive(),
        {
          $project: {
            invoiceNumber: 1, kind: 1, total: 1, collectedAmount: 1, partyName: 1, partyCode: 1, party: 1,
            invoiceDate: 1, deliveryDate: 1, status: 1,
            creditDays: 1, officer: 1, issueState: 1, issueNote: 1, issueSince: 1, basis: 1, dueDate: 1, daysLate: 1,
            age: 1, dueState: 1, lateBand: 1,
          },
        },
      ]).allowDiskUse(true),
      cashSubtypeRows({ from, to }),
    ]);

    const taxNos = ledger.filter((r) => r.kind === 'tax').map((r) => String(r.invoiceNumber || '').trim());
    const cashNos = ledger.filter((r) => r.kind === 'cash').map((r) => String(r.invoiceNumber || '').trim());
    const { countsFor } = require('./collectionsAttachmentsController');
    const [subOfTax, subOfCash, attTax, attCash, wfOfCash] = await Promise.all([
      subtypeOfInvoices(taxNos),
      cashSubtypeOfReports(cashNos),
      countsFor('tax', taxNos),
      countsFor('cash', cashWf.map((r) => String(r._id))),
      // A cash ledger shipment's number is its sheet number, which opens the sheet from the table.
      cashNos.length
        ? OperationsWorkflow.find({ reportNumber: { $in: [...new Set(cashNos.filter(Boolean))] } }).select('_id reportNumber').lean()
        : [],
    ]);
    const wfIdOf = new Map(wfOfCash.map((w) => [String(w.reportNumber || '').trim(), String(w._id)]));
    // Clearance transaction per row: tax by its invoice's sheets, cash by its own sheet.
    const customsLinks = require('../services/customsOpsLink');
    const linked = await customsLinks.linkedIndex();

    for (const r of ledger) {
      const no = String(r.invoiceNumber || '').trim();
      if (r.kind === 'tax') {
        const sub = subOfTax.get(no) || '';
        r.payKind = TAX_SUBS.includes(sub) ? sub : 'tax';
        r.attachments = attTax.get(no) || 0;
      } else {
        r.payKind = subOfCash.get(no) || 'cash';
        r.attachments = null;
        r.workflowId = wfIdOf.get(no) || null;
      }
      r.customs = r.kind === 'tax'
        ? customsLinks.customsOfInvoice(linked, no)
        : [customsLinks.customsOfReport(linked, no)].filter(Boolean);
      r.total = r.total || 0;
      // The list here is incomplete rows, which may include a partial payment subtracted from the value.
      r.collected = r2(r.collectedAmount || 0);
      r.ageBand = ageBandOf(r.age);
      r.risk = riskOf(r.age, r.creditDays);
    }
    // A cash shipment already in the ledger is counted there, so not twice in the filter counters.
    const ledgerCash = new Set(cashNos);
    for (const r of cashWf) {
      r.attachments = attCash.get(String(r._id)) || 0;
      r.ageBand = ageBandOf(r.age);
      r.risk = riskOf(r.age, r.creditDays);
      r.inLedger = ledgerCash.has(String(r.reportNumber || '').trim());
      r.customs = [customsLinks.customsOfReport(linked, r.reportNumber)].filter(Boolean);
    }
    return { ledger, cashWf };
  });
}

// Filters, applied to rows before any count

const listOf = (v) => [].concat(v == null ? [] : v)
  .flatMap((x) => String(x).split(','))
  .map((s) => s.trim())
  .filter(Boolean);

/** Customer key: its account if linked, else its folded name. */
const partyKey = (r) => (r.party ? String(r.party) : `n:${CollectionsParty.fold(r.partyName || '')}`);

/**
 * Dashboard filters from the URL: officer (legacy none = manager), parties (account id or n:<folded name>), pay (the six payment types), dueState=within,late,noterm, issue=none,negotiating,legal.
 * Legacy: party=<id> merges into parties; customer=<name> is a name search.
 */
function parseFilters(q = {}, mgr) {
  const officer = new Set(listOf(q.officer).map((v) => (v === 'none' ? (mgr?.name || '') : v).toLowerCase()).filter(Boolean));
  const parties = new Set(listOf(q.parties));
  if (q.party && mongoose.isValidObjectId(String(q.party))) parties.add(String(q.party));
  return {
    officer,
    parties,
    pay: new Set(listOf(q.pay).filter((v) => PAY_KINDS.includes(v))),
    dueState: new Set(listOf(q.dueState).filter((v) => DUE_STATES.includes(v))),
    issue: new Set(listOf(q.issue).filter((v) => ISSUES.includes(v))),
    customerRx: q.customer ? flexSpaceRegex(String(q.customer)) : null,
  };
}

/** Measures each dimension on its own; used for the filter counters (each under the other dimensions). */
const DIMS = {
  officer: (r, f, mgr) => f.officer.has(effectiveOfficer(r.officer, mgr).toLowerCase()),
  parties: (r, f) => f.parties.has(partyKey(r)),
  pay: (r, f) => f.pay.has(r.payKind),
  dueState: (r, f) => f.dueState.has(r.dueState),
  issue: (r, f) => f.issue.has(r.issueState || 'none'),
};

function passes(r, f, mgr, except = '') {
  for (const [k, test] of Object.entries(DIMS)) {
    if (k === except || !f[k].size) continue;
    if (!test(r, f, mgr)) return false;
  }
  if (f.customerRx && !f.customerRx.test(r.partyName || '')) return false;
  return true;
}

/** A node: value, count (tax invoices and cash sheets, shown separately since they are different units) and customer count. */
function node(rows, pick = () => true) {
  let count = 0; let value = 0; let tax = 0; let cash = 0;
  const customers = new Set();
  for (const r of rows) {
    if (!pick(r)) continue;
    count += 1; value += owed(r);
    if (r.kind === 'tax') tax += 1; else cash += 1;
    customers.add(partyKey(r));
  }
  return { count, value: r2(value), customers: customers.size, tax, cash };
}

const check = (of, whole, parts) => {
  const diff = r2(whole.value - parts.reduce((a, p) => a + p.value, 0));
  const n = whole.count - parts.reduce((a, p) => a + p.count, 0);
  return { of, diff, n, ok: Math.abs(diff) < 0.5 && n === 0 };
};

/**
 * GET /api/collections-dept/receivables/overview
 * ?from=&to=&officer=&parties=&pay=&dueState=&issue=   (see parseFilters)
 */
exports.overview = async (req, res) => {
  try {
    const q = req.query || {};
    const mgr = await collectionsManager();
    const key = `cdr:ov:${mgr?.name || ''}:${JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]]))}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    const base = await loadBase(q);
    const f = parseFilters(q, mgr);
    const L = base.ledger.filter((r) => passes(r, f, mgr));
    const W = base.cashWf.filter((r) => passes(r, f, mgr));
    const tax = (r) => r.kind === 'tax';
    const cash = (r) => r.kind === 'cash';

    const tree = {
      all: node(L),
      byKind: { tax: node(L, tax), cash: node(L, cash) },
      // Age bands, each with its three parts
      ages: Object.fromEntries(BAND_KEYS.map((b) => {
        const inBand = L.filter((r) => r.ageBand === b);
        return [b, {
          total: node(inBand),
          ...(b === 'nodate' ? {} : Object.fromEntries(RISKS.map((k) => [k, node(inBand, (r) => r.risk === k)]))),
        }];
      })),
      risk: Object.fromEntries(RISKS.map((k) => [k, node(L, (r) => r.risk === k)])),
      // Fields read by already-installed apps (copies distributed before the new dashboard)
      tax: {
        within: node(L, (r) => tax(r) && r.dueState === 'within'),
        late: node(L, (r) => tax(r) && r.dueState === 'late'),
        noterm: node(L, (r) => tax(r) && r.dueState === 'noterm'),
        bands: {
          d1_30: node(L, (r) => tax(r) && r.lateBand === 'd1_30'),
          d31_60: node(L, (r) => tax(r) && r.lateBand === 'd31_60'),
          d60_plus: node(L, (r) => tax(r) && r.lateBand === 'd60_plus'),
        },
        // The old dashboard page reads it without a guard and may stay open in tabs not refreshed after deploy; its absence would crash it (reading 'negotiating').
        over60: {
          negotiating: node(L, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'negotiating'),
          legal: node(L, (r) => tax(r) && r.lateBand === 'd60_plus' && r.issueState === 'legal'),
          unclassified: node(L, (r) => tax(r) && r.lateBand === 'd60_plus' && (r.issueState || 'none') === 'none'),
        },
      },
      cash: {
        within: node(L, (r) => cash(r) && r.dueState === 'within'),
        late: node(L, (r) => cash(r) && r.dueState === 'late'),
        noterm: node(L, (r) => cash(r) && r.dueState === 'noterm'),
      },
    };

    // The four types: due and not due
    tree.subtypes = Object.fromEntries(SUBTYPE_KEYS.map((k) => {
      const mine = (subtypeFamily(k) === 'tax' ? L : W).filter((r) => r.payKind === k);
      return [k, {
        total: node(mine),
        due: node(mine, (r) => isDue(r.dueState)),
        notDue: node(mine, (r) => !isDue(r.dueState)),
      }];
    }));

    // Credit-invoice without an attachment: an invoice with no image in the system is claimed without evidence.
    // A second line covers tax with no new type (most of the ledger), so a zero on the card is not read as nothing missing.
    const attachments = {
      of: node(L, (r) => r.payKind === 'deferred_invoice'),
      missing: node(L, (r) => r.payKind === 'deferred_invoice' && !r.attachments),
      plainTaxMissing: node(L, (r) => r.payKind === 'tax' && !r.attachments),
    };

    // Who is measured on the default term
    const onDefault = L.filter((r) => !(Number(r.creditDays) > 0));
    const dParties = new Map();
    for (const r of onDefault) {
      const k = partyKey(r);
      if (!dParties.has(k)) {
        dParties.set(k, {
          key: k, party: r.party || null, name: r.partyName || '—', code: r.partyCode || '',
          officer: effectiveOfficer(r.officer, mgr), officerIsDefault: isDefaultOfficer(r.officer),
          count: 0, value: 0, tax: 0, cash: 0,
        });
      }
      const g = dParties.get(k);
      g.count += 1; g.value += owed(r); if (r.kind === 'tax') g.tax += 1; else g.cash += 1;
    }
    const defaultTerm = {
      days: DEFAULT_TERM_DAYS,
      ...node(onDefault),
      parties: [...dParties.values()].map((g) => ({ ...g, value: r2(g.value) })).sort((a, b) => b.value - a.value),
    };

    // Verification ships with the numbers: the difference is computed here and shown on the screen if any, instead of being found by manual summing.
    const ages = tree.ages;
    const checks = [
      check('الإجمالي = ضريبي + نقدي', tree.all, [tree.byKind.tax, tree.byKind.cash]),
      check('الإجمالي = شرائح العمر الخمس + بلا تاريخ', tree.all, BAND_KEYS.map((b) => ages[b].total)),
      ...AGE_BANDS.map((b) => check(`«${b.ar}» = طبيعي + متوسط + مرتفع`, ages[b.key].total, RISKS.map((k) => ages[b.key][k]))),
      check('الإجمالي = طبيعي + متوسط + مرتفع + بلا تاريخ', tree.all, [...RISKS.map((k) => tree.risk[k]), ages.nodate.total]),
      ...SUBTYPE_KEYS.map((k) => {
        const c = tree.subtypes[k];
        return check(`«${PAYMENT_KIND_AR[k]}» = مستحق + غير مستحق`, c.total, [c.due, c.notDue]);
      }),
    ];

    // Heaviest customers; opening one opens it by its account.
    const byParty = new Map();
    for (const r of L) {
      const k = partyKey(r);
      if (!byParty.has(k)) {
        byParty.set(k, {
          party: r.party || null, key: k, name: r.partyName || '—', code: r.partyCode || '',
          officer: effectiveOfficer(r.officer, mgr), officerIsDefault: isDefaultOfficer(r.officer),
          issueState: r.issueState || 'none',
          count: 0, value: 0, late: 0, lateValue: 0, hard: 0, hardValue: 0, oldest: null,
        });
      }
      const g = byParty.get(k);
      g.count += 1; g.value += owed(r);
      if (r.dueState === 'late') { g.late += 1; g.lateValue += owed(r); }
      if (r.risk === 'hard') { g.hard += 1; g.hardValue += owed(r); }
      if (r.age != null && (g.oldest == null || r.age > g.oldest)) g.oldest = r.age;
    }
    const parties = [...byParty.values()]
      .map((g) => ({ ...g, value: r2(g.value), lateValue: r2(g.lateValue), hardValue: r2(g.hardValue) }))
      .sort((a, b) => b.value - a.value);

    // By effective officer; no unassigned row, unassigned falls on the manager.
    const byOfficer = new Map();
    for (const r of L) {
      const k = effectiveOfficer(r.officer, mgr) || '—';
      if (!byOfficer.has(k)) {
        byOfficer.set(k, {
          officer: k, isManager: !!mgr && k === mgr.name, defaulted: 0,
          count: 0, value: 0, late: 0, lateValue: 0, hard: 0, hardValue: 0,
        });
      }
      const g = byOfficer.get(k);
      g.count += 1; g.value += owed(r);
      if (isDefaultOfficer(r.officer)) g.defaulted += 1;
      if (r.dueState === 'late') { g.late += 1; g.lateValue += owed(r); }
      if (r.risk === 'hard') { g.hard += 1; g.hardValue += owed(r); }
    }

    // Filter counters: each list under the other filters, over everything the dashboard counts: the ledger plus cash sheets of the types not in it.
    const U = [...base.ledger, ...base.cashWf.filter((r) => !r.inLedger)];
    const facet = (dim, keyOf, labelOf) => {
      const m = new Map();
      for (const r of U) {
        if (!passes(r, f, mgr, dim)) continue;
        const k = keyOf(r);
        if (!m.has(k)) m.set(k, { value: k, label: labelOf(r, k), count: 0, amount: 0 });
        const e = m.get(k); e.count += 1; e.amount += owed(r);
      }
      return m;
    };
    const fixed = (m, keys) => keys.map((k) => ({ value: k, count: m.get(k)?.count || 0, amount: r2(m.get(k)?.amount) }));
    const off = facet('officer', (r) => effectiveOfficer(r.officer, mgr) || '—', (r, k) => k);
    if (mgr?.name && !off.has(mgr.name)) off.set(mgr.name, { value: mgr.name, label: mgr.name, count: 0, amount: 0 });
    const cust = facet('parties', partyKey, (r) => r.partyName || '—');
    const custCode = new Map(U.map((r) => [partyKey(r), r.partyCode || '']));
    const facets = {
      officer: [...off.values()].map((e) => ({ ...e, amount: r2(e.amount), isManager: !!mgr && e.value === mgr.name }))
        .sort((a, b) => b.amount - a.amount),
      parties: [...cust.values()].map((e) => ({ ...e, amount: r2(e.amount), code: custCode.get(e.value) || '' }))
        .sort((a, b) => b.amount - a.amount),
      pay: fixed(facet('pay', (r) => r.payKind, () => ''), PAY_KINDS),
      dueState: fixed(facet('dueState', (r) => r.dueState, () => ''), DUE_STATES),
      issue: fixed(facet('issue', (r) => r.issueState || 'none', () => ''), ISSUES),
    };

    const body = {
      tree,
      checks,
      attachments,
      defaultTerm,
      facets,
      manager: mgr ? { name: mgr.name, email: mgr.email } : null,
      rules: { defaultTermDays: DEFAULT_TERM_DAYS, riskSpanDays: RISK_SPAN_DAYS, bands: AGE_BANDS },
      parties: parties.slice(0, 300),
      officers: [...byOfficer.values()].map((g) => ({
        ...g, value: r2(g.value), lateValue: r2(g.lateValue), hardValue: r2(g.hardValue),
      })).sort((a, b) => b.value - a.value),
      generatedAt: new Date(),
    };
    cache.set(key, body, TTL);
    res.json(body);
  } catch (e) {
    console.error('receivables overview', e);
    res.status(500).json({ message: 'تعذّر حساب المديونية' });
  }
};

// Card rows: the receivables details page and its cases

const RIYADH = 'Asia/Riyadh';
/** Riyadh day YYYY-MM-DD; date columns are filtered by it as displayed. */
const ymd = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-CA', { timeZone: RIYADH });
};
const ROWS_CAP = 20000;

/**
 * Node from the URL, narrowing rows beyond the dashboard filters: kind=tax|cash; subtype=<type>&due=due|notdue; band=<band>&risk=normal|medium|hard;
 * attach=missing|missing_tax (no attachment); term=default (default-term customers);
 * lateBand=d1_30|d31_60|d60_plus (legacy bands for saved links).
 */
function nodeOf(q = {}) {
  const subtype = SUBTYPE_KEYS.includes(String(q.subtype || '')) ? String(q.subtype) : '';
  return {
    subtype,
    // A cash type card's rows are the cash sheets (cashSubtypeRows); everything else is the ledger.
    workflow: !!subtype && subtypeFamily(subtype) === 'cash',
    due: ['due', 'notdue'].includes(q.due) ? q.due : '',
    band: BAND_KEYS.includes(String(q.band || '')) ? String(q.band) : '',
    risk: RISKS.includes(String(q.risk || '')) ? String(q.risk) : '',
    kind: ['tax', 'cash'].includes(q.kind) ? q.kind : '',
    lateBand: ['d1_30', 'd31_60', 'd60_plus'].includes(q.lateBand) ? q.lateBand : '',
    attach: ['missing', 'missing_tax'].includes(q.attach) ? q.attach : '',
    term: q.term === 'default' ? 'default' : '',
  };
}
const inNode = (r, n) => (!n.kind || r.kind === n.kind)
  && (!n.subtype || r.payKind === n.subtype)
  && (!n.due || (n.due === 'due' ? isDue(r.dueState) : !isDue(r.dueState)))
  && (!n.band || r.ageBand === n.band)
  && (!n.risk || r.risk === n.risk)
  && (!n.lateBand || r.lateBand === n.lateBand)
  && (n.attach !== 'missing' || (r.payKind === 'deferred_invoice' && !r.attachments))
  && (n.attach !== 'missing_tax' || (r.payKind === 'tax' && !r.attachments))
  && (n.term !== 'default' || !(Number(r.creditDays) > 0));

/** Table columns as text: used for the column funnel filters (cf_<column>=value, repeated rather than comma-separated since a value may contain a comma) and to build their lists. The text is what the cell shows, so what is picked is what is seen. */
const COLS = {
  number: (r) => String(r.invoiceNumber || ''),
  customer: (r) => r.partyName || '',
  code: (r) => r.partyCode || '',
  officer: (r, mgr) => effectiveOfficer(r.officer, mgr) || '',
  payKind: (r) => r.payKind || '',
  invoiceDate: (r) => ymd(r.invoiceDate),
  deliveryDate: (r) => ymd(r.deliveryDate),
  term: (r) => String(termOf(r.creditDays)),
  termSource: (r) => (Number(r.creditDays) > 0 ? 'customer' : 'default'),
  dueDate: (r) => ymd(r.dueDate),
  ageBand: (r) => r.ageBand || '',
  risk: (r) => r.risk || '',
  dueState: (r) => r.dueState || '',
  issue: (r) => r.issueState || 'none',
  attach: (r) => (r.attachments == null ? '' : (r.attachments > 0 ? 'yes' : 'no')),
};
const colFiltersOf = (q = {}) => {
  const out = {};
  for (const k of Object.keys(COLS)) {
    const v = [].concat(q[`cf_${k}`] == null ? [] : q[`cf_${k}`]).map(String);
    if (v.length) out[k] = new Set(v);
  }
  return out;
};

const RISK_ORDER = { normal: 1, medium: 2, hard: 3, nodate: 0 };
const time = (d) => (d ? new Date(d).getTime() || 0 : null);
/** Sorting: each column by its value, not its text: date by time, amount by number. */
const SORTS = {
  number: (r) => String(r.invoiceNumber || ''),
  customer: (r) => r.partyName || '',
  officer: (r) => r._officer || '',
  payKind: (r) => r.payKind || '',
  invoiceDate: (r) => time(r.invoiceDate),
  deliveryDate: (r) => time(r.deliveryDate),
  term: (r) => termOf(r.creditDays),
  dueDate: (r) => time(r.dueDate),
  age: (r) => r.age,
  daysLate: (r) => r.daysLate,
  total: (r) => r.total || 0,
  collected: (r) => r.collected || 0,
  remaining: (r) => (r.total || 0) - (r.collected || 0),
  risk: (r) => RISK_ORDER[r.risk] ?? 0,
  issue: (r) => r.issueState || 'none',
};

/**
 * Node rows under every filter: dashboard, node, search and column funnels.
 * exceptCol: the column whose list is being built is not filtered by itself (like Excel).
 */
function selectRows(base, q, mgr, exceptCol = '') {
  const f = parseFilters(q, mgr);
  const n = nodeOf(q);
  const cf = colFiltersOf(q);
  const needle = String(q.q || '').trim().toLowerCase();
  const src = n.workflow ? base.cashWf : base.ledger;
  return src.filter((r) => {
    if (!passes(r, f, mgr) || !inNode(r, n)) return false;
    if (needle && ![r.invoiceNumber, r.partyName, r.partyCode].some((v) => String(v || '').toLowerCase().includes(needle))) return false;
    for (const [k, set] of Object.entries(cf)) {
      if (k === exceptCol) continue;
      if (!set.has(COLS[k](r, mgr))) return false;
    }
    return true;
  });
}

const sumOf = (list, pick) => r2(list.reduce((a, r) => a + (pick(r) || 0), 0));

/**
 * GET /api/collections-dept/receivables/rows
 * The same counted rows with the same filters (parseFilters), then the node (nodeOf), then search q and column funnels cf_<column>;
 * &sort=<column>&dir=asc|desc&page=&limit=   (limit=all for export, up to 20000)
 * Totals cover the whole result, not the page.
 */
exports.rows = async (req, res) => {
  try {
    const q = req.query || {};
    const page = Math.max(1, Number(q.page) || 1);
    const limit = q.limit === 'all' ? ROWS_CAP : Math.min(500, Math.max(1, Number(q.limit) || 100));
    const mgr = await collectionsManager();
    const base = await loadBase(q);
    const list = selectRows(base, q, mgr);

    // Default sort: oldest first, then largest: what is chased today.
    const sortKey = SORTS[q.sort] ? q.sort : '';
    if (sortKey) {
      const dir = q.dir === 'asc' ? 1 : -1;
      const get = SORTS[sortKey];
      if (sortKey === 'officer') list.forEach((r) => { r._officer = effectiveOfficer(r.officer, mgr); });
      list.sort((a, b) => {
        const x = get(a); const y = get(b);
        // Empty values last in both directions, so a row with no date never tops the table.
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'string') return x.localeCompare(y, 'ar') * dir;
        return (x - y) * dir;
      });
    } else {
      list.sort((a, b) => (b.age ?? -Infinity) - (a.age ?? -Infinity) || (b.total || 0) - (a.total || 0));
    }

    const value = sumOf(list, (r) => r.total);
    const collected = sumOf(list, (r) => r.collected);
    const rows = list.slice((page - 1) * limit, page * limit).map((r) => ({
      _id: r._id,
      invoiceNumber: r.invoiceNumber,
      ...(r.reportNumber ? { reportNumber: r.reportNumber } : {}),
      ...(r.source ? { source: r.source } : {}),
      kind: r.kind,
      subtype: SUBTYPE_KEYS.includes(r.payKind) ? r.payKind : '',
      payKind: r.payKind,
      total: r.total,
      collected: r.collected || 0,
      remaining: r2((r.total || 0) - (r.collected || 0)),
      partyName: r.partyName, partyCode: r.partyCode, party: r.party, partyKey: partyKey(r),
      invoiceDate: r.invoiceDate, deliveryDate: r.deliveryDate, status: r.status,
      creditDays: r.creditDays,
      term: termOf(r.creditDays), termIsDefault: !(Number(r.creditDays) > 0),
      officer: effectiveOfficer(r.officer, mgr), officerIsDefault: isDefaultOfficer(r.officer),
      issueState: r.issueState, issueNote: r.issueNote || '', issueSince: r.issueSince || null,
      basis: r.basis, dueDate: r.dueDate, daysLate: r.daysLate,
      dueState: r.dueState, lateBand: r.lateBand,
      age: r.age, ageBand: r.ageBand, risk: r.risk,
      attachments: r.attachments,
      ...(r.workflowId ? { workflowId: r.workflowId } : {}),
      ...(r.customs && r.customs.length ? { customs: r.customs } : {}),
    }));
    // Count in both units: tax invoices and cash sheets, which can share a band.
    const taxCount = list.filter((r) => r.kind === 'tax').length;
    res.json({
      rows, total: list.length, taxCount, cashCount: list.length - taxCount,
      value, collected, remaining: r2(value - collected),
      customers: new Set(list.map(partyKey)).size,
      page, limit, pages: Math.max(1, Math.ceil(list.length / limit)),
    });
  } catch (e) {
    console.error('receivables rows', e);
    res.status(500).json({ message: 'تعذّر تحميل الصفوف' });
  }
};

/**
 * GET /api/collections-dept/receivables/column-options?col=<column>&cq=<search>&...
 * Values of one column with counts, under every other filter except its own funnel.
 */
exports.columnOptions = async (req, res) => {
  try {
    const q = req.query || {};
    const col = String(q.col || '');
    if (!COLS[col]) return res.status(400).json({ message: 'عمودٌ غير معروف' });
    const mgr = await collectionsManager();
    const base = await loadBase(q);
    const list = selectRows(base, q, mgr, col);
    const m = new Map();
    for (const r of list) { const v = COLS[col](r, mgr); m.set(v, (m.get(v) || 0) + 1); }
    const needle = String(q.cq || '').trim().toLowerCase();
    let values = [...m.entries()].map(([value, count]) => ({ value, count }))
      .filter((o) => !needle || o.value.toLowerCase().includes(needle))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
    const truncated = values.length > 500;
    if (truncated) values = values.slice(0, 500);
    res.json({ values, truncated });
  } catch (e) {
    console.error('receivables column options', e);
    res.status(500).json({ message: 'تعذّر تحميل القيم' });
  }
};

/**
 * GET /api/collections-dept/receivables/cases?state=negotiating,legal&officer=&pay=&dueState=&q=&from=&to=
 * Cases: customers with a dispute state. The state belongs to the customer (CollectionsParty.issue), not the invoice, so the page is built on customers: every one under negotiation or legal, even with no open invoice left, since a live case does not vanish when the ledger is settled.
 * Amounts come from the same ledger rows the dashboard counts (loadBase) with its filters, so clicking a customer opens the receivables page with parties=<key>&issue=<state> showing identical figures.
 */
exports.cases = async (req, res) => {
  try {
    const q = req.query || {};
    const states = listOf(q.state).filter((v) => v === 'negotiating' || v === 'legal');
    const want = states.length ? states : ['negotiating', 'legal'];
    const mgr = await collectionsManager();
    const [base, partyDocs] = await Promise.all([
      loadBase(q),
      CollectionsParty.find({ 'issue.state': { $in: want } })
        .select('name code kind collectionOfficer creditDays issue').lean(),
    ]);
    // Row-level filters: officer, payment type and due state. State and customer are read here, not from the URL.
    const f = parseFilters({ officer: q.officer, pay: q.pay, dueState: q.dueState }, mgr);
    const rowsFiltered = !!(f.pay.size || f.dueState.size);
    const needle = String(q.q || '').trim().toLowerCase();

    const groups = new Map();
    for (const p of partyDocs) {
      const officer = effectiveOfficer(p.collectionOfficer, mgr);
      if (f.officer.size && !f.officer.has(String(officer || '').toLowerCase())) continue;
      if (needle && ![p.name, p.code].some((v) => String(v || '').toLowerCase().includes(needle))) continue;
      groups.set(String(p._id), {
        party: p._id, key: String(p._id), name: p.name || '—', code: p.code || '', kind: p.kind,
        state: p.issue?.state, note: p.issue?.note || '', since: p.issue?.since || null,
        updatedByName: p.issue?.updatedByName || '',
        officer, officerIsDefault: isDefaultOfficer(p.collectionOfficer),
        creditDays: Number(p.creditDays) || 0, term: termOf(p.creditDays),
        count: 0, tax: 0, cash: 0, value: 0, lateValue: 0, hardValue: 0, oldest: null,
        bands: Object.fromEntries(BAND_KEYS.map((b) => [b, 0])),
      });
    }
    for (const r of base.ledger) {
      const g = r.party && groups.get(String(r.party));
      if (!g || !passes(r, f, mgr)) continue;
      g.count += 1; g.value += owed(r);
      if (r.kind === 'tax') g.tax += 1; else g.cash += 1;
      if (r.dueState === 'late') g.lateValue += owed(r);
      if (r.risk === 'hard') g.hardValue += owed(r);
      g.bands[r.ageBand] = (g.bands[r.ageBand] || 0) + owed(r);
      if (r.age != null && (g.oldest == null || r.age > g.oldest)) g.oldest = r.age;
    }
    const parties = [...groups.values()]
      // Under a type or due-state filter, a customer with no row in it is outside the question.
      .filter((g) => !rowsFiltered || g.count > 0)
      .map((g) => ({
        ...g, value: r2(g.value), lateValue: r2(g.lateValue), hardValue: r2(g.hardValue),
        bands: Object.fromEntries(Object.entries(g.bands).map(([k, v]) => [k, r2(v)])),
      }))
      .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), 'ar'));

    const summary = Object.fromEntries(['negotiating', 'legal'].map((s) => {
      const mine = parties.filter((p) => p.state === s);
      return [s, {
        customers: mine.length,
        count: mine.reduce((a, p) => a + p.count, 0),
        value: r2(mine.reduce((a, p) => a + p.value, 0)),
      }];
    }));
    const officers = [...new Set(partyDocs.map((p) => effectiveOfficer(p.collectionOfficer, mgr)).filter(Boolean))].sort();
    res.json({ parties, summary, officers, manager: mgr ? { name: mgr.name } : null });
  } catch (e) {
    console.error('receivables cases', e);
    res.status(500).json({ message: 'تعذّر تحميل القضايا' });
  }
};

/**
 * PUT /api/collections-dept/parties/:id/issue  { state, note }
 * The dispute state is a decision recorded under the author's name: negotiating, legal, or no dispute.
 */
exports.setIssue = async (req, res) => {
  try {
    const state = String(req.body?.state || '').trim();
    if (!['none', 'negotiating', 'legal'].includes(state)) {
      return res.status(400).json({ message: 'حالةٌ غير معروفة' });
    }
    const note = String(req.body?.note || '').trim();
    // A legal state needs a reason: that count drives the department's work, and a reader later must know which case it is, so the reason is stored with the decision.
    if (state !== 'none' && !note) {
      return res.status(400).json({ message: 'اكتب بيانَ الحالة (رقمُ القضيّة أو ما اتُّفق عليه)' });
    }
    const party = await CollectionsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'الحساب غير موجود' });
    const before = party.issue?.state || 'none';
    party.issue = {
      state,
      note,
      since: state === 'none' ? null : (before === state && party.issue?.since ? party.issue.since : new Date()),
      updatedBy: req.user?._id,
      updatedByName: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ').trim(),
    };
    await party.save();
    cache.clear('cdr:');
    await logAudit({
      user: req.user?._id, action: 'update', entity: 'CollectionsParty', entityId: party._id,
      changes: { before: { issue: before }, after: { issue: state, note } }, ipAddress: req.ip,
    }).catch(() => {});
    try { emitToAll('collections:changed', { party: String(party._id) }); } catch (e) { /* extra */ }
    res.json({ party: { _id: party._id, name: party.name, issue: party.issue } });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر الحفظ' });
  }
};

exports._derive = derive;
exports._subtypeOfInvoices = subtypeOfInvoices;
exports._cashSubtypeRows = cashSubtypeRows;
exports._ageBandOf = ageBandOf;
exports._riskOf = riskOf;
exports.DEFAULT_TERM_DAYS = DEFAULT_TERM_DAYS;
exports.AGE_BANDS = AGE_BANDS;
