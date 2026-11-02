/**
 * Payment types: a per-customer attribute from which each statement's type is derived.
 * Most customers have a fixed attribute (cash customers always pay cash, tax customers are always invoiced), so it is written once on the customer and read per statement instead of on tens of thousands of statements.
 * Only the operations platform marking a specific load as cash overrides it (see utils/paymentType).
 */
const CollectionsParty = require('../models/CollectionsParty');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const {
  derivePaymentTypeFor, ISSUED_INVOICE_QUERY, ISSUED_INVOICE_EXPR, subtypeAfterAuto, TAX_SUBTYPE,
} = require('../utils/paymentType');
const logAudit = require('../utils/auditLogger');
const cache = require('../utils/ttlCache');
const { flexSpaceRegex } = require('../utils/plateKey');

const { fold } = CollectionsParty;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** GET /api/workflows/payment-types: customers, their types and statement counts. */
exports.list = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || '');
    const filter = { kind: 'customer' };
    if (q) filter.$or = [{ name: flexSpaceRegex(q) }, { code: flexSpaceRegex(q) }];
    if (type === 'cash' || type === 'tax') filter.paymentType = type;
    else if (type === 'none') filter.$and = [...(filter.$and || []), { $or: [{ paymentType: null }, { paymentType: '' }] }];

    const parties = await CollectionsParty.find(filter)
      .select('name nameKey code paymentType collectionOfficer department').sort({ name: 1 }).lean();

    // Statement counts are computed once for all customers; a query per customer would be ~700 database round trips per open.
    const counts = await OperationsWorkflow.aggregate([
      { $match: { username: { $nin: [null, ''] } } },
      { $group: {
        _id: '$username',
        reports: { $sum: 1 },
        cash: { $sum: { $cond: [{ $eq: ['$paymentType', 'cash'] }, 1, 0] } },
        tax: { $sum: { $cond: [{ $eq: ['$paymentType', 'tax'] }, 1, 0] } },
        manual: { $sum: { $cond: [{ $eq: ['$paymentTypeSource', 'manual'] }, 1, 0] } },
        // Statements untouched by unify are counted separately. A manual choice is never overwritten, so counting it as a mismatch would show a number to fix that never moves.
        cashAuto: { $sum: { $cond: [{ $and: [{ $eq: ['$paymentType', 'cash'] }, { $ne: ['$paymentTypeSource', 'manual'] }] }, 1, 0] } },
        taxAuto: { $sum: { $cond: [{ $and: [{ $eq: ['$paymentType', 'tax'] }, { $ne: ['$paymentTypeSource', 'manual'] }] }, 1, 0] } },
        // A statement with a tax invoice issued is not a mismatch for a cash customer: unify skips it and sync would flip it back to tax. Counting it would show a number that returns after every unify.
        taxAutoNoInvoice: { $sum: { $cond: [{ $and: [
          { $eq: ['$paymentType', 'tax'] }, { $ne: ['$paymentTypeSource', 'manual'] },
          { $not: [ISSUED_INVOICE_EXPR] },
        ] }, 1, 0] } },
        methodCash: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$paymentMethod', ''] }, regex: /^cash$/i } }, 1, 0] } },
        value: { $sum: { $ifNull: ['$sellingValue', 0] } },
      } },
    ]);
    const byKey = new Map();
    for (const c of counts) {
      const k = fold(c._id || '');
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, c);
      else {
        prev.reports += c.reports; prev.cash += c.cash; prev.tax += c.tax;
        prev.manual += c.manual; prev.methodCash += c.methodCash; prev.value += c.value;
        prev.cashAuto += c.cashAuto; prev.taxAuto += c.taxAuto; prev.taxAutoNoInvoice += c.taxAutoNoInvoice;
      }
    }

    const rows = parties.map((p) => {
      const c = byKey.get(p.nameKey || fold(p.name))
        || { reports: 0, cash: 0, tax: 0, manual: 0, methodCash: 0, value: 0, cashAuto: 0, taxAuto: 0, taxAutoNoInvoice: 0 };
      // Mismatch means a statement whose type differs from its customer's attribute.
      // Measured against the customer attribute only, not the derivation rule: the payment-method-is-cash rule fills blanks where there is no evidence but must not override existing evidence (the type written from the follow-up sheet's tax / non-tax column is explicit for that load).
      const conflicts = p.paymentType === 'cash' ? c.taxAutoNoInvoice : (p.paymentType === 'tax' ? c.cashAuto : 0);
      return {
        _id: p._id, name: p.name, code: p.code || '',
        paymentType: p.paymentType || '',
        officer: p.collectionOfficer || '', department: p.department || '',
        reports: c.reports, cashReports: c.cash, taxReports: c.tax,
        manualReports: c.manual, methodCashReports: c.methodCash,
        conflicts,
        value: r2(c.value),
      };
    });

    const totals = {
      customers: rows.length,
      cash: rows.filter((r) => r.paymentType === 'cash').length,
      tax: rows.filter((r) => r.paymentType === 'tax').length,
      none: rows.filter((r) => !r.paymentType).length,
      reports: rows.reduce((a, b) => a + b.reports, 0),
      conflictCustomers: rows.filter((r) => r.conflicts > 0).length,
      conflictReports: rows.reduce((a, b) => a + b.conflicts, 0),
    };
    res.json({ rows, totals });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تحميل أنواع الدفع', error: e.message });
  }
};

/**
 * PUT /api/workflows/payment-types/:id: write a customer's attribute and apply it to its statements.
 * Statements whose type was chosen manually are untouched: that is a per-load decision, this is a general attribute (see paymentTypeSource).
 */
exports.update = async (req, res) => {
  try {
    const type = String(req.body.paymentType || '');
    if (!['', 'cash', 'tax'].includes(type)) {
      return res.status(400).json({ message: 'نوعُ الدفع إمّا «cash» أو «tax» أو فارغ' });
    }
    const party = await CollectionsParty.findById(req.params.id);
    if (!party) return res.status(404).json({ message: 'العميل غير موجود' });

    const before = party.paymentType || '';
    party.paymentType = type;
    await party.save();

    // Then apply to its statements
    const applied = await applyToCustomer(party, { onlyEmpty: req.body.onlyEmpty !== false });

    logAudit({
      user: req.user, action: 'set_customer_payment_type', entity: 'CollectionsParty', entityId: party._id,
      changes: { before: { paymentType: before }, after: { paymentType: type }, reportsChanged: applied.changed },
      ipAddress: req.ip,
    }).catch(() => {});
    cache.clear('wf:'); cache.clear('wfparty:');
    cache.clear('colledger:'); cache.clear('collections-dept:'); cache.clear('cdr:');
    // Statement types changed: wallet collection follows (before broadcasting, see utils/walletCollection).
    await require('../utils/walletCollection').resyncAllWalletCollections({ user: req.user, reason: 'تغيّر نوع الدفع' })
      .catch((e) => console.error('wallet cash-collection (payment types):', e.message));
    try { require('../websocket/socketManager').emitToAll('workflow:updated', { bulk: true, paymentType: true }); } catch (_) {}
    try { require('../websocket/socketManager').emitToAll('collections:changed', { source: 'payment-types' }); } catch (_) {}

    res.json({ party: { _id: party._id, name: party.name, paymentType: party.paymentType }, ...applied });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر حفظ نوع الدفع', error: e.message });
  }
};

/**
 * Apply the customer's attribute to its statements.
 * `onlyEmpty` is the default: fill statements with no type, never change typed ones. Reclassifying a customer's whole history must be requested explicitly, because flipping old statements changes where they are invoiced and collected.
 */
async function applyToCustomer(party, { onlyEmpty = true } = {}) {
  const key = party.nameKey || fold(party.name || '');
  if (!key) return { changed: 0, skippedManual: 0 };

  // Raw names that fold to this customer's key.
  const names = await OperationsWorkflow.distinct('username', { username: { $nin: [null, ''] } });
  const mine = names.filter((n) => fold(n) === key);
  if (!mine.length) return { changed: 0, skippedManual: 0 };

  const rows = await OperationsWorkflow.find({ username: { $in: mine } })
    .select('paymentType paymentSubtype paymentTypeSource paymentMethod invoiceNumber tax netInvoice').lean();

  const ops = []; let skippedManual = 0; let remaining = 0;
  for (const w of rows) {
    if (String(w.paymentTypeSource || '') === 'manual') { skippedManual += 1; continue; }
    const next = derivePaymentTypeFor(w, party.paymentType);
    if (next === (w.paymentType || '')) continue;
    // Typed statements are counted but not changed unless requested: flipping an existing type changes where it is invoiced and collected. Only blanks are filled, and the remaining difference count is reported so conversion is a visible decision.
    if (onlyEmpty && w.paymentType) { remaining += 1; continue; }
    // The type follows the moved family, see subtypeAfterAuto.
    ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { paymentType: next, paymentSubtype: subtypeAfterAuto(w.paymentType, next, w.paymentSubtype), paymentTypeSource: 'auto' } } } });
  }
  let changed = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    changed += r.modifiedCount || 0;
  }
  return { changed, skippedManual, remaining, reports: rows.length };
}

/** Filter for the customer's statements that unify flips; used by the unify button and the reapplyPaymentTypeUnify script. `null` when the customer has no statements. */
async function unifyFilter(party) {
  const type = String(party.paymentType || '');
  const key = party.nameKey || fold(party.name || '');
  const names = await OperationsWorkflow.distinct('username', { username: { $nin: [null, ''] } });
  const mine = names.filter((n) => fold(n) === key);
  if (!mine.length) return null;
  return {
    username: { $in: mine },
    paymentType: { $nin: ['', null, type] },
    paymentTypeSource: { $ne: 'manual' },
    // Statements with a tax invoice issued are not touched. The confirm dialog promises this; previously invoiced statements were flipped to cash and the next sync saw the invoice and restored them to tax.
    ...(type === 'cash' ? { $nor: [ISSUED_INVOICE_QUERY] } : {}),
  };
}

/**
 * POST /api/workflows/payment-types/:id/unify: unify a customer's statements to its attribute.
 * Separate from blank-filling: a written type is existing evidence from the follow-up sheet, so overriding it is an explicit per-customer decision.
 * Measured on the customer attribute only: the cash payment-method rule would flip thousands of large tax customers' statements; platform payment_method is only cash or late (payment terms, not invoice type).
 * Manually chosen types are untouched too.
 */
exports.unifyCustomer = async (req, res) => {
  try {
    const party = await CollectionsParty.findById(req.params.id).select('name nameKey paymentType').lean();
    if (!party) return res.status(404).json({ message: 'العميل غير موجود' });
    const type = String(party.paymentType || '');
    if (!['cash', 'tax'].includes(type)) {
      return res.status(400).json({ message: 'لا صفةَ لهذا العميل — اختر «كاش» أو «ضريبي» أوّلًا' });
    }

    const filter = await unifyFilter(party);
    if (!filter) return res.json({ changed: 0, skippedManual: 0 });
    const preview = req.body?.preview === true;
    const willChange = await OperationsWorkflow.countDocuments(filter);
    if (preview) return res.json({ preview: true, willChange, type });

    const r = await OperationsWorkflow.updateMany(filter, {
      // `unified`, not `auto`: sync re-derives every `auto` row each cycle, which erased unify within a minute (see isUnified).
      // The filter only matches statements that change family: to tax they get the credit-invoice type (the only tax type); to cash they get no type, and a person picks one of the three.
      $set: {
        paymentType: type, paymentSubtype: type === 'tax' ? TAX_SUBTYPE : '',
        paymentTypeSource: 'unified', lastModifiedBy: req.user._id,
      },
    });
    const changed = r.modifiedCount || 0;

    logAudit({
      user: req.user, action: 'unify_customer_payment_type', entity: 'CollectionsParty', entityId: party._id,
      entityKey: party.name, changes: { after: { paymentType: type, changed } }, ipAddress: req.ip,
    }).catch(() => {});
    cache.clear('wf:'); cache.clear('wfparty:'); cache.clear('colledger:');
    // The collections dashboard splits by type, so its cache is cleared before broadcasting.
    cache.clear('collections-dept:'); cache.clear('cdr:');
    // Statement types changed: wallet collection follows (before broadcasting, see utils/walletCollection).
    await require('../utils/walletCollection').resyncAllWalletCollections({ user: req.user, reason: 'تغيّر نوع الدفع' })
      .catch((e) => console.error('wallet cash-collection (payment types):', e.message));
    try { require('../websocket/socketManager').emitToAll('workflow:updated', { bulk: true, paymentType: true }); } catch (_) {}
    try { require('../websocket/socketManager').emitToAll('collections:changed', { source: 'payment-types' }); } catch (_) {}

    res.json({ changed, type, message: `وُحِّد ${changed} أمر نقل على «${type === 'cash' ? 'كاش' : 'ضريبي'}»` });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر توحيد كشوف العميل', error: e.message });
  }
};

/**
 * POST /api/workflows/payment-types/apply: run the rule over everyone.
 * The effect is shown first (`preview: true`): flipping types changes where statements are invoiced and collected, so thousands are not changed in one click without seeing the count.
 */
exports.applyAll = async (req, res) => {
  try {
    const onlyEmpty = req.body.onlyEmpty !== false;
    const preview = req.body.preview === true;

    const parties = await CollectionsParty.find({ kind: 'customer' }).select('name nameKey paymentType').lean();
    const typeByKey = new Map();
    for (const p of parties) {
      const k = p.nameKey || fold(p.name || '');
      if (k) typeByKey.set(k, p.paymentType || '');
    }

    const rows = await OperationsWorkflow.find({})
      .select('username paymentType paymentSubtype paymentTypeSource paymentMethod invoiceNumber tax netInvoice').lean();

    const ops = []; let skippedManual = 0; let skippedUnified = 0; let unknown = 0;
    const moves = {};
    for (const w of rows) {
      if (String(w.paymentTypeSource || '') === 'manual') { skippedManual += 1; continue; }
      // A statement unified to its customer's attribute is a decision about that customer; a general pass does not erase it.
      if (!onlyEmpty && String(w.paymentTypeSource || '') === 'unified' && w.paymentType) { skippedUnified += 1; continue; }
      const t = typeByKey.get(fold(w.username || ''));
      if (t === undefined) { unknown += 1; continue; }
      if (onlyEmpty && w.paymentType) continue;
      const next = derivePaymentTypeFor(w, t);
      const cur = w.paymentType || '';
      if (next === cur) continue;
      moves[`${cur || 'فارغ'} → ${next || 'فارغ'}`] = (moves[`${cur || 'فارغ'} → ${next || 'فارغ'}`] || 0) + 1;
      ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { paymentType: next, paymentSubtype: subtypeAfterAuto(cur, next, w.paymentSubtype), paymentTypeSource: 'auto' } } } });
    }

    if (preview) return res.json({ preview: true, wouldChange: ops.length, skippedManual, skippedUnified, unknown, moves });

    let changed = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const r = await OperationsWorkflow.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      changed += r.modifiedCount || 0;
    }
    logAudit({
      user: req.user, action: 'apply_payment_types', entity: 'OperationsWorkflow',
      changes: { after: { changed, onlyEmpty, moves } }, ipAddress: req.ip,
    }).catch(() => {});
    cache.clear('wf:'); cache.clear('wfparty:'); cache.clear('colledger:');
    // The collections dashboard splits by type, so its cache is cleared before broadcasting.
    cache.clear('collections-dept:'); cache.clear('cdr:');
    // Statement types changed: wallet collection follows (before broadcasting, see utils/walletCollection).
    await require('../utils/walletCollection').resyncAllWalletCollections({ user: req.user, reason: 'تغيّر نوع الدفع' })
      .catch((e) => console.error('wallet cash-collection (payment types):', e.message));
    try { require('../websocket/socketManager').emitToAll('workflow:updated', { bulk: true, paymentType: true }); } catch (_) {}
    try { require('../websocket/socketManager').emitToAll('collections:changed', { source: 'payment-types' }); } catch (_) {}
    res.json({ changed, skippedManual, skippedUnified, unknown, moves });
  } catch (e) {
    res.status(500).json({ message: 'تعذّر تطبيق أنواع الدفع', error: e.message });
  }
};

exports.applyToCustomer = applyToCustomer;
exports.unifyFilter = unifyFilter;
