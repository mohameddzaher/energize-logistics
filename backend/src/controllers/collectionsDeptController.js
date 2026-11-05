/**
 * Collections department: customers we collect from and suppliers we pay. Figures are aggregated from the operations workflow statements, not copied into a second table, so editing a statement cannot leave the party file stale.
 * Aggregation runs in the database: about 34k statements are not moved to Node, only the 277 customer and 2129 supplier rows are folded there.
 */
const mongoose = require('mongoose');
const CollectionsParty = require('../models/CollectionsParty');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { textIn, mergeOptions, textMatcher, normKey } = require('../utils/colFilter');
const CollectionsFollowUp = require('../models/CollectionsFollowUp');
const { FleetShipment } = require('../models/FleetModels');
const ShipmentOrder = require('../models/ShipmentOrder');
const { fold } = require('../models/CollectionsParty');
const { dayRange } = require('../utils/companyDay');
const { flexSpaceRegex, numberSearchRegex } = require('../utils/plateKey');
const { sendMongooseError, stripEmpty } = require('../utils/mongooseError');
const logAudit = require('../utils/auditLogger');
const { emitToAll } = require('../websocket/socketManager');
const cache = require('../utils/ttlCache');
const {
  EPS, cashStateMatch, cashCollectedExpr, cashPartialExpr, cashRemainingExpr,
  cashIsCollected, cashState, cashRemaining, paymentView,
} = require('../utils/collectionState');

const CACHE_PREFIX = 'collections-dept:';
const STATS_TTL = 60 * 1000;

// The field holding the party name in the statement. The customer is the platform 'user name'; the supplier is the vehicle owner, not the driver name: drivers are hired but the owner is paid, and we pay whoever owns the truck.
const FIELD_OF = { customer: 'username', supplier: 'carOwner' };

// Money direction: the customer pays us the sale value; from the supplier we take the purchase value.
const VALUE_OF = { customer: 'sellingValue', supplier: 'purchaseValue' };

// What marks a row closed: customer by collection date, supplier by payment date. Mixing them makes a collected invoice look paid to a supplier who received nothing.
const CLOSED_BY = { customer: 'collectionDate', supplier: 'paymentDate' };

// A cancelled statement was not executed and no money moved, so counting it as due records a debt that does not exist. Excluded from both sides.
const NOT_CANCELLED = {
  executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] },
};

const EDITABLE = [
  'name', 'phone', 'email', 'contactPerson', 'contactPhone', 'accountantName',
  'accountantPhone', 'commercialRegister', 'taxNumber', 'iban', 'bankName',
  'address', 'city', 'partyType', 'paymentType', 'paymentTerms', 'creditLimit', 'status',
  'assignedTo', 'lastContactAt', 'nextFollowUpAt', 'notes', 'isActive',
  // Collections ledger fields. Read in the aging log and alerts, so they must be correctable from the customer file: raising the credit limit or moving the account to another employee is daily work, and what is read but not correctable stays wrong forever.
  'code', 'collectionOfficer', 'officer', 'hoLocation', 'grade', 'salesManagers',
  'department', 'region', 'creditDays', 'aliases',
  // More than one email; see utils/partyEmails.
  'emails',
];
const pick = (body) => {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  return require('../utils/partyEmails').applyEmails(out);
};

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Actual collections officer: the written employee, otherwise the department manager. See utils/collectionsOfficer.
const { collectionsManager, officerCondition, effectiveOfficer, isDefaultOfficer } = require('../utils/collectionsOfficer');
const officerView = (p, mgr) => (p.kind === 'supplier' ? {} : {
  effectiveOfficer: effectiveOfficer(p.collectionOfficer, mgr),
  officerIsDefault: isDefaultOfficer(p.collectionOfficer),
});

/**
 * Who is limited to 'what is ours'.
 * Collections collects; what we pay suppliers and the net between them is for management and finance. It was first hidden in the screen only, while the server still sent 'due from us', the top suppliers, their aging and the branch column, readable in browser tools and any export. Hiding in one place is hiding halfway, and reads worse than absence: those who see it hidden assume it is blocked. So the rule lives here and the screen follows it.
 * It is by role, not section: management, finance and the operations manager open the same section and see both sides.
 */
const RECEIVABLES_ONLY_ROLES = ['collections_manager', 'collections_staff'];
const receivablesOnly = (user) => RECEIVABLES_ONLY_ROLES.includes(user?.role);
const isKind = (k) => k === 'customer' || k === 'supplier';

/**
 * Each party's figures from the statements, indexed by folded name.
 * Computed once per scope and cached for a minute: the page, the file and the board open within the same minute, so one computation serves all three.
 */
async function statsByKind(kind) {
  return cache.wrap(`${CACHE_PREFIX}stats:${kind}`, STATS_TTL, async () => {
    const field = FIELD_OF[kind];
    const value = VALUE_OF[kind];
    const closed = CLOSED_BY[kind];

    const rows = await OperationsWorkflow.aggregate([
      { $match: { [field]: { $nin: [null, ''] }, ...NOT_CANCELLED } },
      {
        $group: {
          _id: `$${field}`,
          reports: { $sum: 1 },
          total: { $sum: { $ifNull: [`$${value}`, 0] } },
          // Closed: has a date in the closing column. Empty is not zero here: 'not yet collected' is a state, not an amount.
          settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
          settledCount: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, 1, 0] } },
          invoiced: { $sum: { $cond: [{ $ifNull: ['$invoiceNumber', false] }, 1, 0] } },
          lastReportAt: { $max: '$reportDate' },
          lastSettledAt: { $max: `$${closed}` },
        },
      },
    ]).allowDiskUse(true);

    // Folding happens after aggregation, not before: folding inside the database is a chain of `$replaceAll` written at every point, and the returned rows are hundreds, so folding here is cheaper and clearer.
    const byKey = new Map();
    for (const row of rows) {
      const key = fold(row._id);
      if (!key) continue;
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, {
          key,
          names: [{ name: row._id, reports: row.reports }],
          reports: row.reports,
          total: row.total,
          settled: row.settled,
          settledCount: row.settledCount,
          invoiced: row.invoiced,
          lastReportAt: row.lastReportAt || null,
          lastSettledAt: row.lastSettledAt || null,
        });
        continue;
      }
      cur.reports += row.reports;
      cur.total += row.total;
      cur.settled += row.settled;
      cur.settledCount += row.settledCount;
      cur.invoiced += row.invoiced;
      cur.names.push({ name: row._id, reports: row.reports });
      if (row.lastReportAt && (!cur.lastReportAt || row.lastReportAt > cur.lastReportAt)) cur.lastReportAt = row.lastReportAt;
      if (row.lastSettledAt && (!cur.lastSettledAt || row.lastSettledAt > cur.lastSettledAt)) cur.lastSettledAt = row.lastSettledAt;
    }

    for (const v of byKey.values()) {
      v.total = r2(v.total);
      v.settled = r2(v.settled);
      v.outstanding = r2(v.total - v.settled);
      v.openReports = v.reports - v.settledCount;
      // The displayed name is the more frequent of the two spellings, not the first by chance.
      v.names.sort((a, b) => b.reports - a.reports);
      v.displayName = v.names[0].name;
    }
    return byKey;
  });
}

const emptyStats = () => ({
  reports: 0, total: 0, settled: 0, outstanding: 0,
  settledCount: 0, openReports: 0, invoiced: 0,
  lastReportAt: null, lastSettledAt: null, names: [],
});

/**
 * Customer money comes from the invoice ledger, not operations statements.
 * The customer list and file used to compute 'due to us' from statements: sale value minus what had a collection date. The collection date is not written on statements (4880 of 32k) and the sale value there holds the purchase price. The list said customers owed 45.3M while the board said 19.96M; the ledger is correct.
 * So customer money is read from the ledger by link, while the statement count stays from operations since it is work, not money. The supplier is unchanged: no ledger, money from statements.
 */
async function ledgerMoneyByParty() {
  return cache.wrap(`${CACHE_PREFIX}ledger-money`, STATS_TTL, async () => {
    const CollectionInvoice = require('../models/CollectionInvoice');
    const open = CollectionInvoice.isOpenExpr;
    const rows = await CollectionInvoice.aggregate([
      { $match: { unused: { $ne: true }, party: { $ne: null } } },
      { $group: {
        _id: '$party',
        invoices: { $sum: 1 },
        invoiced: { $sum: { $ifNull: ['$total', 0] } },
        // Open at its remainder: a partial is listed by what was not collected, not its whole value.
        outstanding: { $sum: { $cond: [open, CollectionInvoice.remainingExpr, 0] } },
        openInvoices: { $sum: { $cond: [open, 1, 0] } },
        lastCollectedAt: { $max: '$collectionDate' },
        // Account code as in the ledger. The code is written on ledger invoices, and the customer record may have none (built from operations statement names), so it is read from its invoices.
        codes: { $addToSet: '$partyCode' },
        sheetCodes: { $addToSet: '$sheetCode' },
      } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r]));
  });
}
const NO_MONEY = { invoices: 0, invoiced: 0, outstanding: 0, openInvoices: 0, lastCollectedAt: null };

const withStats = (party, stats, money) => {
  const s = stats.get(party.nameKey || fold(party.name)) || emptyStats();
  const base = {
    ...party,
    reports: s.reports, total: s.total, settled: s.settled, outstanding: s.outstanding,
    openReports: s.openReports, invoiced: s.invoiced,
    lastReportAt: s.lastReportAt, lastSettledAt: s.lastSettledAt,
    nameVariants: (s.names || []).length > 1 ? s.names.map((n) => n.name) : [],
  };
  if (!money) return { ...base, codeShown: party.code || '' };
  const m = money.get(String(party._id)) || NO_MONEY;
  return {
    ...base,
    total: r2(m.invoiced),
    settled: r2(m.invoiced - m.outstanding),
    outstanding: r2(m.outstanding),
    invoices: m.invoices,
    openInvoices: m.openInvoices,
    lastSettledAt: m.lastCollectedAt || null,
    moneySource: 'ledger',
    // Displayed code: the record's code, otherwise the account code from ledger invoices.
    codeShown: party.code || [...new Set([...(m.codes || []), ...(m.sheetCodes || [])].map((c) => String(c || '').trim()).filter(Boolean))].sort().join(' · '),
  };
};

// Parties

exports.listParties = async (req, res) => {
  try {
    const kind = String(req.query.kind || 'customer');
    if (!isKind(kind)) return res.status(400).json({ message: 'kind must be customer or supplier' });

    const filter = { kind };
    if (req.query.active === 'true') filter.isActive = true;
    if (req.query.active === 'false') filter.isActive = false;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.city) filter.city = req.query.city;
    if (req.query.partyType) filter.partyType = req.query.partyType;
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;

    // 'No officer' is a question that gets asked.
    // The team evaluation board shows a row '(no officer)' with twelve accounts and amounts, and what it held was unknown; the first question is that nobody follows those accounts.
    // The officer in this record is two fields, not one: `assignedTo` is a user reference and `collectionOfficer` is a written name, and the whole evaluation board is built on the latter. A filter by id alone can never open a row from that board, so the name is accepted too, which is what the numbers are built on.
    // No more 'no officer': anything not assigned to an employee belongs to the department manager (see utils/collectionsOfficer). The manager's name opens their written accounts plus every nameless account, and `none` in a saved link reads as the manager too.
    const mgr = await collectionsManager();
    const officerCond = officerCondition(req.query.officer, mgr);
    if (officerCond) filter.$and = [...(filter.$and || []), officerCond];

    // The number clicked is the number opened. The evaluation board counts only account-code holders (`code`), the accounts with ledger invoices. Opening 'no officer' on the whole registry would return 427 instead of 12, and the reader would think the board lied when it was asked a different question.
    if (req.query.hasCode === 'true') filter.code = { $gt: '' };

    // Search folds spaces and spelling variants as elsewhere: someone who copied the name from another place with two spaces or a different hamza still finds the row.
    const q = String(req.query.q || '').trim();
    if (q) {
      const rx = flexSpaceRegex(q);
      filter.$or = [
        { name: rx }, { nameKey: rx },
        // The official name in the ledger is an alias here, so it must be searched.
        // The party registry was built from operations statement names, while the official name on the collection sheet is kept as an alias. Someone copying the name from the sheet and searching would get 'no results' although the account exists and its officer is known. The aging page already searched aliases; this one did not.
        { aliases: rx }, { aliasKeys: rx },
        // The account code is also what gets copied from the sheet: in the record, or on ledger invoices when the record has no code (see codeShown).
        { code: rx },
        { _id: { $in: await require('../models/CollectionInvoice').distinct('party', { party: { $ne: null }, $or: [{ partyCode: rx }, { sheetCode: rx }] }) } },
        { collectionOfficer: rx },
        { phone: rx }, { email: rx },
        { contactPerson: rx }, { contactPhone: rx },
        { commercialRegister: rx }, { taxNumber: rx }, { iban: rx }, { city: rx },
      ];
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    // 'Has balance only' applies to the whole list. It used to apply in the browser to the 100 loaded rows while the counter showed the count of all.
    const money = kind === 'customer' ? await ledgerMoneyByParty() : null;
    if (money && req.query.owing === 'true') {
      const owing = [...money.entries()].filter(([, m]) => m.outstanding > 0.005).map(([id]) => new mongoose.Types.ObjectId(id));
      filter.$and = [...(filter.$and || []), { _id: { $in: owing } }];
    }

    const [parties, total, stats, allIds] = await Promise.all([
      CollectionsParty.find(filter)
        .populate('assignedTo', 'firstName lastName')
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CollectionsParty.countDocuments(filter),
      statsByKind(kind),
      // Totals are over everything matching the filter, not the displayed page.
      money ? CollectionsParty.find(filter).select('_id').lean() : [],
    ]);

    let totals = null;
    if (money) {
      totals = { invoices: 0, total: 0, settled: 0, outstanding: 0, openInvoices: 0 };
      for (const p of allIds) {
        const m = money.get(String(p._id)); if (!m) continue;
        totals.invoices += m.invoices; totals.total += m.invoiced;
        totals.outstanding += m.outstanding; totals.openInvoices += m.openInvoices;
      }
      totals.settled = r2(totals.total - totals.outstanding);
      totals.total = r2(totals.total); totals.outstanding = r2(totals.outstanding);
    }

    res.json({
      // `collectionOfficer` as written (edited in the form); `effectiveOfficer` is what is displayed: the employee, or the manager if unassigned.
      parties: parties.map((p) => ({ ...withStats(p, stats, money), ...officerView(p, mgr) })),
      totals,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الأطراف', error: e.message });
  }
};

/** Party file: its data, figures, statements and monthly movement. */
exports.getPartyProfile = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const party = await CollectionsParty.findById(req.params.id)
      .populate('assignedTo', 'firstName lastName')
      .lean();
    if (!party) return res.status(404).json({ message: 'الطرف غير موجود' });

    const kind = party.kind;
    const field = FIELD_OF[kind];
    const value = VALUE_OF[kind];
    const closed = CLOSED_BY[kind];
    const stats = await statsByKind(kind);
    const s = stats.get(party.nameKey || fold(party.name)) || emptyStats();

    // Every spelling of its name in the statements belongs to it: matching is by folded name, and statements are read with all variants, not one.
    const names = (s.names || []).map((n) => n.name);
    const rowFilter = names.length
      ? { [field]: { $in: names }, ...NOT_CANCELLED }
      : { [field]: party.name, ...NOT_CANCELLED };

    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);

    const [reports, reportsTotal, monthly] = await Promise.all([
      OperationsWorkflow.find(rowFilter)
        .select(`reportNumber reportDate fromLocation toLocation branch carNumber username carOwner ${value} ${closed} invoiceNumber invoiceDate totalInvoice payingBranch documentNumber executionStatus`)
        .sort({ reportDate: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      OperationsWorkflow.countDocuments(rowFilter),
      OperationsWorkflow.aggregate([
        { $match: { ...rowFilter, reportDate: { $ne: null } } },
        {
          $group: {
            // Month in company time, not GMT: a statement after 9 pm on the last day of a month would fall into the next month under GMT.
            _id: { $dateToString: { date: '$reportDate', format: '%Y-%m', timezone: 'Asia/Riyadh' } },
            reports: { $sum: 1 },
            total: { $sum: { $ifNull: [`$${value}`, 0] } },
            settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 36 },
      ]),
    ]);

    // Their work with us is not operations statements only. Goods are moved for the customer by our trucks (fleet management) and by a supplier's trucks (shipment orders) as well as on the operations platform. A file showing only one says 'we dealt with him N times' with an incomplete number. Matching uses every spelling of the name, not one.
    const nameRx = names.length
      ? names.map((n) => flexSpaceRegex(n))
      : [flexSpaceRegex(party.name)];
    const nameMatch = { $or: nameRx.map((rx) => ({ customerName: rx })) };
    const supplierMatch = { $or: nameRx.map((rx) => ({ supplierName: rx })) };

    const [fleetLoads, orders] = await Promise.all([
      kind === 'customer'
        ? FleetShipment.find(nameMatch)
          .select('waybillNumber shipmentDate fromCity toCity status price customerName vehiclePlate driverName')
          .sort({ shipmentDate: -1 }).limit(50).lean()
        : [],
      ShipmentOrder.find(kind === 'customer' ? nameMatch : supplierMatch)
        .select('orderNumber orderDate fromCity toCity status sellPrice buyPrice customerName supplierName truckType')
        .sort({ orderDate: -1 }).limit(50).lean(),
    ]);

    // Their money with us is in the invoice ledger, not the statements.
    // The file used to show operations statements and compute owed amounts from them. The collection ledger says only 6% of its invoices have a statement here, so 94% of customer money never appeared in the file. Invoices are now read from the ledger by folded name, with what was collected and what remains: the number that is claimed and printed in the account statement.
    const CollectionInvoice = require('../models/CollectionInvoice');
    // By link only, not by name. It used to include every invoice whose folded name matched. One company can have two accounts with two codes (cash and tax), each with its own balance, so 134 invoices showed in two files and the customer file disagreed with its line in debt aging.
    const ledgerAll = await CollectionInvoice.find({ party: party._id, unused: { $ne: true } })
      .select('invoiceNumber partyName partyCode total collectedAmount invoiceDate deliveryDate collectionDate status kind').lean();
    const ledger = ledgerAll
      .sort((x, y) => new Date(y.invoiceDate || 0) - new Date(x.invoiceDate || 0));

    const { isCollected } = CollectionInvoice;
    const invoiced = ledger.reduce((a2, i) => a2 + (Number(i.total) || 0), 0);
    // Collected includes the received part of a partial; see CollectionInvoice.collectedOf.
    const collectedSum = ledger.reduce((a2, i) => a2 + CollectionInvoice.collectedOf(i), 0);
    const openInvoices = ledger.filter((i) => !isCollected(i));
    const now2 = Date.now();
    const byMonth = new Map();
    for (const i of ledger) {
      if (!i.invoiceDate) continue;
      const m = new Date(i.invoiceDate).toISOString().slice(0, 7);
      const e = byMonth.get(m) || { month: m, reports: 0, total: 0, settled: 0 };
      e.reports += 1; e.total += Number(i.total) || 0;
      e.settled += CollectionInvoice.collectedOf(i);
      byMonth.set(m, e);
    }
    const ledgerMonthly = [...byMonth.values()].sort((x, y) => x.month.localeCompare(y.month)).slice(-36)
      .map((e) => ({ ...e, total: r2(e.total), settled: r2(e.settled), outstanding: r2(e.total - e.settled) }));

    res.json({
      party: {
        ...withStats(party, stats, kind === 'customer' ? await ledgerMoneyByParty() : null),
        ...officerView(party, await collectionsManager()),
      },
      // Money as the ledger says.
      money: {
        invoices: ledger.slice(0, 500).map((i) => ({
          invoiceNumber: i.invoiceNumber,
          partyCode: i.partyCode || '',
          total: r2(i.total),
          invoiceDate: i.invoiceDate || null,
          deliveryDate: i.deliveryDate || null,
          collectionDate: i.collectionDate || null,
          collected: isCollected(i),
          collectionState: CollectionInvoice.stateOf(i),
          collectedAmount: r2(CollectionInvoice.collectedOf(i)),
          remaining: r2(CollectionInvoice.remainingOf(i)),
          status: i.status || '',
          // Age of what is uncollected: what is asked about in a claim.
          ageDays: !isCollected(i) && i.invoiceDate
            ? Math.floor((now2 - new Date(i.invoiceDate).getTime()) / 86400000) : null,
        })),
        totals: {
          count: ledger.length,
          invoiced: r2(invoiced),
          collected: r2(collectedSum),
          outstanding: r2(invoiced - collectedSum),
          openCount: openInvoices.length,
          // Oldest uncollected invoice: the true age of the debt.
          oldestOpenDays: openInvoices.reduce((mx, i) => {
            if (!i.invoiceDate) return mx;
            const d = Math.floor((now2 - new Date(i.invoiceDate).getTime()) / 86400000);
            return d > mx ? d : mx;
          }, 0),
        },
      },
      // Their work with us from every door: our fleet, shipment orders and operations statements.
      work: {
        fleetLoads,
        orders,
        counts: { reports: reportsTotal, fleetLoads: fleetLoads.length, orders: orders.length },
      },
      reports,
      reportsTotal,
      page,
      limit,
      pages: Math.max(1, Math.ceil(reportsTotal / limit)),
      // Customer monthly movement from ledger invoices (billing month); supplier from statements.
      monthly: kind === 'customer' ? ledgerMonthly : monthly.map((m) => ({
        month: m._id,
        reports: m.reports,
        total: r2(m.total),
        settled: r2(m.settled),
        outstanding: r2(m.total - m.settled),
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الملف', error: e.message });
  }
};

exports.createParty = async (req, res) => {
  try {
    const kind = String(req.body.kind || '');
    if (!isKind(kind)) return res.status(400).json({ message: 'kind must be customer or supplier' });
    const body = stripEmpty(pick(req.body), CollectionsParty.schema);
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: الاسم', fields: { name: 'مطلوب' } });
    }
    // A duplicate name is reported by name: a bare 'already exists' leaves the user searching. Name alone is no longer the identity: one company can hold two accounts (cash and tax) with two codes. So duplicates are blocked where no code distinguishes them and allowed when an explicit different code is written.
    const wantedCode = String(req.body.code || '').trim();
    const dup = await CollectionsParty.findOne({
      kind, nameKey: fold(body.name), ...(wantedCode ? { code: { $ne: wantedCode } } : {}),
    }).select('_id name code').lean();
    if (dup && !wantedCode) {
      return res.status(409).json({
        message: `«${dup.name}» مسجَّل بالفعل — الاسمان يُقرآن واحدًا بعد طيّ فروق الرسم`,
        existingId: dup._id,
      });
    }
    // The code is generated following the ledger. Each account has a code used in accounting and all correspondence: cash `C####`, tax `1104####`. Leaving it to the data-entry person means varied formats and duplicate codes, so the next one in its type's series is read and written automatically. A hand-written code is kept, since import and correction need it.
    let code = String(body.code || '').trim();
    if (!code && kind === 'customer') {
      const { nextPartyCode } = require('../utils/partyCode');
      code = await nextPartyCode(body.paymentType === 'cash' ? 'cash' : 'tax');
    }
    const party = await CollectionsParty.create({ ...body, ...(code ? { code } : {}), kind, source: 'manual', createdBy: req.user._id });
    await logAudit({
      user: req.user._id, action: 'create_collections_party', entity: 'CollectionsParty',
      entityId: party._id, changes: { after: { kind, name: party.name } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:party', { id: party._id, kind }); } catch (_) {}
    res.status(201).json({ party: withStats(party.toObject(), await statsByKind(kind)) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر إنشاء الطرف'); }
};

exports.updateParty = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const existing = await CollectionsParty.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'الطرف غير موجود' });

    const body = stripEmpty(pick(req.body), CollectionsParty.schema);
    if (body.name && fold(body.name) !== existing.nameKey) {
      const dup = await CollectionsParty.findOne({
        kind: existing.kind, nameKey: fold(body.name), _id: { $ne: existing._id },
      }).select('_id name').lean();
      if (dup) return res.status(409).json({ message: `«${dup.name}» مسجَّل بالفعل`, existingId: dup._id });
    }

    const before = { name: existing.name, status: existing.status, isActive: existing.isActive };
    const party = await CollectionsParty.findByIdAndUpdate(existing._id, { $set: body }, { new: true, runValidators: true })
      .populate('assignedTo', 'firstName lastName')
      .lean();
    await logAudit({
      user: req.user._id, action: 'update_collections_party', entity: 'CollectionsParty',
      entityId: party._id, changes: { before, after: body }, ipAddress: req.ip,
    });
    // The collections ledger is invalidated with it, before the broadcast. The aging log and alerts are cached for a minute, and raising the credit limit from the customer file is the action that clears its alert; a stale cache would leave the alert hanging after it was handled, worse than never showing. Payment term and officer are read in the collections board (`cdr:`), so clearing is before the broadcast, not after (see announce-before-invalidate).
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    try { emitToAll('collections:party', { id: party._id, kind: party.kind }); } catch (_) {}
    res.json({ party: withStats(party, await statsByKind(party.kind)) });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ الطرف'); }
};

/**
 * Delete deactivates anyone with history.
 * Deleting a party with statements cuts its statements off from its file: rows keep its name and nothing groups them, so a standing debt vanishes from every report. Deactivation hides it from lists and keeps its history readable.
 */
exports.deleteParty = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const party = await CollectionsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'الطرف غير موجود' });

    const stats = await statsByKind(party.kind);
    const s = stats.get(party.nameKey || fold(party.name));
    if (s && s.reports > 0) {
      party.isActive = false;
      await party.save();
      await logAudit({
        user: req.user._id, action: 'deactivate_collections_party', entity: 'CollectionsParty',
        entityId: party._id, changes: { after: { name: party.name, reports: s.reports } }, ipAddress: req.ip,
      });
      try { emitToAll('collections:party', { id: party._id, kind: party.kind }); } catch (_) {}
      return res.json({
        deactivated: true,
        message: `«${party.name}» له ${s.reports} أمر نقل — عُطِّل بدل حذفه حتى لا ينقطع تاريخُه`,
      });
    }

    await party.deleteOne();
    await logAudit({
      user: req.user._id, action: 'delete_collections_party', entity: 'CollectionsParty',
      entityId: party._id, changes: { before: { name: party.name } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:party', { id: party._id, kind: party.kind }); } catch (_) {}
    res.json({ deleted: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف الطرف'); }
};

// Follow-ups: a call or a payment promise, attached to a party.
// It was a page under 'customers and finance' attached to a Work Flow customer that no longer runs. Everything about collections belongs in the collections department; otherwise the follow-up is recorded in a department that does not own it, on a party nobody knows.

const FU_EDITABLE = [
  'report', 'type', 'status', 'notes', 'amountCollected',
  'promiseDate', 'promiseAmount', 'promiseFulfilled', 'nextFollowUpAt',
];
const pickFu = (body) => {
  const out = {};
  for (const k of FU_EDITABLE) if (body[k] !== undefined) out[k] = body[k];
  return out;
};

const FU_POPULATE = (q) => q
  .populate('collector', 'firstName lastName')
  .populate('party', 'name kind')
  .populate('report', 'reportNumber reportDate');

exports.listFollowUps = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const items = await FU_POPULATE(CollectionsFollowUp.find({ party: req.params.id }))
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json({ followUps: items });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل المتابعات', error: e.message });
  }
};

/**
 * Due follow-ups: those whose time has come and are not closed.
 * A promise with no date to ask about is a note, not a follow-up. This is what makes 'said he will pay Thursday' an item that returns on Thursday instead of a forgotten line.
 */
exports.dueFollowUps = async (req, res) => {
  try {
    const now = new Date();
    const filter = { closedAt: null, nextFollowUpAt: { $ne: null, $lte: now } };
    if (req.query.mine === 'true') filter.collector = req.user._id;
    const items = await FU_POPULATE(CollectionsFollowUp.find(filter))
      .sort({ nextFollowUpAt: 1 }).limit(200).lean();
    res.json({ followUps: items, total: items.length });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل المستحقّ', error: e.message });
  }
};

exports.createFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const party = await CollectionsParty.findById(req.params.id).select('_id name kind').lean();
    if (!party) return res.status(404).json({ message: 'الطرف غير موجود' });

    const body = stripEmpty(pickFu(req.body), CollectionsFollowUp.schema);
    if (!body.notes || !String(body.notes).trim()) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: الملاحظات', fields: { notes: 'مطلوب' } });
    }
    if (!body.type) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: نوع المتابعة', fields: { type: 'مطلوب' } });
    }

    const fu = await CollectionsFollowUp.create({ ...body, party: party._id, collector: req.user._id });

    // Latest contact on the party itself: read in the list without opening the file. The upcoming follow-up is carried there too, so it is not searched for in another log.
    const patch = { lastContactAt: new Date() };
    if (body.nextFollowUpAt) patch.nextFollowUpAt = body.nextFollowUpAt;
    await CollectionsParty.findByIdAndUpdate(party._id, { $set: patch });

    await logAudit({
      user: req.user._id, action: 'log_collections_follow_up', entity: 'CollectionsFollowUp',
      entityId: fu._id, changes: { after: { party: party.name, type: body.type } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:follow-up', { party: party._id }); } catch (_) {}
    res.status(201).json({ followUp: await FU_POPULATE(CollectionsFollowUp.findById(fu._id)).lean() });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تسجيل المتابعة'); }
};

exports.updateFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.fuId)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const body = stripEmpty(pickFu(req.body), CollectionsFollowUp.schema);
    // Closing is an action recorded with its owner and time, not a written field.
    if (req.body.close === true) { body.closedAt = new Date(); body.closedBy = req.user._id; }
    if (req.body.close === false) { body.closedAt = null; body.closedBy = null; }

    const fu = await CollectionsFollowUp.findByIdAndUpdate(req.params.fuId, { $set: body }, { new: true, runValidators: true });
    if (!fu) return res.status(404).json({ message: 'المتابعة غير موجودة' });
    await logAudit({
      user: req.user._id, action: 'update_collections_follow_up', entity: 'CollectionsFollowUp',
      entityId: fu._id, changes: { after: body }, ipAddress: req.ip,
    });
    try { emitToAll('collections:follow-up', { party: fu.party }); } catch (_) {}
    res.json({ followUp: await FU_POPULATE(CollectionsFollowUp.findById(fu._id)).lean() });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ المتابعة'); }
};

exports.deleteFollowUp = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.fuId)) return res.status(400).json({ message: 'معرّف غير صالح' });
    const fu = await CollectionsFollowUp.findById(req.params.fuId);
    if (!fu) return res.status(404).json({ message: 'المتابعة غير موجودة' });
    await fu.deleteOne();
    await logAudit({
      user: req.user._id, action: 'delete_collections_follow_up', entity: 'CollectionsFollowUp',
      entityId: fu._id, changes: { before: { notes: fu.notes } }, ipAddress: req.ip,
    });
    try { emitToAll('collections:follow-up', { party: fu.party }); } catch (_) {}
    res.json({ deleted: true });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حذف المتابعة'); }
};

// Board

/**
 * Collections board: what is ours and what is owed by us, the biggest overdue, and where it accumulates.
 * The range is optional: without one the whole picture is read, which is what is asked first ('how much do people owe us?'), not one month.
 */
exports.dashboard = async (req, res) => {
  try {
    const { from, to } = req.query;
    // Day boundary in company time, not GMT: with GMT the first three hours of the start day are lost and three hours of the day after the last day are gained.
    const range = from || to ? dayRange(from, to) : null;
    // Board filters are the pages' filters. The board accepted only a range, but the questions asked of it are more: a specific customer, a specific supplier, a branch, an age band. An unfilterable board is read once and then the pages are opened to read it again.
    const extra = {};
    if (req.query.customer) extra.username = flexSpaceRegex(String(req.query.customer));
    if (req.query.supplier) extra.carOwner = flexSpaceRegex(String(req.query.supplier));
    // Branch matches with any surrounding whitespace (a transferred 'Dammam ' value); see utils/colFilter.
    if (req.query.branch) extra.branch = textMatcher(String(req.query.branch));
    const dateMatch = { ...extra, ...(range ? { reportDate: range } : {}) };

    // The age band is measured on the statement date. Bands do not overlap, so their sum equals the total and a statement is not counted twice.
    const ageBand = AGE_BANDS[req.query.age] ? req.query.age : null;
    if (ageBand) {
      const c = ageCondition('reportDate', ageBand).reportDate;
      dateMatch.reportDate = { ...(dateMatch.reportDate || {}), ...c };
    }
    // The range is merged, not overwritten. 'Statement date exists' and 'statement date within range' are two conditions on the same field; writing one after the other into one object cancels the first, silently dropping the range and reading the filtered board over all data.
    const datedMatch = {
      ...extra,
      reportDate: { $ne: null, ...(dateMatch.reportDate || {}) },
    };
    // The key carries all filters and the role: a result computed for someone who sees both sides is not served to someone who sees one, nor one customer's result to another.
    const key = `${CACHE_PREFIX}dash:${receivablesOnly(req.user) ? 'r' : 'a'}:${JSON.stringify(req.query || {})}`;

    // One read, not eight. The board was eight aggregations each scanning all operations statements (36k), about eight seconds per new account. The questions are all over the same rows and the same eight fields, so rows are read once and the questions answered in one `$facet`. Each branch keeps its condition and aggregation exactly as before.
    // The opener does not wait for the computation: the page refetches on every operations-sync event, so the last answer is served at once and recomputed in the background if a minute has passed (ttlCache.wrapStale).
    const data = await cache.wrapStale(key, STATS_TTL, 15 * 60 * 1000, async () => {
      const onBranchRef = { v: {} };
      const facetSide = (kind) => {
        const field = FIELD_OF[kind];
        const value = VALUE_OF[kind];
        const closed = CLOSED_BY[kind];
        const present = { [field]: { $nin: [null, ''] }, ...onBranchRef.v };
        return {
          totals: [
            { $match: present },
            {
              $group: {
                _id: null,
                reports: { $sum: 1 },
                total: { $sum: { $ifNull: [`$${value}`, 0] } },
                settled: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, { $ifNull: [`$${value}`, 0] }, 0] } },
                settledCount: { $sum: { $cond: [{ $ifNull: [`$${closed}`, false] }, 1, 0] } },
              },
            },
          ],
          top: [
            { $match: { ...present, [closed]: null } },
            {
              $group: {
                _id: `$${field}`,
                reports: { $sum: 1 },
                outstanding: { $sum: { $ifNull: [`$${value}`, 0] } },
                oldest: { $min: '$reportDate' },
              },
            },
            // Equal values sort by name; otherwise who enters the list at its limit would change between opens although the numbers are identical.
            { $sort: { outstanding: -1, _id: 1 } },
            { $limit: 200 },
          ],
        };
      };
      const facetAging = (kind) => {
        const value = VALUE_OF[kind];
        const closed = CLOSED_BY[kind];
        return [
          { $match: { reportDate: { $ne: null }, [closed]: null, ...onBranchRef.v } },
          { $addFields: { ageDays: { $divide: [{ $subtract: ['$$NOW', '$reportDate'] }, 86400000] } } },
          {
            $group: {
              _id: null,
              d0_30: { $sum: { $cond: [{ $lte: ['$ageDays', 30] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              d31_60: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 30] }, { $lte: ['$ageDays', 60] }] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              d61_90: { $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 60] }, { $lte: ['$ageDays', 90] }] }, { $ifNull: [`$${value}`, 0] }, 0] } },
              d90p: { $sum: { $cond: [{ $gt: ['$ageDays', 90] }, { $ifNull: [`$${value}`, 0] }, 0] } },
            },
          },
        ];
      };
      // Branch filters everything except the branch table. The 'by branch' table shows all branches so the chosen one can be compared with the others; previously its `branch` condition overrode the branch filter. So branch is removed from the shared condition and added to every facet branch except that table.
      const { branch: branchFilter, ...baseMatch } = dateMatch;
      const onBranch = branchFilter !== undefined ? { branch: branchFilter } : {};
      onBranchRef.v = onBranch;
      const cSide = facetSide('customer');
      const sSide = facetSide('supplier');

      const [[f], partyCounts] = await Promise.all([
        OperationsWorkflow.aggregate([
          // The condition shared by all questions, with each question's own inside its branch.
          { $match: { ...NOT_CANCELLED, ...baseMatch } },
          {
            $project: {
              _id: 0, username: 1, carOwner: 1, branch: 1, reportDate: 1,
              sellingValue: 1, purchaseValue: 1, collectionDate: 1, paymentDate: 1,
            },
          },
          {
            $facet: {
              cTotals: cSide.totals,
              cTop: cSide.top,
              sTotals: sSide.totals,
              sTop: sSide.top,
              monthly: [
                { $match: { reportDate: { $ne: null }, ...onBranch } },
                {
                  $group: {
                    _id: { $dateToString: { date: '$reportDate', format: '%Y-%m', timezone: 'Asia/Riyadh' } },
                    total: { $sum: { $ifNull: ['$sellingValue', 0] } },
                    settled: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, { $ifNull: ['$sellingValue', 0] }, 0] } },
                  },
                },
                { $sort: { _id: 1 } },
              ],
              cAging: facetAging('customer'),
              sAging: facetAging('supplier'),
              byBranch: [
                { $match: { branch: { $nin: [null, ''] } } },
                {
                  $group: {
                    _id: '$branch',
                    reports: { $sum: 1 },
                    receivable: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, 0, { $ifNull: ['$sellingValue', 0] }] } },
                    payable: { $sum: { $cond: [{ $ifNull: ['$paymentDate', false] }, 0, { $ifNull: ['$purchaseValue', 0] }] } },
                  },
                },
                { $sort: { receivable: -1 } },
              ],
            },
          },
        ]).allowDiskUse(true),
        CollectionsParty.aggregate([{ $group: { _id: { kind: '$kind', active: '$isActive' }, n: { $sum: 1 } } }]),
      ]);

      const shapeSide = (totals, top) => {
        const merged = new Map();
        for (const row of top) {
          const k = fold(row._id);
          if (!k) continue;
          const cur = merged.get(k);
          if (!cur) { merged.set(k, { name: row._id, reports: row.reports, outstanding: row.outstanding, oldest: row.oldest, _top: row.reports }); continue; }
          cur.reports += row.reports;
          cur.outstanding += row.outstanding;
          if (row.oldest && (!cur.oldest || row.oldest < cur.oldest)) cur.oldest = row.oldest;
          if (row.reports > cur._top) { cur.name = row._id; cur._top = row.reports; }
        }
        const t = totals || { reports: 0, total: 0, settled: 0, settledCount: 0 };
        return {
          reports: t.reports,
          total: r2(t.total),
          settled: r2(t.settled),
          outstanding: r2(t.total - t.settled),
          settledCount: t.settledCount,
          openReports: t.reports - t.settledCount,
          top: [...merged.values()]
            .sort((x, y) => (y.outstanding - x.outstanding) || String(x.name).localeCompare(String(y.name)))
            .slice(0, 15)
            .map((x) => ({ name: x.name, reports: x.reports, outstanding: r2(x.outstanding), oldest: x.oldest || null })),
        };
      };
      const shapeAging = (row) => {
        const g = row || { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
        return [
          { bucket: '0-30', amount: r2(g.d0_30) },
          { bucket: '31-60', amount: r2(g.d31_60) },
          { bucket: '61-90', amount: r2(g.d61_90) },
          { bucket: '90+', amount: r2(g.d90p) },
        ];
      };

      const counts = { customer: { active: 0, inactive: 0 }, supplier: { active: 0, inactive: 0 } };
      for (const c of partyCounts) {
        const bucket = counts[c._id.kind];
        if (bucket) bucket[c._id.active === false ? 'inactive' : 'active'] += c.n;
      }

      return {
        customers: shapeSide(f.cTotals[0], f.cTop),
        suppliers: shapeSide(f.sTotals[0], f.sTop),
        monthly: f.monthly.map((m) => ({ month: m._id, total: r2(m.total), settled: r2(m.settled), outstanding: r2(m.total - m.settled) })),
        aging: { customer: shapeAging(f.cAging[0]), supplier: shapeAging(f.sAging[0]) },
        byBranch: f.byBranch.map((b) => ({ branch: b._id, reports: b.reports, receivable: r2(b.receivable), payable: r2(b.payable) })),
        counts,
      };
    });

    if (receivablesOnly(req.user)) {
      const { suppliers: _s, ...rest } = data;
      return res.json({
        ...rest,
        aging: { customer: data.aging.customer },
        byBranch: data.byBranch.map(({ payable, ...b }) => b),
        counts: { customer: data.counts.customer, supplier: data.counts.supplier },
      });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل اللوحة', error: e.message });
  }
};

/** Board filter values, from the statements themselves. */
exports.dashboardFilterOptions = async (req, res) => {
  try {
    const only = receivablesOnly(req.user);
    // Three distinct reads over all statements (three seconds) on every board open, for a name list that changes only with a new customer. So it is cached and refreshed in the background.
    const [customers, suppliers, branches] = await cache.wrapStale(`${CACHE_PREFIX}dashfilters`, 5 * 60 * 1000, 60 * 60 * 1000, () => Promise.all([
      OperationsWorkflow.distinct('username', { ...NOT_CANCELLED, username: { $nin: [null, ''] } }),
      OperationsWorkflow.distinct('carOwner', { ...NOT_CANCELLED, carOwner: { $nin: [null, ''] } }),
      OperationsWorkflow.distinct('branch', { ...NOT_CANCELLED, branch: { $nin: [null, ''] } }),
    ]))
      // Supplier names are not shown to someone who cannot see what is owed to them: a filter with no result.
      .then(([c, sup, b]) => [c, only ? [] : sup, b]);
    res.json({
      customers: [...customers].sort().slice(0, 1000),
      suppliers: [...suppliers].sort().slice(0, 1000),
      // Spellings differing only by whitespace are one branch.
      branches: [...new Set(branches.map(normKey).filter(Boolean))].sort(),
      receivablesOnly: only,
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر', error: e.message });
  }
};

/** Filter values built from the data itself, not hand-written. */
exports.filterOptions = async (req, res) => {
  try {
    const kind = String(req.query.kind || 'customer');
    if (!isKind(kind)) return res.status(400).json({ message: 'kind must be customer or supplier' });
    const [status, city, partyType] = await Promise.all([
      CollectionsParty.distinct('status', { kind, status: { $nin: [null, ''] } }),
      CollectionsParty.distinct('city', { kind, city: { $nin: [null, ''] } }),
      CollectionsParty.distinct('partyType', { kind, partyType: { $nin: [null, ''] } }),
    ]);
    res.json({ status: status.sort(), city: city.sort(), partyType: partyType.sort() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر', error: e.message });
  }
};

// Called from scripts after import so the screen does not stay on old numbers for a minute.
// The line previously lacked parentheses: `cache.clear('cdr:')` ran once at load, not on each call, so aging numbers stayed stale after every invalidate.
exports.invalidate = () => { cache.clear(CACHE_PREFIX); cache.clear('cdr:'); };
exports._internals = { statsByKind, FIELD_OF, VALUE_OF, CLOSED_BY, NOT_CANCELLED };

// Invoices: where the collections department works. Two pages, not one statements page: cash statements are collected the same day by statement number; tax invoices are grouped by invoice number (one invoice can hold several statements).
// Invoice ages are non-overlapping bands ('over 15 days' means 15 to 30), so each invoice is counted in exactly one band.
/**
 * A number meaning 'no invoice' is not an invoice number.
 * The data has 1,993 statements with 'no inv' in the invoice field, a phrase meaning not yet invoiced. Counted as an invoice number it would appear at the top of the page as an 'invoice' with 2,000 statements and an aggregated value, which does not exist; real invoices are 4-digit numbers carrying about 18 statements each.
 * Absence of a value is not a value: anything meaning 'no invoice' is read as an empty field.
 */
// The same list the payment-type derivation reads, in one place (utils/paymentType): there were two copies, and 'n/a' was an invoice number there but not here.
/**
 * Condition for a real invoice number.
 * Matching ignores letter case: the data has 'no inv' and 'no Inv', and listing variants by hand misses ones nobody imagined (it did miss the second until it showed in the page). A single expression accepts both cases and extra whitespace.
 */
const { NO_INVOICE_RX, NO_INVOICE_TOKENS } = require('../utils/paymentType');
const REAL_INVOICE = { invoiceNumber: { $nin: [null, ''], $not: NO_INVOICE_RX } };

/** Maximum rows an account statement reads; above it, narrowing the filter is requested. */
const STATEMENT_ROW_CAP = 20000;

const AGE_BANDS = {
  '0_15': [0, 15],
  '15_30': [15, 30],
  '30_45': [30, 45],
  '45_60': [45, 60],
  '60_plus': [60, null],
};

/** Age condition on a date field, in days from it until today. */
function ageCondition(field, band) {
  const b = AGE_BANDS[band];
  if (!b) return {};
  const [from, to] = b;
  const now = Date.now();
  const cond = {};
  // Older age means smaller date: 'more than 15 days old' = date older than (today - 15).
  // The newest band has no upper bound: the data has future-dated statements, and a bound of 'older than today' dropped them from all bands, so the sum fell short of the total by one with no known cause.
  if (from) cond.$lte = new Date(now - from * 86400000);
  if (to != null) cond.$gt = new Date(now - to * 86400000);
  return { [field]: cond };
}

/** Shared filters of both pages: customer, branch, range, collection state and age band. */
/**
 * Customer names on a page to their file ids, in one query.
 * A row carries a name while the customer file opens by id. Translating in the UI would cost a second request per click and make the user wait twice. It is translated here for 100 rows at once, by folded name so all name spellings meet on one file.
 */
async function partyIdsByName(names, kind = 'customer') {
  const keys = [...new Set((names || []).filter(Boolean).map((n) => fold(n)))];
  if (!keys.length) return new Map();
  const rows = await CollectionsParty.find({ kind, nameKey: { $in: keys } }).select('_id nameKey').lean();
  return new Map(rows.map((r) => [r.nameKey, String(r._id)]));
}

/** Invoice ledger conditions from the page query; read by the table and the column-values list. */
function ledgerInvoiceMatch(query) {
  // The tax page is for tax only. It used to show the whole ledger when cash held only three invoices. Then the cash shipments sheet (1835 shipments) arrived and appeared here as 'tax invoices' with derived tax that does not exist, plus 118 reserved numbers counted as 'not yet collected'. The type is now the sheet the row came from: Daily Invoice Report is tax.
  const f = { kind: 'tax', unused: { $ne: true } };
  if (query.customer) f.partyName = flexSpaceRegex(String(query.customer));
  if (query.q) {
    const { exact, loose } = numberSearchRegex(String(query.q));
    const rx = exact || loose;
    f.$or = [{ invoiceNumber: rx }, { partyName: exact ? rx : loose }, { partyCode: rx }];
  }
  // 'Collected' by the single ledger definition; see models/CollectionInvoice.OPEN.
  // Three states: 'not collected' has nothing received, 'partial' has something received below its value, 'collected' is complete. `open` is whatever is not complete (the first two), for debt.
  if (query.collected === 'yes') f.status = /collected/i;
  else if (query.collected === 'no') { f.status = { $not: /collected/i }; f.collectedAmount = { $not: { $gt: 0 } }; }
  else if (query.collected === 'partial') { f.status = { $not: /collected/i }; f.collectedAmount = { $gt: 0 }; }
  else if (query.collected === 'open') f.status = { $not: /collected/i };
  if (query.from || query.to) {
    f.invoiceDate = {};
    if (query.from) f.invoiceDate.$gte = new Date(query.from);
    if (query.to) f.invoiceDate.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.age) {
    const c = ageCondition('invoiceDate', String(query.age));
    if (c.invoiceDate) f.invoiceDate = { ...(f.invoiceDate || {}), ...c.invoiceDate };
  }
  return f;
}

/**
 * Excel-style column filters for both invoice pages.
 * Why on the server: the table is paginated on the server (100 rows per page of 9,000), so building the value list from loaded rows shows only the current page's values, and filtering by them filters 100 and leaves the rest. Values are computed in the database and the filter applied there.
 * Values arrive repeated (`cf_x=a&cf_x=b`), not comma-joined, because values can contain commas and a customer name with a comma would become two customers.
 */
// What each page may filter by, and which collection it reads from.
const COL_FIELDS = {
  // Cash: its row is an operations statement.
  cash: {
    reportNumber: 'text', username: 'text', branch: 'text', payingBranch: 'text',
    fromLocation: 'text', toLocation: 'text', collectionDetail: 'text',
    paymentDate: 'date', collectionDate: 'date', deliveryDate: 'date',
  },
  // Tax: its row is a ledger invoice.
  tax: {
    invoiceNumber: 'text', partyName: 'text', partyCode: 'text', status: 'text',
    invoiceDate: 'date', deliveryDate: 'date', collectionDate: 'date',
  },
};
const RIYADH = 'Asia/Riyadh';

/** 'YYYY-MM-DD' in Riyadh time to the whole day's range in UTC. */
function riyadhDayRange(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  // Riyadh is a fixed +03:00 with no daylight saving.
  const start = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000+03:00`);
  return { $gte: start, $lt: new Date(start.getTime() + 86400000) };
}

/** Reads `cf_<field>` from the query and builds a Mongo condition. */
function columnFilters(query, kind) {
  const allowed = COL_FIELDS[kind] || {};
  const and = [];
  for (const [key, raw] of Object.entries(query || {})) {
    if (!key.startsWith('cf_')) continue;
    const field = key.slice(3);
    const type = allowed[field];
    if (!type) continue; // A column not allowed is ignored and the filter is not widened.
    const values = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v));
    if (!values.length) continue;

    if (type === 'date') {
      // '(empty)' is sent as an empty string and means 'no date'.
      const or = [];
      for (const v of values) {
        if (!v) { or.push({ [field]: null }, { [field]: { $exists: false } }); continue; }
        const r = riyadhDayRange(v);
        if (r) or.push({ [field]: r });
      }
      if (or.length) and.push({ $or: or });
    } else {
      // The list shows a readable form that merges what differs only by whitespace ('Dammam' and 'Dammam '), so it is matched by a pattern accepting all of them (see utils/colFilter). It used `$in` on the string and Mongoose trimmed it, so selecting 'Dammam ' returned zero.
      const c = textIn(field, values);
      if (c) and.push(c);
    }
  }
  return and;
}

/**
 * Values of one column with the row count of each value, over the whole matching set.
 * Computed under the existing filters except the column's own: opening the 'customer' list after choosing a customer must show all customers, not only the chosen one, or nobody could add a second customer to the selection.
 */
exports.invoiceColumnOptions = async (req, res) => {
  try {
    const kind = req.params.kind === 'cash' ? 'cash' : 'tax';
    const field = String(req.query.field || '');
    const type = (COL_FIELDS[kind] || {})[field];
    if (!type) return res.status(400).json({ message: 'عمود غير معروف' });

    // List search differs from page search. `q` is the page search and goes to the table conditions as is; if it also carried the list search, typing two letters inside the 'customer' list would narrow the set the values are computed on to what matches those letters in invoice number or name, and the list would shrink for no visible reason.
    const q = String(req.query.search || '').trim();
    const LIMIT = 200;

    // The existing filters without this column's filter.
    const others = { ...req.query };
    delete others[`cf_${field}`];

    let match;
    let Model;
    if (kind === 'cash') {
      const { AUTO_RULE_FROM, REVIEWED_MATCH } = require('../utils/paymentType');
      match = { ...invoiceFilters(others, { ageField: 'paymentDate' }), paymentType: 'cash' };
      match.$and = [
        ...(match.$and || []),
        // The same condition as in cashInvoices, plus what the wallet collected.
        { $or: [{ reportDate: { $lt: AUTO_RULE_FROM } }, ...REVIEWED_MATCH.$or, { collectedByWallet: true }] },
        ...columnFilters(others, kind),
      ];
      Model = OperationsWorkflow;
    } else {
      const CollectionInvoice = require('../models/CollectionInvoice');
      match = ledgerInvoiceMatch(others);
      match.$and = [...(match.$and || []), ...columnFilters(others, kind)];
      Model = CollectionInvoice;
    }
    if (!match.$and.length) delete match.$and;

    const groupId = type === 'date'
      ? { $cond: [{ $ifNull: [`$${field}`, false] },
        { $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone: RIYADH } }, ''] }
      : { $ifNull: [`$${field}`, ''] };

    const pipeline = [{ $match: match }, { $group: { _id: groupId, count: { $sum: 1 } } }];
    if (q) {
      // Search inside the list runs on the value after grouping, so it covers dates formatted as displayed.
      pipeline.push({ $match: { _id: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } });
    }
    // Frequency ordering does not suit a column of unique values.
    // The invoice ledger has 11,000 rows with 11,000 different numbers; only two numbers repeat (7679 and '-14', twice each). Frequency ordering always lifts those two to the top, so someone choosing an invoice finds '7679' stuck to it every time and reads it as an imposed filter. It is not imposed: it is first because it is the only repeated number.
    // Number columns (invoice, statement, document, account code) are therefore sorted by value descending, since numbers grow with time and the newest is what is wanted, and read as numbers not text ('10012' after '7679', not before).
    // Other columns (state, branch, customer) keep frequency order: few repeated values, and the most frequent is what is searched for.
    const ID_LIKE = new Set(['invoiceNumber', 'reportNumber', 'documentNumber', 'partyCode']);
    if (type === 'date') {
      pipeline.push({ $sort: { _id: -1 } });
    } else if (ID_LIKE.has(field)) {
      pipeline.push({ $addFields: { _num: { $convert: { input: '$_id', to: 'double', onError: null, onNull: null } } } });
      // Non-numbers go last: '(empty)' and odd strings do not precede invoice numbers.
      pipeline.push({ $sort: { _num: -1, _id: -1 } });
      pipeline.push({ $project: { _num: 0 } });
    } else {
      pipeline.push({ $sort: { count: -1, _id: 1 } });
    }
    pipeline.push({ $limit: LIMIT + 1 });

    const rows = await Model.aggregate(pipeline).allowDiskUse(true);
    const truncated = rows.length > LIMIT;
    // Spellings differing only by whitespace are one line, in the order they arrived.
    const values = type === 'date'
      ? rows.slice(0, LIMIT).map((r) => ({ value: String(r._id ?? ''), count: r.count }))
      : mergeOptions(rows.slice(0, LIMIT).map((r) => ({ value: r._id, count: r.count })));
    res.json({ values, truncated });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل قيم العمود', error: e.message });
  }
};

function invoiceFilters(query, { ageField }) {
  const f = { ...NOT_CANCELLED };
  if (query.customer) f.username = flexSpaceRegex(String(query.customer));
  if (query.branch) f.payingBranch = textMatcher(String(query.branch));
  if (query.q) {
    // A full number is requested in full. Searching '9719' returned six rows in two invoices: the invoice itself, a statement numbered 9719, and a voucher numbered 9719 under another invoice, so the invoice looked duplicated. If the number matches a whole field it is the intended one; containment stays for those who typed a part. See numberSearchRegex.
    const { exact, loose } = numberSearchRegex(String(query.q));
    const rx = exact || loose;
    f.$or = [{ reportNumber: rx }, { invoiceNumber: rx }, { username: exact ? rx : loose }, { documentNumber: rx }];
  }

  // Collection state. The page shows collected and uncollected together and asks both questions, 'what is left?' and 'how much did we collect?', so the choice is explicit above the table, not hidden in a filter. The ledger can say 'collected' with no date, so the filter asks about both. Three states, not two; see utils/collectionState.
  const stateCond = cashStateMatch(String(query.collected || ''));
  if (stateCond) f.$and = [...(f.$and || []), stateCond];

  // Collection detail: 'show me what the branch alone collects'.
  if (query.detail) f.collectionDetail = String(query.detail);

  const range = query.from || query.to ? dayRange(query.from, query.to) : null;
  if (range) f[ageField] = range;
  if (query.age && AGE_BANDS[query.age]) {
    const c = ageCondition(ageField, query.age)[ageField];
    f[ageField] = { ...(f[ageField] || {}), ...c };
  }
  if (!f[ageField]) f[ageField] = { $ne: null };
  return f;
}

/**
 * Cash invoices: cash statements whose payment to the supplier is complete.
 * They arrive when operations staff choose 'cash' and write the payment date, branch and amount: that means the shipment was executed and the supplier paid, so the money is now with the customer and is claimed that day.
 * 'Payment amount' is not shown here: it is what was paid to the supplier, while what is collected from the customer is another number the collector writes when received.
 */
/** Attachment counts for the page's rows; see controllers/collectionsAttachmentsController. The account statement (`req.allRows`) passes through here too; an index aggregation is not heavy. */
const attachmentCounts = (kind, keys) => require('./collectionsAttachmentsController').countsFor(kind, keys);

/** Cash invoices page condition, in one function read by both the page and the collections board (the 'credit - cash', 'cash - 3PL' and 'cash - HT' cards in collectionsReceivablesController), so the board never counts a statement the page does not show. */
function cashScreenFilter(query) {
  const { AUTO_RULE_FROM, REVIEWED_MATCH } = require('../utils/paymentType');
  const filter = {
    ...invoiceFilters(query, { ageField: 'paymentDate' }),
    paymentType: 'cash',
  };
  filter.$and = [...(filter.$and || []), {
    $or: [
      { reportDate: { $lt: AUTO_RULE_FROM } },
      // Operations (or accounts) review; see REVIEWED_MATCH in utils/paymentType.
      ...REVIEWED_MATCH.$or,
      // Except what the rep collected in the wallet. The money arrived, so it does not wait for operations review: it appears here at once as collected. See utils/walletCollection.
      { collectedByWallet: true },
    ],
  }, ...columnFilters(query, 'cash')];
  return filter;
}
exports.cashScreenFilter = cashScreenFilter;

/**
 * 'I searched the number and did not find it': where is it?
 * The cash page reads reviewed cash operations statements and the tax page reads tax ledger invoices. A number outside both (a cash ledger invoice with no statement, a tax statement on the sheet, or a statement operations has not reviewed) is searched in both pages and not found, read as 'does not exist' although it does (invoice 65994).
 * So when the page finds nothing it says where the number is and why it is not here, with a link to it. Computed only for a full-number search that returned empty, so normal page work is not slowed.
 */
async function locateNumber(q) {
  const n = String(q || '').trim();
  if (!/^\d{3,}$/.test(n)) return null;
  const CollectionInvoice = require('../models/CollectionInvoice');
  const { isReviewed, underNewRule } = require('../utils/paymentType');
  const [ledger, sheets] = await Promise.all([
    CollectionInvoice.find({ invoiceNumber: n, unused: { $ne: true } })
      .select('kind invoiceNumber partyName status collectionDate').limit(5).lean(),
    OperationsWorkflow.find({ $or: [{ reportNumber: n }, { invoiceNumber: n }, { documentNumber: n }] })
      .select('reportNumber invoiceNumber username paymentType paymentDate operationsReview accountingReview reportDate executionStatus collectedByWallet')
      .limit(5).lean(),
  ]);
  if (!ledger.length && !sheets.length) return { number: n, ledger: [], sheets: [] };
  const cancelled = NOT_CANCELLED.executionStatus.$nin;
  return {
    number: n,
    ledger: ledger.map((i) => ({
      kind: i.kind, invoiceNumber: i.invoiceNumber, customer: i.partyName || '',
      collected: /collected/i.test(i.status || ''),
    })),
    sheets: sheets.map((w) => {
      // Why the statement is not on the cash page, under its own conditions (cashScreenFilter).
      let why = '';
      if (cancelled.includes(w.executionStatus)) why = 'cancelled';
      else if (w.paymentType !== 'cash') why = w.paymentType === 'tax' ? 'tax' : 'noType';
      else if (!w.paymentDate) why = 'noPaymentDate';
      else if (underNewRule(w) && !isReviewed(w) && !w.collectedByWallet) why = 'notReviewed';
      return {
        _id: w._id, reportNumber: w.reportNumber, invoiceNumber: w.invoiceNumber || '',
        customer: w.username || '', paymentType: w.paymentType || '', why,
      };
    }),
  };
}

exports.cashInvoices = async (req, res) => {
  try {
    // A cash statement is collectable whether or not we know what we paid: 'payment amount' is what we paid the supplier, not what the customer owes, so the condition is the cash type alone (requiring it hid all but five of 1,834).
    // It reaches the screen only after operations review, applied to new statements only (see AUTO_RULE_FROM) since the review column is empty on 29k earlier ones.
    const filter = cashScreenFilter(req.query);

    const page = Math.max(1, Number(req.query.page) || 1);
    // `req.allRows` is set only by the account statement (services/invoiceStatement) when it calls this function in the same process: the statement prints the whole result, not one page. It is not read from the query, so no one can request the whole ledger with a URL line.
    const limit = req.allRows ? STATEMENT_ROW_CAP : Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    // Per-state counter above the table. The three buttons show how many each holds under the other filters, not under their own selection, otherwise 'not collected' would show zero for someone who selected 'collected'.
    const stateFilter = req.allRows ? null : cashScreenFilter({ ...req.query, collected: '' });
    const [rows, total, totals, stateAgg] = await Promise.all([
      OperationsWorkflow.find(filter)
        .select('reportNumber reportDate username payingBranch paymentDate collectedAmount collectionDate cashCollectionStatus collectedByWallet collectionDetail deliveryDate branch fromLocation toLocation sellingValue collectionPayments')
        .sort({ paymentDate: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      OperationsWorkflow.countDocuments(filter),
      OperationsWorkflow.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            collected: { $sum: { $ifNull: ['$collectedAmount', 0] } },
            value: { $sum: { $ifNull: ['$sellingValue', 0] } },
            // What remains on the incomplete: a partial by its remainder, not its whole value.
            remaining: { $sum: cashRemainingExpr },
            partialCount: { $sum: { $cond: [cashPartialExpr, 1, 0] } },
            // Collected with no date. The cash ledger says 'Collected' for 99 statements with no date in it. Counting them uncollected because the date cell is empty makes the screen claim money that arrived.
            collectedCount: { $sum: { $cond: [cashCollectedExpr, 1, 0] } },
          },
        },
      ]),
      stateFilter ? OperationsWorkflow.aggregate([
        { $match: stateFilter },
        { $group: {
          _id: null,
          all: { $sum: 1 },
          yes: { $sum: { $cond: [cashCollectedExpr, 1, 0] } },
          partial: { $sum: { $cond: [cashPartialExpr, 1, 0] } },
        } },
      ]) : [],
    ]);

    const now = Date.now();
    const t = totals[0] || { collected: 0, collectedCount: 0, partialCount: 0, remaining: 0 };
    const sc = stateAgg[0] || { all: 0, yes: 0, partial: 0 };
    // Attachment count of the whole page in one aggregation, not a call per row. Also the customs transaction the statement serves; see services/customsOpsLink.
    const customsLinks = require('../services/customsOpsLink');
    const [partyIds, attCounts, linked] = await Promise.all([
      partyIdsByName(rows.map((w) => w.username)),
      attachmentCounts('cash', rows.map((w) => String(w._id))),
      customsLinks.linkedIndex(),
    ]);
    const elsewhere = !rows.length && req.query.q && !req.allRows ? await locateNumber(req.query.q) : null;
    res.json({
      elsewhere,
      invoices: rows.map((w) => ({
        _id: w._id,
        reportNumber: w.reportNumber,
        customer: w.username || '',
        partyId: partyIds.get(fold(w.username || '')) || '',
        branch: w.branch || '',
        payingBranch: w.payingBranch || '',
        paymentDate: w.paymentDate,
        route: [w.fromLocation, w.toLocation].filter(Boolean).join(' — '),
        // What is claimed shows beside what was received. The page showed only 'collection amount', which is zero on 1,337 statements whose amount is not yet written, so the collector saw zeros and did not know how much to claim.
        value: r2(w.sellingValue),
        collectedAmount: r2(w.collectedAmount),
        // Not collected / partial / fully collected, with remainder and payments.
        collectionState: cashState(w),
        remaining: cashRemaining(w),
        payments: (w.collectionPayments || []).map(paymentView),
        collectionDate: w.collectionDate || null,
        // 'Collected' in the ledger even if its day is unknown: the screen says so explicitly instead of 'not collected'.
        collectedNoDate: !w.collectionDate && w.cashCollectionStatus === 'collected',
        // Collected by the wallet (a collection entry by statement number), not by the department's hand; see utils/walletCollection.
        collectedByWallet: !!w.collectedByWallet,
        // Cash is delivered to the customer like tax. A cash invoice is carried to the customer and signed like any other, and is claimed from that day. The delivery button was on the tax page only, leaving half the work with no date in the system.
        deliveryDate: w.deliveryDate || null,
        collectionDetail: w.collectionDetail || '',
        ageDays: w.paymentDate ? Math.floor((now - new Date(w.paymentDate).getTime()) / 86400000) : null,
        attachments: attCounts.get(String(w._id)) || 0,
        customs: customsLinks.customsOfReport(linked, w.reportNumber),
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      // `pendingCount` is whatever is not complete (not collected + partial), as before so no old screen breaks; `noneCount` is whatever has nothing received.
      totals: {
        value: r2(t.value), collected: r2(t.collected), remaining: r2(t.remaining),
        collectedCount: t.collectedCount, partialCount: t.partialCount || 0,
        pendingCount: total - t.collectedCount, noneCount: total - t.collectedCount - (t.partialCount || 0),
      },
      ...(stateFilter ? { stateCounts: { all: sc.all, no: sc.all - sc.yes - sc.partial, partial: sc.partial, yes: sc.yes } } : {}),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل فواتير الكاش', error: e.message });
  }
};

/**
 * Tax invoices: grouped by invoice number.
 * One invoice can hold more than one statement, which is normal. The row here is an invoice, not a statement, with its statement count; opening it gives the detail.
 */
/**
 * Tax invoices from the invoice ledger, not statements.
 * Why the source flipped: this page grouped operations statements by invoice number. An invoice is not born from a statement: the collection ledger has 8,978 invoices, and only 558 of their numbers appear on our statements, 6%. So 94% of company invoices were missing from a page named 'tax invoices': searching invoice 11800 found nothing although it is in the system, worth 4715 and delivered to its owner.
 * The source is now the ledger, as the CollectionInvoice model itself says: the invoice is a standalone document and the statement belongs to it when there is one. Statements are attached when present, keeping 'how many statements under it' and 'were all collected'.
 */
exports.taxInvoices = async (req, res) => {
  try {
    const CollectionInvoice = require('../models/CollectionInvoice');
    const page = Math.max(1, Number(req.query.page) || 1);
    // See `req.allRows` in cashInvoices.
    const limit = req.allRows ? STATEMENT_ROW_CAP : Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    // The whole ledger is invoices. It used to exclude rows with `kind` 'cash', but `kind` is an attribute inferred from the shape of the account code (C...) and not something in the sheet. That dropped three real invoices from the 'Daily Invoice Report' sheet (for Tanshit, delivered, worth 7,700) from the invoices page, and they did not appear on the cash page either since that reads statements, so they showed on no screen. Every row of that sheet is an invoice, so all are shown.
    const f = ledgerInvoiceMatch(req.query);
    // Column filters are added on top; see columnFilters.
    const cf = columnFilters(req.query, 'tax');
    if (cf.length) f.$and = [...(f.$and || []), ...cf];

    // Per-state counter under the other filters; see the same explanation in cashInvoices.
    let sf = null;
    if (!req.allRows) {
      sf = ledgerInvoiceMatch({ ...req.query, collected: '' });
      if (cf.length) sf.$and = [...(sf.$and || []), ...cf];
    }
    const collectedExpr = { $regexMatch: { input: { $ifNull: ['$status', ''] }, regex: /collected/i } };
    const partialExpr = { $and: [{ $not: [collectedExpr] }, { $gt: [{ $ifNull: ['$collectedAmount', 0] }, 0] }] };
    const [rows, total, totalsAgg, stateAgg] = await Promise.all([
      CollectionInvoice.find(f).sort({ invoiceDate: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      CollectionInvoice.countDocuments(f),
      CollectionInvoice.aggregate([
        { $match: f },
        { $group: {
          _id: null,
          value: { $sum: '$total' },
          invoices: { $sum: 1 },
          fullyCollected: { $sum: { $cond: [collectedExpr, 1, 0] } },
          partial: { $sum: { $cond: [partialExpr, 1, 0] } },
          // Collected: the whole value of collected invoices plus what was received on others; the remainder is the rest.
          collected: { $sum: { $cond: [collectedExpr, { $ifNull: ['$total', 0] }, { $ifNull: ['$collectedAmount', 0] }] } },
        } },
      ]),
      sf ? CollectionInvoice.aggregate([
        { $match: sf },
        { $group: {
          _id: null,
          all: { $sum: 1 },
          yes: { $sum: { $cond: [collectedExpr, 1, 0] } },
          partial: { $sum: { $cond: [partialExpr, 1, 0] } },
        } },
      ]) : [],
    ]);

    // Statements of this page only, not the whole ledger: a small query over 100 numbers.
    const nums = rows.map((r) => r.invoiceNumber).filter(Boolean);
    const repAgg = nums.length ? await OperationsWorkflow.aggregate([
      { $match: { invoiceNumber: { $in: nums }, ...NOT_CANCELLED } },
      { $group: {
        _id: '$invoiceNumber',
        reports: { $sum: 1 },
        collectedReports: { $sum: { $cond: [{ $ifNull: ['$collectionDate', false] }, 1, 0] } },
        branch: { $first: '$branch' },
        payingBranch: { $first: '$payingBranch' },
      } },
    ]) : [];
    const byNo = new Map(repAgg.map((r) => [r._id, r]));

    const t = totalsAgg[0] || { value: 0, invoices: 0, fullyCollected: 0, partial: 0, collected: 0 };
    const sc = stateAgg[0] || { all: 0, yes: 0, partial: 0 };
    const now = Date.now();
    const customsLinks = require('../services/customsOpsLink');
    const [partyIds, attCounts, linked] = await Promise.all([
      partyIdsByName(rows.map((r) => r.partyName)),
      attachmentCounts('tax', nums),
      customsLinks.linkedIndex(),
    ]);

    const elsewhere = !rows.length && req.query.q && !req.allRows ? await locateNumber(req.query.q) : null;
    res.json({
      elsewhere,
      invoices: rows.map((i) => {
        const rep = byNo.get(i.invoiceNumber);
        // Collected is read from the ledger first. The ledger says 'collected' even when we hold no statement for it; our statements complete the picture and do not contradict it.
        const collected = /collected/i.test(i.status || '');
        return {
          invoiceNumber: i.invoiceNumber,
          customer: i.partyName || '',
          partyId: partyIds.get(fold(i.partyName || '')) || '',
          partyCode: i.partyCode || '',
          value: r2(i.total),
          // Net and tax are derived from the total when the ledger does not state them.
          net: r2(i.total / 1.15),
          vat: r2(i.total - i.total / 1.15),
          invoiceDate: i.invoiceDate,
          deliveryDate: i.deliveryDate,
          branch: rep?.branch || '',
          payingBranch: rep?.payingBranch || '',
          reports: rep?.reports || 0,
          collectedReports: rep?.collectedReports || 0,
          fullyCollected: collected,
          // What was received and what remains. 'Partial' until the received amount reaches the value; see CollectionInvoice.stateOf.
          collectionState: CollectionInvoice.stateOf(i),
          collectedAmount: r2(CollectionInvoice.collectedOf(i)),
          remaining: r2(CollectionInvoice.remainingOf(i)),
          payments: (i.payments || []).map(paymentView),
          collectionDate: i.collectionDate || null,
          status: i.status || '',
          ageDays: i.invoiceDate ? Math.floor((now - new Date(i.invoiceDate).getTime()) / 86400000) : null,
          attachments: attCounts.get(String(i.invoiceNumber || '').trim()) || 0,
          // Customs transactions served by this invoice's statements.
          customs: customsLinks.customsOfInvoice(linked, i.invoiceNumber),
        };
      }),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      // `pending` is whatever is not complete (not collected + partial), as before; `none` is whatever has nothing received.
      totals: {
        value: r2(t.value), invoices: t.invoices, fullyCollected: t.fullyCollected,
        partial: t.partial || 0, pending: t.invoices - t.fullyCollected, none: t.invoices - t.fullyCollected - (t.partial || 0),
        collected: r2(t.collected), remaining: r2(t.value - t.collected),
      },
      ...(sf ? { stateCounts: { all: sc.all, no: sc.all - sc.yes - sc.partial, partial: sc.partial, yes: sc.yes } } : {}),
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفواتير الضريبية', error: e.message });
  }
};

/**
 * Invoice detail: the invoice first, then its statements if any.
 * The page used to go blank. This function searched operations statements for the number and, finding none, said 'no statements with this number' and returned 404. The invoice list the click came from is read from the ledger, which says only 6% of its invoices have statements here, so 94% of clicks ended on a blank page.
 * The right order is the model's own: the invoice is a standalone document and the statement belongs to it when present. So the invoice is read from the ledger, its statements attached if any, and shown without statements if none, which is their normal state and not an error.
 * 404 is returned only when the number has no trace in the ledger or the statements.
 */
exports.taxInvoiceDetail = async (req, res) => {
  try {
    const number = String(req.params.invoiceNumber || '').trim();
    if (!number) return res.status(400).json({ message: 'رقم الفاتورة مطلوب' });

    const CollectionInvoice = require('../models/CollectionInvoice');
    const [ledger, rows] = await Promise.all([
      CollectionInvoice.findOne({ invoiceNumber: number }).sort({ kind: -1 }).lean(),
      OperationsWorkflow.find({ invoiceNumber: number, ...NOT_CANCELLED })
        .select('reportNumber reportDate username branch payingBranch fromLocation toLocation carNumber carOwner sellingValue netInvoice tax totalInvoice invoiceDate deliveryDate sendingDate documentNumber collectedAmount collectionDate accountingReview paymentType customsLink')
        .sort({ reportDate: 1 }).lean(),
    ]);

    if (!ledger && !rows.length) return res.status(404).json({ message: 'لا فاتورة بهذا الرقم' });

    // The customer name becomes a link. The invoice carries a name while the customer file opens by id, so the name is translated here once by folded name, not in the UI with a second request per click.
    const customerName = ledger?.partyName || rows[0]?.username || '';
    const partyDoc = customerName
      ? await CollectionsParty.findOne({ kind: 'customer', nameKey: fold(customerName) }).select('_id').lean()
      : null;

    const sum = (k) => r2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
    // Money is read from the ledger when it speaks. The ledger is what the accountant works on: if it states the total, that is the total, and net and tax derive from it. If it is silent (an invoice born from a statement of ours) it is summed from its statements.
    const fromLedger = ledger && Number(ledger.total) > 0;
    const value = fromLedger ? r2(ledger.total) : sum('totalInvoice');
    // Cash carries no tax: its value is entirely net.
    const cashBook = fromLedger && ledger.kind === 'cash';
    const net = fromLedger ? (cashBook ? r2(ledger.total) : r2(ledger.total / 1.15)) : sum('netInvoice');
    const vat = fromLedger ? (cashBook ? 0 : r2(ledger.total - ledger.total / 1.15)) : sum('tax');
    // Follow-up count per statement: its log, written by operations, clearance and collections.
    const fuCounts = await require('./workflowFollowUpController').countsFor(rows.map((r) => r._id));
    // Collection state as collections itself reads it (loadTarget), so the invoice can be collected from its page; a cash invoice with no statement has no other door than this page.
    let collection = null;
    try {
      const tg = await loadTarget({ invoiceNumber: number });
      const state = tg.full ? 'full' : (tg.collected > 0 ? 'partial' : 'none');
      collection = {
        target: tg.kind, value: tg.value, collectedAmount: tg.collected, collectionState: state,
        remaining: tg.full ? 0 : r2(Math.max(0, tg.value - tg.collected)),
        payments: (tg.payments || []).map((p) => (p.toObject ? p.toObject() : p)),
        collectionDate: tg.doc.collectionDate || null,
      };
    } catch (_) { /* An invoice on transport orders alone is collected from the invoices page. */ }

    res.json({
      invoiceNumber: number,
      kind: ledger?.kind || (rows[0]?.paymentType === 'cash' ? 'cash' : 'tax'),
      customer: customerName,
      partyId: partyDoc?._id ? String(partyDoc._id) : '',
      partyCode: ledger?.partyCode || '',
      invoiceDate: ledger?.invoiceDate || rows.find((r) => r.invoiceDate)?.invoiceDate || null,
      deliveryDate: ledger?.deliveryDate || rows.find((r) => r.deliveryDate)?.deliveryDate || null,
      collectionDate: ledger?.collectionDate || null,
      status: ledger?.status || '',
      comments: ledger?.comments || '',
      // Where the invoice came from: the company ledger, or born from a statement of ours.
      inLedger: !!ledger,
      collection,
      // Each statement with its transaction, and the invoice with its transactions together; see services/customsOpsLink.
      reports: rows.map((r) => ({
        ...r, customsLink: undefined, customs: require('../services/customsOpsLink').linkView(r.customsLink),
        followUps: fuCounts.get(String(r._id)) || 0,
      })),
      customs: (() => {
        const m = new Map();
        for (const r of rows) {
          const v = require('../services/customsOpsLink').linkView(r.customsLink);
          if (!v) continue;
          const prev = m.get(v.clearanceId);
          m.set(v.clearanceId, prev
            ? { ...prev, containers: [...new Set([...prev.containers, ...v.containers])].sort(), reports: prev.reports + 1 }
            : { ...v, reports: 1 });
        }
        return [...m.values()];
      })(),
      totals: {
        reports: rows.length,
        net,
        vat,
        value,
        collectedReports: rows.filter((r) => r.collectionDate).length,
      },
    });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفاتورة', error: e.message });
  }
};

/**
 * Recording the collection.
 * It is written on the statements themselves, not in a second collection table. The statement is the document and its collection date is a column in it, so operations sees it at the same moment with no sync.
 * For an invoice holding statements the date is written on all of them: collecting the invoice collects what is in it, and leaving some open makes it show 'half collected' forever.
 */
// The two ledgers move together.
// An invoice is written in two places: on the operations statements under it, and in the collection ledger (`CollectionInvoice`), which holds 9,000 invoices going back to 2022, most with no statement of ours. They are not a copy of a copy but two faces of one thing.
// Each used to move alone: the ledger said invoice 9719 was delivered on 1 March and collected, while its operations statement was empty, so whoever opened the statement saw an invoice not yet delivered.
// So every recording here writes to both.
const syncInvoiceLedger = async (invoiceNumber, { deliveryDate, collectionDate }) => {
  const no = String(invoiceNumber || '').trim();
  if (!no || NO_INVOICE_RX.test(no)) return null;
  const CollectionInvoice = require('../models/CollectionInvoice');
  const $set = {};
  if (deliveryDate !== undefined) $set.deliveryDate = deliveryDate;
  if (collectionDate !== undefined) $set.collectionDate = collectionDate;
  // State follows the dates and is not written separately: 'collected' is stronger than 'delivered'. Tax only: the cash shipment number is another sequence that may coincide with an invoice number.
  const inv = await CollectionInvoice.findOne({ invoiceNumber: no, kind: 'tax' });
  if (!inv) return null;
  const collected = collectionDate !== undefined ? collectionDate : inv.collectionDate;
  const delivered = deliveryDate !== undefined ? deliveryDate : inv.deliveryDate;
  // Clearing the collection date reopens the invoice, so it is not left 'collected' without a date.
  const wasCollected = /collected/i.test(String(inv.status || ''));
  $set.status = collected ? 'Collected' : (delivered ? 'Delivered' : (wasCollected ? '' : (inv.status || '')));
  await CollectionInvoice.updateOne({ _id: inv._id }, { $set });
  return inv._id;
};

/**
 * The collection date is also written from the operations page, which changes the statement only, leaving the ledger (read by aging, the board and the customer file) stale. Called after every operations save that changed the collection date or customer delivery.
 * Cash: the ledger row follows its statement. Tax: collected when all statements carry a date, not collected when one loses its date.
 * `rows`: statements after saving; `changed`: what changed in each.
 */
const syncLedgerFromWorkflows = async (rows, changed = { collectionDate: true }) => {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length || !(changed.collectionDate || changed.deliveryDate)) return;
  const pickDates = (w) => ({
    ...(changed.collectionDate ? { collectionDate: w.collectionDate || null } : {}),
    ...(changed.deliveryDate ? { deliveryDate: w.deliveryDate || null } : {}),
  });
  // Cash: each statement and its row.
  for (const w of list) await syncCashLedger({ _id: w._id }, pickDates(w));
  // Tax: once per invoice number.
  const numbers = [...new Set(list.map((w) => String(w.invoiceNumber || '').trim()).filter((n) => n && !NO_INVOICE_RX.test(n)))];
  for (const no of numbers) {
    const sheets = await OperationsWorkflow.find({ invoiceNumber: no, ...NOT_CANCELLED }).select('collectionDate deliveryDate').lean();
    if (!sheets.length) continue;
    const dates = {};
    if (changed.collectionDate) {
      // A date cleared from a statement makes the invoice not collected. A date written makes it collected if all its statements are complete. If written on only some, the ledger is left alone: it may be collected at its source (the department ledger) with its operations statements having no dates, which is the common case.
      const cleared = list.some((w) => String(w.invoiceNumber || '').trim() === no && !w.collectionDate);
      if (cleared) dates.collectionDate = null;
      else if (sheets.every((x) => !!x.collectionDate)) dates.collectionDate = new Date(Math.max(...sheets.map((x) => new Date(x.collectionDate).getTime())));
    }
    if (!Object.keys(dates).length && !changed.deliveryDate) continue;
    if (changed.deliveryDate) {
      const got = sheets.map((s) => s.deliveryDate).filter(Boolean);
      dates.deliveryDate = got.length ? new Date(Math.max(...got.map((d) => new Date(d).getTime()))) : null;
    }
    await syncInvoiceLedger(no, dates);
  }
  cache.clear(CACHE_PREFIX); cache.clear('cdr:');
  try { require('./collectionsLedgerController').invalidate(); } catch (_) { /* */ }
};
exports.syncLedgerFromWorkflows = syncLedgerFromWorkflows;

/**
 * A cash shipment has a ledger row too.
 * The cash page writes collection on the operations statement, and the ledger holds the same shipment under its statement number (`kind: cash`). Recording used to stop at the statement: the collector collected the shipment and it stayed in the board and aging as standing debt. So both are written.
 */
const syncCashLedger = async (filter, { deliveryDate, collectionDate }) => {
  const CollectionInvoice = require('../models/CollectionInvoice');
  const sheets = await OperationsWorkflow.find(filter).select('reportNumber collectedAmount').lean();
  const numbers = sheets.map((w) => String(w.reportNumber || '').trim()).filter(Boolean);
  if (!numbers.length) return 0;
  // Received follows the statement with the date. A partial shipment in the ledger is counted as debt at its remainder, so the ledger must know what was received; otherwise the board counts it at full value.
  if (collectionDate !== undefined) {
    const ops = sheets.filter((w) => String(w.reportNumber || '').trim()).map((w) => ({
      updateMany: {
        filter: { kind: 'cash', invoiceNumber: String(w.reportNumber).trim() },
        update: { $set: { collectedAmount: r2(w.collectedAmount) } },
      },
    }));
    if (ops.length) await CollectionInvoice.bulkWrite(ops, { ordered: false });
  }
  const $set = {};
  if (deliveryDate !== undefined) $set.deliveryDate = deliveryDate;
  if (collectionDate !== undefined) {
    $set.collectionDate = collectionDate;
    // Clearing the date reopens the shipment, so its state is not left 'collected' without a date.
    $set.status = collectionDate ? 'Collected' : '';
  }
  if (!Object.keys($set).length) return 0;
  const r = await CollectionInvoice.updateMany({ kind: 'cash', invoiceNumber: { $in: numbers } }, { $set });
  return r.modifiedCount || 0;
};

/**
 * Record delivery of the invoice to the customer: POST /invoices/deliver
 * The collections team takes invoices to customers, and the agreed term starts from the day the customer receives: a 45-day term is counted from that day, not from the invoice issue date or its arrival at the branch.
 * This differs from `branchDeliveryDate`, delivery of the statement to the branch, which is operations work and comes from the follow-up sheet. They were one field, so the term was computed from a date earlier than the real delivery. See models/OperationsWorkflow.
 */
exports.recordDelivery = async (req, res) => {
  try {
    const { deliveryDate } = req.body;
    if (!deliveryDate) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: تاريخ التسليم للعميل', fields: { deliveryDate: 'مطلوب' } });
    }
    const invoiceNumber = String(req.body.invoiceNumber || '').trim();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!invoiceNumber && !ids.length) return res.status(400).json({ message: 'حدِّد فاتورةً أو أوامر نقل' });

    const filter = invoiceNumber ? { invoiceNumber, ...NOT_CANCELLED } : { _id: { $in: ids } };
    const when = new Date(deliveryDate);
    const r = await OperationsWorkflow.updateMany(filter, { $set: { deliveryDate: when, lastModifiedBy: req.user._id } });
    await syncInvoiceLedger(invoiceNumber, { deliveryDate: when });
    if (!invoiceNumber) await syncCashLedger(filter, { deliveryDate: when });

    cache.clear('wf:');
    cache.clear(CACHE_PREFIX); cache.clear('cdr:');
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    await logAudit({
      user: req.user._id, action: 'record_delivery', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null, entityKey: invoiceNumber || undefined,
      changes: { after: { deliveryDate, count: r.modifiedCount } }, ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, delivery: true }); } catch (_) {}

    res.json({
      updated: r.modifiedCount || 0,
      message: invoiceNumber
        ? `سُجِّل تسليمُ الفاتورة ${invoiceNumber} للعميل على ${r.modifiedCount} أمر نقل`
        : `سُجِّل التسليم للعميل على ${r.modifiedCount} أمر نقل`,
    });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تسجيل التسليم'); }
};

/**
 * Collection detail: PUT /invoices/detail
 * Where the money came from: the branch received it, it was received in cash, or the collector took it from the customer. Values come from `collections_detail` in department settings and are not validated against a fixed list, since that list is editable by design.
 * Written with no date or amount: it is an attribute of the statement, not an event in it, so it is set before or after collection alike.
 */
exports.setCollectionDetail = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!ids.length) return res.status(400).json({ message: 'حدِّد أمر نقل واحدًا على الأقل' });
    const detail = String(req.body.detail || '').trim();

    const r = await OperationsWorkflow.updateMany(
      { _id: { $in: ids } },
      { $set: { collectionDetail: detail, lastModifiedBy: req.user._id } },
    );

    cache.clear('wf:');
    cache.clear(CACHE_PREFIX); cache.clear('cdr:');
    await logAudit({
      user: req.user._id, action: 'set_collection_detail', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null,
      changes: { after: { collectionDetail: detail, count: r.modifiedCount } }, ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, detail: true }); } catch (_) {}

    res.json({ updated: r.modifiedCount || 0, message: detail ? 'حُفظ تفصيلُ التحصيل' : 'أُزيل تفصيلُ التحصيل' });
  } catch (e) { sendMongooseError(res, e, 'تعذّر حفظ تفصيل التحصيل'); }
};

/**
 * A single cash statement: PUT /invoices/cash/:id
 * Why it exists: the app saves any list row with PUT on `<endpoint>/<id>` (that is how `ResourceConfig` is designed). The cash page had no such route, so the collector wrote the amount on the phone, pressed Save, and the write went to a route that did not exist.
 * The three fields are all the collector's work on the statement: what was received, when, when the invoice reached the customer, and where the money came from. What is not sent is untouched, since the app may send one field.
 */
exports.updateCashInvoice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرّفٌ غير صالح' });
    const wf = await OperationsWorkflow.findById(req.params.id);
    if (!wf) return res.status(404).json({ message: 'أمر النقل غير موجود' });

    const $set = { lastModifiedBy: req.user._id };
    const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
    if (has('collectedAmount')) $set.collectedAmount = Number(req.body.collectedAmount) || 0;
    if (has('collectionDate')) $set.collectionDate = req.body.collectionDate ? new Date(req.body.collectionDate) : null;
    if (has('deliveryDate')) $set.deliveryDate = req.body.deliveryDate ? new Date(req.body.deliveryDate) : null;
    if (has('collectionDetail')) $set.collectionDetail = String(req.body.collectionDetail || '').trim();
    // What the collector wrote by hand became their collection, not the wallet's, so the wallet will not write over it again.
    if (has('collectionDate') || has('collectedAmount')) $set.collectedByWallet = false;

    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set });
    // The ledger invoice is updated with it; the two never move alone.
    if ($set.deliveryDate !== undefined || $set.collectionDate !== undefined) {
      const dates = {
        ...($set.deliveryDate !== undefined ? { deliveryDate: $set.deliveryDate } : {}),
        ...($set.collectionDate !== undefined ? { collectionDate: $set.collectionDate } : {}),
      };
      if (wf.invoiceNumber) await syncInvoiceLedger(wf.invoiceNumber, dates);
      await syncCashLedger({ _id: wf._id }, dates);
    }

    cache.clear('wf:');
    cache.clear(CACHE_PREFIX); cache.clear('cdr:');
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    await logAudit({
      user: req.user._id, action: 'update', entity: 'OperationsWorkflow', entityId: wf._id,
      entityKey: wf.reportNumber, changes: { after: req.body }, ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { id: String(wf._id) }); } catch (_) {}

    res.json({ message: 'حُفظ' });
  } catch (e) { sendMongooseError(res, e, 'تعذّر الحفظ'); }
};

/** Writer name as stored with the payment; it stays even if their account changes later. */
const userName = (u) => (u && (u.name || u.fullName || u.username || u.email)) || '';

/** Invalidate then announce; see announce-before-invalidate. */
function afterCollectionWrite() {
  cache.clear('wf:');
  cache.clear(CACHE_PREFIX); cache.clear('cdr:');
  try { require('./collectionsLedgerController').invalidate(); } catch (_) { /* */ }
  try { emitToAll('workflow:updated', { bulk: true, collection: true }); } catch (_) { /* */ }
  try { emitToAll('collections:changed', { source: 'collections', field: 'collectedAmount' }); } catch (_) { /* */ }
}

/** An error returned to the user with its code and message. */
const userError = (status, message) => Object.assign(new Error(message), { status });

/** Reads the target: a tax invoice by number (from the ledger) or a cash statement by id. Returns what the calculation needs in one shape: value, received, whether complete, and payments. */
async function loadTarget(body) {
  const CollectionInvoice = require('../models/CollectionInvoice');
  const invoiceNumber = String(body.invoiceNumber || '').trim();
  const id = body.id || (Array.isArray(body.ids) && body.ids.length === 1 ? body.ids[0] : null);
  if (invoiceNumber) {
    const inv = await CollectionInvoice.findOne({ kind: 'tax', invoiceNumber });
    if (inv) {
      return {
        kind: 'tax', doc: inv, key: invoiceNumber, label: `الفاتورة ${invoiceNumber}`,
        value: r2(inv.total), collected: r2(inv.collectedAmount), full: CollectionInvoice.isCollected(inv),
        payments: inv.payments || [],
      };
    }
    // A cash invoice is also in the ledger by its number (2026/10/27 fix). The cash shipment's ledger row has its statement's number. Collection by number used to read tax only, so a cash invoice opened from the customer file or aging said 'no invoice with this number' on collecting, and stayed a debt no screen could close (invoice 65994). If its statement is ours, the statement is collected and the ledger follows (syncCashLedger); otherwise the ledger row itself is collected.
    const cash = await CollectionInvoice.findOne({ kind: 'cash', invoiceNumber, unused: { $ne: true } });
    if (!cash) throw userError(404, 'لا فاتورة بهذا الرقم في دفتر التحصيل');
    // The statement is collected in its place if it is cash like it: it is its row on the cash page. A tax statement with the same number is under another invoice: untouched, and the ledger is collected at its own value (the ledger is the reference; see collections-ledger).
    const sheet = await OperationsWorkflow.findOne({ reportNumber: invoiceNumber, paymentType: 'cash', ...NOT_CANCELLED });
    if (sheet) return cashSheetTarget(sheet);
    return {
      kind: 'cashLedger', doc: cash, key: invoiceNumber, label: `الفاتورة ${invoiceNumber}`,
      value: r2(cash.total), collected: r2(cash.collectedAmount), full: CollectionInvoice.isCollected(cash),
      payments: cash.payments || [],
    };
  }
  if (!id || !mongoose.isValidObjectId(id)) throw userError(400, 'حدِّد فاتورةً واحدةً أو أمر نقل واحدًا');
  const wf = await OperationsWorkflow.findById(id);
  if (!wf) throw userError(404, 'أمر النقل غير موجود');
  return cashSheetTarget(wf);
}

const cashSheetTarget = (wf) => ({
  kind: 'cash', doc: wf, key: String(wf._id), label: `أمر النقل ${wf.reportNumber || ''}`,
  value: r2(wf.sellingValue), collected: r2(wf.collectedAmount), full: cashIsCollected(wf),
  payments: wf.collectionPayments || [],
});

/**
 * Writes the target's state after its payments changed: received, payments and completion.
 * Completion is computed, not chosen. When received reaches the value it becomes fully collected with the date of the last payment, in statements and ledger together, as the full collection always writes them. Below it (a payment removed or reduced) it returns to partial and the date is removed from both.
 * `forceFull`: full collection of a cash statement with no known value; it completes with what was received.
 */
async function settleTarget(tg, { collected, payments, user, forceFull = false, date = null }) {
  const CollectionInvoice = require('../models/CollectionInvoice');
  const reaches = tg.value > 0 ? collected >= tg.value - EPS : false;
  const full = forceFull || reaches;
  const lastDate = payments.length
    ? new Date(Math.max(...payments.map((p) => new Date(p.date).getTime())))
    : null;
  const when = full ? (date ? new Date(date) : lastDate || new Date()) : null;

  if (tg.kind === 'tax') {
    await CollectionInvoice.updateOne({ _id: tg.doc._id }, { $set: { collectedAmount: r2(collected), payments } });
    if (full || tg.full) {
      // Statements under the invoice follow it, as in full collection from the start.
      await OperationsWorkflow.updateMany({ invoiceNumber: tg.key, ...NOT_CANCELLED },
        { $set: { collectionDate: when, collectedByWallet: false, lastModifiedBy: user._id } });
      await syncInvoiceLedger(tg.key, { collectionDate: when });
    }
  } else if (tg.kind === 'cashLedger') {
    // A ledger row with no statement: the state is written on it alone, in its own wording ('Collected').
    const $set = { collectedAmount: r2(collected), payments };
    if (full) Object.assign($set, { collectionDate: when, status: 'Collected' });
    else if (tg.full) Object.assign($set, { collectionDate: null, status: '' });
    await CollectionInvoice.updateOne({ _id: tg.doc._id }, { $set });
  } else {
    const $set = {
      collectedAmount: r2(collected), collectionPayments: payments,
      collectedByWallet: false, lastModifiedBy: user._id,
    };
    if (full) $set.collectionDate = when;
    else if (tg.full) { $set.collectionDate = null; $set.cashCollectionStatus = ''; }
    await OperationsWorkflow.updateOne({ _id: tg.doc._id }, { $set });
    await syncCashLedger({ _id: tg.doc._id }, { collectionDate: full ? when : null });
  }
  return {
    full,
    state: full ? 'full' : (collected > 0 ? 'partial' : 'none'),
    collected: r2(collected),
    remaining: full ? 0 : r2(Math.max(0, tg.value - collected)),
  };
}

/**
 * Full or partial collection: `mode: 'full' | 'partial'`.
 * partial: an amount above zero and below the remainder; added as a payment and the state stays partial.
 * full:    the whole remainder as a final payment, completing it. If already complete it edits its date, not a second payment. A cash statement of unknown value completes with what the collector wrote (as before).
 * A request without `mode` is the old request (an un-updated app) and proceeds as before.
 */
async function recordPayment(req, res) {
  const mode = req.body.mode === 'partial' ? 'partial' : 'full';
  const { collectionDate } = req.body;
  const note = String(req.body.note || '').trim();
  if (!collectionDate) {
    return res.status(400).json({ message: 'حقول مطلوبة ناقصة: تاريخ التحصيل', fields: { collectionDate: 'مطلوب' } });
  }
  const date = new Date(collectionDate);
  if (Number.isNaN(date.getTime())) return res.status(400).json({ message: 'تاريخ التحصيل غير صالح', fields: { collectionDate: 'غير صالح' } });

  const tg = await loadTarget(req.body);
  const remaining = r2(tg.value - tg.collected);
  const payments = tg.payments.map((p) => (p.toObject ? p.toObject() : p));
  const entry = (amount, m) => ({
    _id: new mongoose.Types.ObjectId(), amount: r2(amount), date, by: req.user._id, byName: userName(req.user), note, mode: m, at: new Date(),
  });

  let result;
  let amount = 0;
  if (mode === 'partial') {
    if (tg.full) return res.status(400).json({ message: `${tg.label} محصَّلةٌ بالكامل — لا دفعةَ جزئيّةَ بعد الاكتمال` });
    if (!(tg.value > 0)) {
      return res.status(400).json({ message: 'لا قيمةَ مسجَّلةً لهذا أمر النقل — سجّل التحصيلَ كاملًا بالمبلغ المقبوض', fields: { amount: 'لا قيمة' } });
    }
    amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'اكتب المبلغ المحصَّل رقمًا أكبرَ من صفر', fields: { amount: 'أكبر من صفر' } });
    }
    amount = r2(amount);
    if (amount >= remaining - EPS) {
      return res.status(400).json({
        message: `المبلغ الجزئيّ يجب أن يكون أقلَّ من الباقي (${remaining.toLocaleString('en-US')}) — ولتحصيل الباقي كلِّه اختر «تحصيل بالكامل»`,
        fields: { amount: 'أقل من الباقي' }, remaining,
      });
    }
    payments.push(entry(amount, 'partial'));
    result = await settleTarget(tg, { collected: r2(tg.collected + amount), payments, user: req.user });
  } else if (tg.full) {
    // Already complete: only the collection day is edited; the remainder is not received twice.
    result = await settleTarget(tg, { collected: tg.collected, payments, user: req.user, forceFull: true, date });
  } else if (tg.value > 0) {
    amount = Math.max(0, remaining);
    if (amount > 0) payments.push(entry(amount, 'full'));
    result = await settleTarget(tg, { collected: r2(tg.collected + amount), payments, user: req.user, forceFull: true, date });
  } else {
    // Cash with no known value (or an invoice with zero or negative value): completes with what was written.
    amount = Number(req.body.amount ?? req.body.collectedAmount);
    if (tg.kind === 'cash' && !(Number.isFinite(amount) && amount > 0)) {
      return res.status(400).json({ message: 'مبلغ التحصيل مطلوب — لا قيمةَ مسجَّلةً لهذا أمر النقل', fields: { amount: 'مطلوب' } });
    }
    amount = Number.isFinite(amount) && amount > 0 ? r2(amount) : 0;
    if (amount > 0) payments.push(entry(amount, 'full'));
    result = await settleTarget(tg, { collected: r2(tg.collected + amount), payments, user: req.user, forceFull: true, date });
  }

  afterCollectionWrite();
  const details = mode === 'partial'
    ? `تحصيلٌ جزئيّ على ${tg.label}: ${amount} من ${tg.value} — الباقي ${result.remaining}`
    : `تحصيلٌ كامل على ${tg.label}${amount ? `: ${amount}` : ''}`;
  await logAudit({
    user: req.user._id, action: mode === 'partial' ? 'record_partial_collection' : 'record_collection',
    entity: tg.kind === 'cash' ? 'OperationsWorkflow' : 'CollectionInvoice', entityId: tg.doc._id,
    entityKey: tg.kind === 'cash' ? tg.doc.reportNumber : tg.key,
    changes: {
      details,
      before: { collected: tg.collected, full: tg.full },
      after: { mode, amount, collectionDate, note, collected: result.collected, state: result.state },
    },
    ipAddress: req.ip,
  });
  return res.json({
    ...result,
    message: mode === 'partial'
      ? `سُجِّلت دفعةٌ جزئيّة ${amount.toLocaleString('en-US')} على ${tg.label} — الباقي ${result.remaining.toLocaleString('en-US')}`
      : `سُجِّل تحصيلُ ${tg.label} بالكامل`,
  });
}

/**
 * Edit or remove a payment: PUT /invoices/payments   POST /invoices/payments/remove
 * { invoiceNumber | id, paymentId, amount?, date?, note?, reason? }
 * A payment can be recorded wrongly like any collection: an excess amount, another day, a returned cheque. It is corrected alone without removing the others, and the state recomputed: below the value it returns to partial, reaching it completes. Its door is the 'not collected' door.
 */
async function changePayment(req, res, remove) {
  const tg = await loadTarget(req.body);
  const pid = String(req.body.paymentId || '');
  const payments = tg.payments.map((p) => (p.toObject ? p.toObject() : p));
  const idx = payments.findIndex((p) => String(p._id) === pid);
  if (idx < 0) return res.status(404).json({ message: 'الدفعة غير موجودة — ربّما رُفعت من شاشةٍ أخرى' });
  const before = { ...payments[idx] };
  const reason = String(req.body.reason || '').trim();
  let collected = tg.collected;

  if (remove) {
    payments.splice(idx, 1);
    collected = r2(collected - (Number(before.amount) || 0));
  } else {
    const p = payments[idx];
    if (req.body.amount !== undefined) {
      const a = Number(req.body.amount);
      if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ message: 'اكتب المبلغ رقمًا أكبرَ من صفر', fields: { amount: 'أكبر من صفر' } });
      collected = r2(collected - (Number(p.amount) || 0) + a);
      // More than the value is not received: the excess is a typing error, not a collection.
      if (tg.value > 0 && collected > tg.value + EPS) {
        return res.status(400).json({ message: `المجموع بعد التعديل (${collected.toLocaleString('en-US')}) يتجاوز القيمة (${tg.value.toLocaleString('en-US')})`, fields: { amount: 'يتجاوز القيمة' } });
      }
      p.amount = r2(a);
    }
    if (req.body.date) {
      const d = new Date(req.body.date);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'التاريخ غير صالح', fields: { date: 'غير صالح' } });
      p.date = d;
    }
    if (req.body.note !== undefined) p.note = String(req.body.note || '').trim();
  }
  if (collected < 0) collected = 0;

  // Complete with no known value stays complete while it holds a received amount.
  const keepFull = tg.full && !(tg.value > 0) && collected > 0;
  const result = await settleTarget(tg, { collected, payments, user: req.user, forceFull: keepFull });
  afterCollectionWrite();
  await logAudit({
    user: req.user._id, action: remove ? 'remove_collection_payment' : 'update_collection_payment',
    entity: tg.kind === 'cash' ? 'OperationsWorkflow' : 'CollectionInvoice', entityId: tg.doc._id,
    entityKey: tg.kind === 'cash' ? tg.doc.reportNumber : tg.key,
    changes: {
      details: `${remove ? 'رفعُ' : 'تعديلُ'} دفعةٍ على ${tg.label}${reason ? ` — ${reason}` : ''}`,
      before: { payment: before, collected: tg.collected, full: tg.full },
      after: { payment: remove ? null : payments[idx], collected: result.collected, state: result.state, reason },
    },
    ipAddress: req.ip,
  });
  return res.json({ ...result, message: remove ? `رُفعت الدفعة عن ${tg.label}` : `عُدِّلت الدفعة على ${tg.label}` });
}

exports.updatePayment = async (req, res) => {
  try { await changePayment(req, res, false); } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    sendMongooseError(res, e, 'تعذّر تعديل الدفعة');
  }
};
exports.removePayment = async (req, res) => {
  try { await changePayment(req, res, true); } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    sendMongooseError(res, e, 'تعذّر رفع الدفعة');
  }
};

/**
 * POST /invoices/collect-bulk { items: [{ id } | { invoiceNumber }], collectionDate, note }
 * Collects each selected row in full through the same path as one row, so the
 * ledger, the workflow and the audit log stay identical. A row that cannot be
 * collected is reported by name and does not stop the rest.
 */
exports.bulkCollect = async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 300) : [];
  const { collectionDate, note } = req.body || {};
  if (!items.length) return res.status(400).json({ message: 'حدِّد فاتورةً أو أمر نقل' });
  if (!collectionDate) return res.status(400).json({ message: 'تاريخ التحصيل مطلوب', fields: { collectionDate: 'مطلوب' } });
  let done = 0; const failed = [];
  for (const item of items) {
    const label = item.label || item.invoiceNumber || item.id;
    const reply = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const body = { id: item.id, invoiceNumber: item.invoiceNumber, mode: 'full', collectionDate, note: note || '' };
    try {
      await recordPayment({ body, user: req.user, ip: req.ip }, reply);
      if (reply.code < 400) done += 1; else failed.push({ label, message: reply.body?.message || 'تعذّر التحصيل' });
    } catch (e) { failed.push({ label, message: e.message || 'تعذّر التحصيل' }); }
  }
  const message = failed.length ? `حُصِّل ${done} وتعذّر ${failed.length}` : `سُجِّل تحصيل ${done} بالكامل`;
  res.json({ done, failed, message });
};

exports.recordCollection = async (req, res) => {
  if (req.body && (req.body.mode === 'full' || req.body.mode === 'partial')) {
    try { return await recordPayment(req, res); } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      return sendMongooseError(res, e, 'تعذّر تسجيل التحصيل');
    }
  }
  try {
    const { collectionDate, collectedAmount } = req.body;
    if (!collectionDate) {
      return res.status(400).json({ message: 'حقول مطلوبة ناقصة: تاريخ التحصيل', fields: { collectionDate: 'مطلوب' } });
    }

    const invoiceNumber = String(req.body.invoiceNumber || '').trim();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!invoiceNumber && !ids.length) {
      return res.status(400).json({ message: 'حدِّد فاتورةً أو أوامر نقل' });
    }

    const filter = invoiceNumber
      ? { invoiceNumber, ...NOT_CANCELLED }
      : { _id: { $in: ids } };

    // `collectedByWallet: false`: the collection is now the department's and the wallet no longer touches it.
    const $set = { collectionDate: new Date(collectionDate), collectedByWallet: false, lastModifiedBy: req.user._id };
    // Amount for cash: a tax invoice's value is written in it, while cash is received by the collector, who writes what they received.
    if (collectedAmount !== undefined && collectedAmount !== '') $set.collectedAmount = Number(collectedAmount) || 0;

    const r = await OperationsWorkflow.updateMany(filter, { $set });
    // The other ledger moves with it; see syncInvoiceLedger.
    await syncInvoiceLedger(invoiceNumber, { collectionDate: $set.collectionDate });
    if (!invoiceNumber) await syncCashLedger(filter, { collectionDate: $set.collectionDate });
    cache.clear('wf:');
    cache.clear(CACHE_PREFIX); cache.clear('cdr:');
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}

    await logAudit({
      user: req.user._id, action: 'record_collection', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null,
      entityKey: invoiceNumber || undefined,
      changes: { after: { collectionDate, collectedAmount, count: r.modifiedCount } },
      ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, collection: true }); } catch (_) {}

    res.json({
      updated: r.modifiedCount || 0,
      message: invoiceNumber
        ? `سُجِّل التحصيل على ${r.modifiedCount} أمر نقل تحت الفاتورة ${invoiceNumber}`
        : `سُجِّل التحصيل على ${r.modifiedCount} أمر نقل`,
    });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تسجيل التحصيل'); }
};

/**
 * 'Not collected': POST /invoices/uncollect   { invoiceNumber | ids, reason }
 * Collection is sometimes recorded on what was not received: a returned cheque, a promise recorded as receipt, or a tap on the wrong row. It could not be corrected from the collection screen, leaving the invoice 'collected', out of aging and claims, with its money still with the customer.
 * So collection is removed: date and amount from the statements (what the operations workflow page reads) and the state in the collection ledger, both together as they are recorded together. The reason is optional and is recorded if written, with what had been recorded.
 */
exports.undoCollection = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    let invoiceNumber = String(req.body.invoiceNumber || '').trim();
    let ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    if (!invoiceNumber && !ids.length) return res.status(400).json({ message: 'حدِّد فاتورةً أو أوامر نقل' });
    const CollectionInvoice = require('../models/CollectionInvoice');

    // A cash invoice by number (see loadTarget). If its statement is ours, the statement's collection is reversed and the ledger follows; with no statement, the collection is removed from the ledger row itself.
    if (invoiceNumber && !(await CollectionInvoice.exists({ kind: 'tax', invoiceNumber }))) {
      const cash = await CollectionInvoice.findOne({ kind: 'cash', invoiceNumber, unused: { $ne: true } }).lean();
      if (cash) {
        const sheet = await OperationsWorkflow.findOne({ reportNumber: invoiceNumber, paymentType: 'cash', ...NOT_CANCELLED }).select('_id').lean();
        if (sheet) { ids = [String(sheet._id)]; invoiceNumber = ''; } else {
          const was = cash.collectionDate || Number(cash.collectedAmount) > 0 || CollectionInvoice.isCollected(cash);
          if (!was) return res.status(400).json({ message: 'ليست مسجَّلةً محصَّلةً أصلًا — لا شيءَ يُرجَع عنه' });
          await CollectionInvoice.updateOne({ _id: cash._id }, { $set: { collectedAmount: 0, payments: [], collectionDate: null, status: '' } });
          afterCollectionWrite();
          await logAudit({
            user: req.user._id, action: 'undo_collection', entity: 'CollectionInvoice', entityId: cash._id, entityKey: invoiceNumber,
            changes: {
              details: `رجوعٌ عن تحصيل الفاتورة النقديّة ${invoiceNumber}${reason ? ` — ${reason}` : ''}`,
              ledgerBefore: { status: cash.status, collectionDate: cash.collectionDate, collectedAmount: cash.collectedAmount, payments: cash.payments || [] },
              reason,
            },
            ipAddress: req.ip,
          });
          return res.json({ updated: 1, message: `رُفع التحصيلُ عن الفاتورة ${invoiceNumber} — عادت غيرَ محصَّلة` });
        }
      }
    }
    const filter = invoiceNumber ? { invoiceNumber, ...NOT_CANCELLED } : { _id: { $in: ids } };

    const before = await OperationsWorkflow.find(filter).select('reportNumber collectionDate collectedAmount collectionPayments').lean();
    const ledgerBefore = invoiceNumber
      ? await CollectionInvoice.findOne({ invoiceNumber, kind: 'tax' }).select('status collectionDate collectedAmount payments').lean() : null;
    const wasCollected = before.some((w) => w.collectionDate || Number(w.collectedAmount) > 0)
      || (ledgerBefore && (ledgerBefore.collectionDate || Number(ledgerBefore.collectedAmount) > 0
        || /collected/i.test(String(ledgerBefore.status || ''))));
    if (!wasCollected) return res.status(400).json({ message: 'ليست مسجَّلةً محصَّلةً أصلًا — لا شيءَ يُرجَع عنه' });

    // All payments go with it: 'not collected' means nothing received, not a leftover partial. `cashCollectionStatus` too: the imported cash ledger says 'collected' with no date, and keeping it would leave the statement collected after 'not collected' (cashIsCollected).
    const r = await OperationsWorkflow.updateMany(filter, { $set: { collectionDate: null, collectedAmount: 0, collectionPayments: [], collectedByWallet: false, cashCollectionStatus: '', lastModifiedBy: req.user._id } });
    if (invoiceNumber) await CollectionInvoice.updateOne({ invoiceNumber, kind: 'tax' }, { $set: { collectedAmount: 0, payments: [] } });
    await syncInvoiceLedger(invoiceNumber, { collectionDate: null });
    if (!invoiceNumber) await syncCashLedger(filter, { collectionDate: null });
    cache.clear('wf:');
    cache.clear(CACHE_PREFIX); cache.clear('cdr:');
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}

    await logAudit({
      user: req.user._id, action: 'undo_collection', entity: 'OperationsWorkflow',
      entityId: ids.length === 1 ? ids[0] : null, entityKey: invoiceNumber || undefined,
      changes: {
        details: `رجوعٌ عن تحصيل ${invoiceNumber ? `الفاتورة ${invoiceNumber}` : `${before.length} أمر نقل`} — ${reason}`,
        before: before.map((w) => ({ reportNumber: w.reportNumber, collectionDate: w.collectionDate, collectedAmount: w.collectedAmount, payments: w.collectionPayments || [] })),
        ledgerBefore, reason,
      },
      ipAddress: req.ip,
    });
    try { emitToAll('workflow:updated', { bulk: true, collection: true }); } catch (_) {}

    res.json({
      updated: r.modifiedCount || 0,
      message: invoiceNumber
        ? `رُفع التحصيلُ عن الفاتورة ${invoiceNumber} — عادت غيرَ محصَّلة`
        : `رُفع التحصيلُ عن ${r.modifiedCount} أمر نقل — عادت غيرَ محصَّلة`,
    });
  } catch (e) { sendMongooseError(res, e, 'تعذّر الرجوع عن التحصيل'); }
};

/** Filter values of both invoice pages, built from the data itself. */
exports.invoiceFilterOptions = async (req, res) => {
  try {
    const kind = req.query.kind === 'cash' ? 'cash' : 'tax';
    const base = kind === 'cash'
      ? { paymentType: 'cash', ...NOT_CANCELLED }
      : { ...REAL_INVOICE, paymentType: 'tax', ...NOT_CANCELLED };
    // The customer list follows the page's source. The tax page is now read from the invoice ledger, which holds 8,000 invoices for owners with no statement here. A list built from statement names shows 6% of the page's customers, so the user searches for a customer seen in the table and cannot find them in the filter.
    const CollectionInvoice = require('../models/CollectionInvoice');
    const [customers, branches] = await Promise.all([
      kind === 'cash'
        ? OperationsWorkflow.distinct('username', { ...base, username: { $nin: [null, ''] } })
        : CollectionInvoice.distinct('partyName', { partyName: { $nin: [null, ''] } }),
      OperationsWorkflow.distinct('payingBranch', { ...base, payingBranch: { $nin: [null, ''] } }),
    ]);
    res.json({ customers: customers.sort().slice(0, 2000), branches: branches.sort() });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل الفلاتر', error: e.message });
  }
};

exports.AGE_BANDS = AGE_BANDS;
exports.STATEMENT_ROW_CAP = STATEMENT_ROW_CAP;
exports.NO_INVOICE_TOKENS = NO_INVOICE_TOKENS;

/**
 * Edit a tax invoice value: PUT /invoices/tax/:invoiceNumber/amount { total, reason? }
 * The ledger holds the invoice total as it came from the collection sheet or its statements. The value is corrected here (for example a negative settlement) and then locked on what was written (`totalLocked`): the statement sum no longer recomputes it. The edit is recorded with both values and its writer.
 */
/** Who corrects an invoice value: only this list decides (`authorize.strict` on the route), with no section grant or page permission. Mirrored in the UI as `AMOUNT_EDIT_ROLES` in frontend/src/lib/collections.ts and in the app as `collectionsAmountEditRoles`. */
exports.AMOUNT_EDIT_ROLES = ['super_admin', 'admin', 'it_manager', 'it_specialist', 'collections_manager', 'cfo', 'accounting_manager'];

exports.updateTaxInvoiceAmount = async (req, res) => {
  try {
    const CollectionInvoice = require('../models/CollectionInvoice');
    const no = String(req.params.invoiceNumber || '').trim();
    const total = Number(req.body.total);
    if (!no) return res.status(400).json({ message: 'رقم الفاتورة مطلوب' });
    if (!Number.isFinite(total)) return res.status(400).json({ message: 'اكتب القيمة رقمًا (ويجوز بالسالب)' });
    const inv = await CollectionInvoice.findOne({ kind: 'tax', invoiceNumber: no });
    if (!inv) return res.status(404).json({ message: 'لا فاتورة بهذا الرقم' });
    const before = inv.total;
    inv.total = Math.round(total * 100) / 100;
    inv.totalLocked = true;
    await inv.save();
    await logAudit({
      user: req.user._id, action: 'update_tax_invoice_amount', entity: 'CollectionInvoice', entityId: inv._id, entityKey: no,
      changes: { before: { total: before }, after: { total: inv.total, reason: String(req.body.reason || '').trim() } }, ipAddress: req.ip,
    });
    cache.clear(CACHE_PREFIX); cache.clear('cdr:');
    try { require('./collectionsLedgerController').invalidate(); } catch (_) { /* */ }
    try { emitToAll('workflow:updated', { bulk: true, ledger: true }); } catch (_) { /* */ }
    res.json({ invoiceNumber: no, total: inv.total, before });
  } catch (e) { sendMongooseError(res, e, 'تعذّر تعديل القيمة'); }
};

/**
 * Account statement for what is on the invoices screen: `GET /invoices/:kind/statement`.
 * Takes the screen's query as is (with local column filters `lf_*`, selection `sel` and visible columns `cols`) and produces a PDF on company letterhead. GET on purpose: whoever has 'view' on the section issues the statement, and sectionGate blocks non-GET for view-only holders. `?format=json` returns the document and verification numbers instead of the file.
 */
exports.invoiceStatement = async (req, res) => {
  try {
    const kind = req.params.kind === 'cash' ? 'cash' : req.params.kind === 'tax' ? 'tax' : null;
    if (!kind) return res.status(404).json({ message: 'Unknown invoice kind' });
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const { buildInvoiceStatement } = require('../services/invoiceStatement');
    const { doc, check } = await buildInvoiceStatement(kind, req.query, req.user, lang);
    if (req.query.format === 'json') return res.json({ ...doc, check });
    const { renderReportPdf } = require('../services/reportBuilder');
    const pdf = await renderReportPdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${kind}-invoices-${Date.now()}.pdf"`);
    res.send(pdf);
  } catch (e) {
    if (e.status && e.status >= 400 && e.status < 500) return res.status(e.status).json({ message: e.message });
    console.error('invoice statement error:', e);
    res.status(500).json({ message: 'تعذّر إصدار كشف الحساب', error: e.message });
  }
};
