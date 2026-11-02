/**
 * Payment type, and when a manifest reaches collections.
 * Sources in priority order: 1) chosen by hand on the manifest, never changed after; 2) invoice number, which means tax (writing it issues the invoice); 3) platform payment method `cash`, which makes it cash even for a tax customer; 4) customer attribute from the payment types page.
 * 2 is above 3 because platform `payment_method` (`cash`/`late`) is payment terms, not an invoice type: many `cash` manifests carry tax and were collected with invoices.
 * Applies to new manifests only (`AUTO_RULE_FROM`); earlier ones keep their classification.
 */

/** First of the month the new rule started; earlier ones stay as they are. */
const AUTO_RULE_FROM = new Date('2026-09-01T00:00:00.000Z');

/** Does this manifest fall under the new rule? */
const underNewRule = (workflow = {}) => {
  const d = workflow.reportDate ? new Date(workflow.reportDate) : null;
  return !!d && !Number.isNaN(d.getTime()) && d >= AUTO_RULE_FROM;
};

/** Does the platform say this load is cash? */
const methodIsCash = (paymentMethod) => /^\s*cash\s*$/i.test(String(paymentMethod || ''));

/**
 * Tax requires an invoice number. Cash may have net invoice and VAT computed but no invoice number; tax must have one.
 * So the only evidence a manifest was tax-invoiced is a real invoice number. Net and tax used to count as evidence too, but the cash path writes net itself (`deriveCashTotals` copies the payment amount to net and gross), so every cash manifest with a payment amount flipped to tax on the first sync: 368 manifests with net equal to payment amount, zero tax and no number, all tax.
 */
// Not an invoice number: 'no inv', the Arabic 'none' and similar are typed by people in the sheet (1,640 'no inv' rows today), and '0' was written by the old cash lock. The list matches what collections reads (a wider copy existed; see collectionsDeptController.NO_INVOICE_TOKENS), so a value is not an invoice here and not there.
const NO_INVOICE_TOKENS = [
  '0', 'no inv', 'no invoice', 'noinv', 'no-inv', 'none', 'n/a', 'na', '-', '—', 'ىى',
  'بدون', 'بدون فاتورة', 'لا يوجد', 'لا توجد', 'غير مفوتر', 'غير مفوترة',
];
const tokenAlt = NO_INVOICE_TOKENS
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*'))
  .join('|');
/** Text that is never an invoice number (excluding empty). */
const NO_INVOICE_RX = new RegExp(`^\\s*(?:${tokenAlt})\\s*$`, 'i');
// Empty, whitespace and placeholders: not an invoice number.
const NOT_AN_INVOICE_RX = new RegExp(`^\\s*(?:${tokenAlt})?\\s*$`, 'i');

/** Does this manifest have a real invoice number? The only evidence of tax. */
const hasTaxInvoice = (w = {}) => !NOT_AN_INVOICE_RX.test(String(w.invoiceNumber == null ? '' : w.invoiceNumber));
// The name written by the unification; it is now the same condition.
const hasIssuedInvoice = hasTaxInvoice;
/** The same condition as a query (for `find`/`updateMany`). */
const ISSUED_INVOICE_QUERY = { invoiceNumber: { $ne: null, $not: NOT_AN_INVOICE_RX } };
/** The same condition as an expression (for `$group`, `$cond` and update pipelines). */
const ISSUED_INVOICE_EXPR = {
  $not: [{ $regexMatch: { input: { $toString: { $ifNull: ['$invoiceNumber', ''] } }, regex: NOT_AN_INVOICE_RX } }],
};

/**
 * Who decides a manifest's type, and whose decision is not overridden.
 * - `manual`: chosen by hand on this manifest; nothing touches it.
 * - `unified`: unified on the customer attribute; beats derivation but not a tax invoice issued later (`hasIssuedInvoice`).
 * - `auto`: derived and re-derived on every sync. Unification used to write `auto`, so the next sync reverted it.
 */
const isUnified = (w) => String(w?.paymentTypeSource || '') === 'unified';

/**
 * Auto-derived type for a specific manifest.
 * @param {object} workflow      the manifest; `paymentMethod` and invoice evidence are read from it
 * @param {string} customerType  customer attribute: 'cash' | 'tax' | ''
 * @returns {'cash'|'tax'|''}     '' means unknown, so nothing is written
 */
const derivePaymentTypeFor = (workflow = {}, customerType) => {
  if (hasTaxInvoice(workflow)) return 'tax';
  // Payment method overrides the customer attribute for new manifests only (see AUTO_RULE_FROM).
  if (underNewRule(workflow) && methodIsCash(workflow.paymentMethod)) return 'cash';
  const t = String(customerType || '').trim().toLowerCase();
  return t === 'cash' || t === 'tax' ? t : '';
};

/** Legacy two-argument form, so existing calls keep working. */
const derivePaymentType = (paymentMethod, customerType) =>
  derivePaymentTypeFor({ paymentMethod }, customerType);

/**
 * Highest source deciding this manifest; shown on screen to explain the type.
 * 'manual' | 'invoice' | 'customer' | ''
 */
const paymentTypeReason = (workflow = {}, customerType) => {
  if (String(workflow.paymentTypeSource || '') === 'manual') return 'manual';
  if (isUnified(workflow)) return hasIssuedInvoice(workflow) ? 'invoice' : 'customer';
  if (hasTaxInvoice(workflow)) return 'invoice';
  const t = String(customerType || '').trim().toLowerCase();
  return t === 'cash' || t === 'tax' ? 'customer' : '';
};

/** Is this manifest changed automatically? No, if the type was set by hand. */
const mayAutoSet = (workflow) => String(workflow?.paymentTypeSource || '') !== 'manual';

/**
 * Has the manifest reached collections, and if not, why not.
 * Two doors only: an invoice number sends it to tax invoices at once; operations review with a cash type and a payment date sends it to cash invoices at once (a tax type waits for its number even if reviewed).
 * Applies to new-rule manifests only: the review column is empty on earlier ones, so requiring it would empty the screen.
 */
/**
 * Operations review is the door, not accounting review.
 * Rule: cash + payment date + operations review sends to cash invoices at once. The condition was first written on `accountingReview` by mistake, which is empty on every manifest since September, so no new cash reached the screen except what the wallet collected. The door is `operationsReview`, and accounting review stays as a harmless second door. It is one condition here, read by the screen, its dashboard and its filters.
 */
const isReviewed = (w = {}) => !!String(w.operationsReview || '').trim() || !!String(w.accountingReview || '').trim();
const REVIEWED_MATCH = { $or: [{ operationsReview: { $nin: ['', null] } }, { accountingReview: { $nin: ['', null] } }] };
const reachesCollections = (workflow = {}) => {
  if (hasTaxInvoice(workflow)) return { ok: true, screen: 'tax' };
  const type = String(workflow.paymentType || '');
  if (type !== 'cash') {
    return { ok: false, reason: 'awaiting_invoice', ar: 'بانتظار رقم الفاتورة' };
  }
  if (!workflow.paymentDate) return { ok: false, reason: 'no_payment_date', ar: 'بلا تاريخ سداد' };
  if (underNewRule(workflow) && !isReviewed(workflow)) {
    return { ok: false, reason: 'awaiting_review', ar: 'بانتظار مراجعة التشغيل' };
  }
  return { ok: true, screen: 'cash' };
};


/**
 * The four new payment types: deferred and cash.
 * The payment-type column offers four choices replacing tax and cash: the deferred-with-invoice type replaces tax, and the other three replace cash.
 * A second field rather than new `paymentType` values: many rules test `paymentType === 'cash'` or `'tax'` (invoice-number lock, both collections pages, wallet collection, derivation, unification, cards), so `paymentType` stays the family ('cash' | 'tax') and `paymentSubtype` is the chosen type. Choosing a type writes both, so every existing rule keeps working and applies to the new type through its family.
 * Existing manifests are not reclassified: the old tax and cash values still display and filter until someone changes them, but are no longer offered as choices.
 */
const PAYMENT_SUBTYPES = {
  deferred_cash: { family: 'cash', ar: 'آجل - كاش', en: 'Deferred – cash' },
  deferred_invoice: { family: 'tax', ar: 'آجل - فاتورة', en: 'Deferred – invoice' },
  cash_3pl: { family: 'cash', ar: 'نقدي - 3PL', en: 'Cash – 3PL' },
  cash_ht: { family: 'cash', ar: 'نقدي - HT', en: 'Cash – HT' },
};
const SUBTYPE_KEYS = Object.keys(PAYMENT_SUBTYPES);
/** The only tax type; every automatic transition to tax goes to it. */
const TAX_SUBTYPE = 'deferred_invoice';
const isSubtype = (k) => Object.prototype.hasOwnProperty.call(PAYMENT_SUBTYPES, String(k || ''));
/** Type family: 'cash' | 'tax' | '' */
const subtypeFamily = (k) => (isSubtype(k) ? PAYMENT_SUBTYPES[k].family : '');

/** The six names as read in the column. */
const PAYMENT_KIND_AR = {
  tax: 'ضريبي', cash: 'كاش',
  ...Object.fromEntries(SUBTYPE_KEYS.map((k) => [k, PAYMENT_SUBTYPES[k].ar])),
};

/** What the column shows: the type if present, otherwise the family. */
const paymentKindOf = (w = {}) => (isSubtype(w.paymentSubtype) ? w.paymentSubtype : String(w.paymentType || ''));
const paymentKindLabel = (w = {}) => PAYMENT_KIND_AR[paymentKindOf(w)] || '';

/** The same as an expression (for `$group` in the column's value list). */
const PAYMENT_KIND_EXPR = {
  $cond: [
    { $in: [{ $ifNull: ['$paymentSubtype', ''] }, SUBTYPE_KEYS] },
    '$paymentSubtype',
    { $ifNull: ['$paymentType', ''] },
  ],
};

/**
 * Column filter condition over the six values (and empty).
 * The old tax/cash values mean those still without a new type, not the whole family: the column shows six values and the filter returns what the cell shows.
 */
function paymentKindCondition(values = []) {
  const BLANK_SUB = { paymentSubtype: { $in: ['', null] } };
  const or = [];
  for (const raw of values) {
    const v = String(raw == null ? '' : raw).trim();
    if (isSubtype(v)) or.push({ paymentSubtype: v });
    else if (v === 'cash' || v === 'tax') or.push({ $and: [{ paymentType: v }, BLANK_SUB] });
    else if (v === '') or.push({ paymentType: { $in: ['', null] } });
  }
  if (!or.length) return { _id: { $exists: false } };
  return or.length === 1 ? or[0] : { $or: or };
}

/**
 * Type after an automatic family transition (derivation, invoice number, sync, unification).
 * - Transition to tax gives the deferred-with-invoice type, the only tax type today. A manifest already tax stays as is, so the 37,000 existing tax rows are not rewritten.
 * - Transition to cash gives plain cash with no type: there are three cash types, so a person chooses. A tax type that no longer fits its family is cleared.
 * A hand choice never goes through here; derivation does not touch a manual manifest.
 */
function subtypeAfterAuto(prevType, nextType, subtype) {
  const prev = String(prevType || ''); const next = String(nextType || '');
  if (next === 'tax') {
    if (prev !== 'tax') return TAX_SUBTYPE;
    return subtypeFamily(subtype) === 'tax' ? subtype : '';
  }
  if (next === 'cash') return subtypeFamily(subtype) === 'cash' ? subtype : '';
  return '';
}

/** The same as an expression for an update pipeline (sync). */
const subtypeAfterAutoExpr = (prevExpr, nextExpr, subExpr) => {
  const famOf = (e) => ({
    $switch: {
      branches: SUBTYPE_KEYS.map((k) => ({ case: { $eq: [e, k] }, then: PAYMENT_SUBTYPES[k].family })),
      default: '',
    },
  });
  return {
    $switch: {
      branches: [
        {
          case: { $eq: [nextExpr, 'tax'] },
          then: { $cond: [{ $ne: [prevExpr, 'tax'] }, TAX_SUBTYPE, { $cond: [{ $eq: [famOf(subExpr), 'tax'] }, subExpr, ''] }] },
        },
        { case: { $eq: [nextExpr, 'cash'] }, then: { $cond: [{ $eq: [famOf(subExpr), 'cash'] }, subExpr, ''] } },
      ],
      default: '',
    },
  };
};

/**
 * Normalises a payment-type choice in an incoming update, before any other rule.
 * One of the four types writes the type and its family together; `paymentSubtype` alone makes its family follow.
 * A hand-set old tax/cash value clears the type; a derived one (`__derivedPaymentType`) uses `subtypeAfterAuto`.
 * Returns `true` if the update touched the type or its family.
 */
function normalizePaymentChoice(patch, current = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  if (!has('paymentType') && !has('paymentSubtype')) return false;
  const sub = has('paymentSubtype') ? String(patch.paymentSubtype || '').trim() : null;
  if (has('paymentType')) {
    const v = String(patch.paymentType || '').trim();
    if (isSubtype(v)) {
      patch.paymentSubtype = v;
      patch.paymentType = subtypeFamily(v);
    } else if (patch.__derivedPaymentType) {
      patch.paymentSubtype = subtypeAfterAuto(current.paymentType, v, current.paymentSubtype);
    } else if (sub && isSubtype(sub)) {
      patch.paymentSubtype = sub;
      patch.paymentType = subtypeFamily(sub);
    } else {
      patch.paymentSubtype = '';
    }
  } else if (isSubtype(sub)) {
    patch.paymentSubtype = sub;
    patch.paymentType = subtypeFamily(sub);
  } else {
    // Empty or unknown type: the type is cleared and the family stays.
    patch.paymentSubtype = '';
  }
  return true;
}

module.exports = {
  isReviewed, REVIEWED_MATCH,
  NO_INVOICE_TOKENS, NO_INVOICE_RX, NOT_AN_INVOICE_RX,
  hasIssuedInvoice, ISSUED_INVOICE_QUERY, ISSUED_INVOICE_EXPR, isUnified,
  derivePaymentType, derivePaymentTypeFor, paymentTypeReason,
  hasTaxInvoice, methodIsCash, mayAutoSet,
  AUTO_RULE_FROM, underNewRule, reachesCollections,
  PAYMENT_SUBTYPES, SUBTYPE_KEYS, TAX_SUBTYPE, isSubtype, subtypeFamily, PAYMENT_KIND_AR,
  paymentKindOf, paymentKindLabel, PAYMENT_KIND_EXPR, paymentKindCondition,
  subtypeAfterAuto, subtypeAfterAutoExpr, normalizePaymentChoice,
};
