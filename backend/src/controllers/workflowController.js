const { isFinanceFull, FINANCE_FULL_ROLES } = require('../config/financeAuthority');
const mongoose = require('mongoose');
const OperationsWorkflow = require('../models/OperationsWorkflow');
const { startOfDay, endOfDay, DAY_MS: COMPANY_DAY_MS } = require('../utils/companyDay');
const { flexSpaceRegex } = require('../utils/plateKey');
const logAudit = require('../utils/auditLogger');
const { emitToAll, emitPerRole } = require('../websocket/socketManager');
const {
  derivePaymentTypeFor, hasTaxInvoice, TAX_SUBTYPE, subtypeFamily, NO_INVOICE_RX, isUnified, hasIssuedInvoice, ISSUED_INVOICE_QUERY,
  normalizePaymentChoice, paymentKindCondition, PAYMENT_KIND_EXPR, paymentKindLabel,
} = require('../utils/paymentType');
const XLSX = require('xlsx');
const { sellingByRequest, canApproveSelling } = require('../config/sellingPriceRequests');
// Lazy: the service requires this controller back.
const sellingRequests = () => require('../services/sellingPriceRequests');
const fs = require('fs');
const path = require('path');
const cache = require('../utils/ttlCache');

// Field-level permission groups
const FIELD_GROUPS = {
  application: [
    'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
    'carOwner', 'carNumber', 'ownerType', 'executionStatus',
    'applicationStatus', 'paymentMethod', 'username', 'taxIndicator',
    'purchaseValue',
    'loadingTime', 'driverRentalType', 'reference', 'userPhone',
    'driverName', 'driverPhone', 'carName', 'plateNumber',
    'truckType', 'truckSize', 'loadType', 'quantity',
    'goodsValue', 'representativeName', 'country',
    'ownerName', 'ownerPhone', 'region', 'product', 'invoiceRef',
    'driverCost', 'loadNumber', 'volume',
  ],
  operations: [
    'operationsReview',
  ],
  manual_moderator: [
    // paymentSubtype follows paymentType wherever it was: choosing the type chooses its detail.
    'paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'paymentSubtype',
    'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate', 'deliveryDate',
  ],
  // Accounts review is its own group. It used to sit inside manual_moderator, so everyone recording a payment inherited it. It is the accounting acknowledgment that the row was reviewed, not a step of recording payment; leaving it there made whoever enters the receipt number sign off their own review.
  accounting: [
    'accountingReview',
  ],
  collections: [
    'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
    'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
  ],
  // Selling value is its own group. It used to be among the application columns, visible to anyone opening the page. It is our price to the customer, visible and writable by operations manager, sales, management, finance and collections (per the company owner), not operations staff. It is written to the platform too.
  selling: ['sellingValue'],
};

// Which roles can edit which field groups
// The map used old role names; after roles were rebuilt as manager and staff per section, operations_staff had no line and got an empty array, so every field was dropped and the save returned 200 doing nothing.
// Operations owns payment, receipt, dispatch and delivery, so its manager and staff get them. Invoice columns are company money owned by accounting and collections, not operations.
// They stay writable on the server only where listed; hiding them on screen alone would look guarded but be half a block.
const OPS_FIELDS = [
  ...FIELD_GROUPS.application, ...FIELD_GROUPS.operations,
  ...FIELD_GROUPS.manual_moderator,
];
// Money columns: invoice, collection and accounting review.
const MONEY_FIELDS = [...FIELD_GROUPS.collections, ...FIELD_GROUPS.accounting];
// From the net invoice onward: seen (and written) only by finance, collections and top roles.
// Invoice number and accounting review stay visible to every workflow reader.
const AMOUNT_FIELDS = ['netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate'];
const MONEY_VIEW_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant', 'collections_manager', 'collections_staff',
];
// The whole sheet, for roles with no restriction (except selling value, which has its own list below).
const ALL_FIELDS = [...OPS_FIELDS, ...MONEY_FIELDS];
const SELLING_FIELDS = FIELD_GROUPS.selling;
// The whole sheet including selling value.
const FULL_FIELDS = [...ALL_FIELDS, ...SELLING_FIELDS];

// Who sees and writes selling value. The list is named roles as given by the company owner: super admin, management, finance manager, accounts manager, collections manager and team, accountant, operations manager, and the general manager if a role (general_manager) is created. Sales was removed; IT came back with super admin powers (2026-11-05).
// A role outside the list never receives the value from the server (stripRowFor), cannot filter by it, does not get it in its export, and cannot write it.
const SELLING_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist', 'cfo', 'accounting_manager', 'accountant',
  'collections_manager', 'collections_staff', 'operations_manager', 'general_manager',
  // Data team; super admin narrows the operations section from the matrix.
  ...require('../config/roles').DATA_ROLES,
];

const ROLE_FIELD_ACCESS = {
  super_admin: FULL_FIELDS,
  // Data team: all fields, and the section's 'view' in the matrix blocks writing before it.
  ...Object.fromEntries(require('../config/roles').DATA_ROLES.map((r) => [r, FULL_FIELDS])),
  moderator: [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator],
  operations_manager: [...OPS_FIELDS, ...SELLING_FIELDS],
  operations_staff: OPS_FIELDS,
  // Senior management sits above accounting, not below it.
  admin: FULL_FIELDS,
  // Sales owns selling value only. It opens the workflow to price the report, writes nothing else and sees no invoice columns.
  employee: FIELD_GROUPS.collections,
  // Accounting records payment as it records the invoice. It owned only the invoice group, so an accountant writing the payment date and saving got 403 and nothing saved, though it is daily work.
  // This repeats the operations-staff mistake: a per-role list forgets what the role does every day. So it is no longer just a list: the screen reads the same map and shows no field that will not be saved.
  cfo: FULL_FIELDS,
  accounting_manager: FULL_FIELDS,
  accountant: FULL_FIELDS,
  // Collections writes the whole sheet. Money columns alone are not enough: chasing an invoice also means correcting the customer name, receipt number, paying branch and final destination, all outside MONEY_FIELDS. Otherwise staff keep asking operations to fix a field they can see, or get 'saved' with nothing saved.
  collections_manager: FULL_FIELDS,
  collections_staff: FULL_FIELDS,
  // IT has super admin powers (owner, 2026-11-05), selling value included.
  it_manager: FULL_FIELDS,
  it_specialist: FULL_FIELDS,
};
// Purchase price is for those who see selling price only (company owner): whoever is not in SELLING_ROLES cannot write purchaseValue (can see it, cannot edit). Applies to this map and to fields of created roles (fieldsForRole), and the screen reads the same map.
const PURCHASE_FIELDS = ['purchaseValue'];
for (const [r, f] of Object.entries(ROLE_FIELD_ACCESS)) {
  if (!SELLING_ROLES.includes(r)) ROLE_FIELD_ACCESS[r] = f.filter((x) => !PURCHASE_FIELDS.includes(x));
}
// Invoice amounts are written only by the roles that may see them.
for (const [r, f] of Object.entries(ROLE_FIELD_ACCESS)) {
  if (!MONEY_VIEW_ROLES.includes(r)) ROLE_FIELD_ACCESS[r] = ROLE_FIELD_ACCESS[r].filter((x) => !AMOUNT_FIELDS.includes(x));
}
// The map and the list state the same thing; checked at load so they cannot diverge.
for (const [r, f] of Object.entries(ROLE_FIELD_ACCESS)) {
  if (PURCHASE_FIELDS.some((x) => f.includes(x)) && !SELLING_ROLES.includes(r)) {
    throw new Error(`[workflow] سعرُ الشراء: ${r} يكتبه وليس في SELLING_ROLES`);
  }
  if (AMOUNT_FIELDS.some((x) => f.includes(x)) && !MONEY_VIEW_ROLES.includes(r)) {
    throw new Error(`[workflow] invoice amounts: ${r} writes them but is not in MONEY_VIEW_ROLES`);
  }
  if (f.includes('sellingValue') !== SELLING_ROLES.includes(r)) {
    throw new Error(`[workflow] قيمةُ البيع: ${r} في الخريطة غيرُه في SELLING_ROLES`);
  }
}

/**
 * Hiding is on both ends. Hiding a column in the table does not hide it: the endpoint returns the whole document, readable in browser tools and exported to Excel. Hiding in one place is half a block and reads worse than none, since viewers assume it is blocked.
 * A role without the money columns never receives them: not in the list, details or export. The same rule filters saving, one map.
 */
/**
 * Fields for a created role come from the permission matrix. ROLE_FIELD_ACCESS is keyed by roles in code; a role created from the screen is not in it and got zero fields: the operations section opens and the matrix grants edit, yet the workflow has no writable cell and no error, so the screen looks broken (it happened with operation_team).
 * Who writes was read from two places, with no bridge: the matrix opens the section and this map decides the cells. The bridge: a created role gets, in every section where it has edit, the fields of that section's own staff role. Nothing more: view gives no writable cell and what is not granted is not inherited.
 */
const SECTION_FIELD_SOURCE = {
  Operations: 'operations_staff',
  Collections: 'collections_staff',
  Accounting: 'accountant',
};
const FIELDS_TTL = 60 * 1000;
const fieldsCache = require('../utils/ttlCache');

// Every data and follow-up user moves a shipment's status here, whatever their branch.
// The fleet team moves the status of the loads they run.
const STATUS_ROLES = [...require('../config/roles').DATA_ROLES, 'shipment_orders_followup', 'fleet_manager', 'fleet_supervisor'];
const fieldsForRole = async (role) => {
  const fields = await baseFieldsForRole(role);
  return STATUS_ROLES.includes(role) && !fields.includes('applicationStatus') ? [...fields, 'applicationStatus'] : fields;
};
const baseFieldsForRole = async (role) => {
  if (ROLE_FIELD_ACCESS[role]) return ROLE_FIELD_ACCESS[role];
  return fieldsCache.wrap(`wf:fields:${role}`, FIELDS_TTL, async () => {
    try {
      const { effectivePermissions, isCustomRole } = require('../utils/permissions');
      if (!(await require('../utils/permissions').inheritsNothing(role))) return [];
      const sections = await effectivePermissions(role);
      const out = new Set();
      for (const [section, source] of Object.entries(SECTION_FIELD_SOURCE)) {
        if (sections[section] === 'edit') for (const f of ROLE_FIELD_ACCESS[source] || []) out.add(f);
      }
      // Selling value is not inherited: its list is named roles (SELLING_ROLES) and a created role is not in it, so it does not write it.
      for (const f of SELLING_FIELDS) out.delete(f);
      // Purchase price follows: only whoever sees selling price writes it (PURCHASE_FIELDS).
      for (const f of PURCHASE_FIELDS) out.delete(f);
      for (const f of AMOUNT_FIELDS) out.delete(f);
      return [...out];
    } catch (e) {
      // If access cannot be read, nothing is opened: no fields until the answer is known.
      console.error('[workflow] fieldsForRole:', e.message);
      return [];
    }
  });
};

/** May this role see invoice amounts (net invoice onward)? A named list, like SELLING_ROLES. */
const canSeeMoney = (role) => MONEY_VIEW_ROLES.includes(role);

/** Removes money columns from a document (or array of them) for roles without them. */
const stripMoney = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const f of AMOUNT_FIELDS) delete plain[f];
  return plain;
};
const stripMoneyFor = (role, docs) => {
  if (canSeeMoney(role)) return docs;
  return Array.isArray(docs) ? docs.map(stripMoney) : stripMoney(docs);
};

/** Whether this role sees selling value; the list is named roles (SELLING_ROLES). */
const canSeeSelling = (role) => SELLING_ROLES.includes(role);
const stripSelling = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete plain.sellingValue;
  delete plain.sellingValueSource;
  return plain;
};
/** The row as this role receives it: without money columns for roles without them, and without selling value for roles outside its list. (stripMoneyFor stays as it is: the private page reads it, where selling value is a different price.) */
const stripRowFor = (role, docs) => {
  const out = stripMoneyFor(role, docs);
  if (canSeeSelling(role)) return out;
  return Array.isArray(out) ? out.map(stripSelling) : stripSelling(out);
};

/** Billing rules, enforced on the server and not only on the screen. The screen helps users do the right thing; the server guarantees it, since a rule in the UI alone can be bypassed by bulk update, import or a direct call. */

// Columns the cash lock used to zero (the lock was removed). They were zeroed and locked on every cash report; that is gone (see deriveCashTotals), and a cash report takes what it needs like any other.
// The list remains for one job: old reports still carry lock zeros and blanks, and when one leaves cash those auto-set values are cleared, but not what a person wrote. See the wasCash branch below.
const CASH_LOCKED_FIELDS = [
  'finalReportDestination', 'documentNumber', 'sendingDate',
  // The two deliveries together: in cash, no report is delivered to a branch and no invoice to a customer.
  'branchDeliveryDate', 'deliveryDate',
  'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice', 'invoiceDate',
];
// What is written as zero and what is left empty: a number can be zero, a date cannot.
const CASH_ZERO_NUMERIC = new Set(['netInvoice', 'tax', 'totalInvoice']);
const VAT_RATE = 0.15;

/**
 * Values fixed on a cash report. Text is emptied, not set to '0': the lock used to write '0' into text fields too, giving cash reports an invoice number named '0'. Everything reading the invoice number believed it: the tax invoices page grouped reports on it into an 'invoice 0' mixing cash and tax reports of different customers, and the has-invoice test flipped the report to tax.
 * A numeric zero stays: 'invoice net is zero' is valid, while 'invoice number zero' is an empty field disguised as a value.
 */
function cashLockedValues() {
  const out = {};
  for (const f of CASH_LOCKED_FIELDS) out[f] = CASH_ZERO_NUMERIC.has(f) ? 0 : (f.endsWith('Date') ? null : '');
  return out;
}

/** Tax and total are derived from invoice net, not written. The accountant used to type all three and an error in one left the total not equal to its parts, found only at account matching a month later. Fixed formula: tax is 15 percent of net and total is their sum. */
/**
 * Cash is invoiced at what was paid, with no tax and no invoice number. Cash reports used to have columns zeroed and locked (no receipt, invoice, delivery or date), meant to prevent meaningless writes; staff instead found nine locked zero columns they could not fix, yet they need them: when the paper was delivered, when money was received and how much.
 * The lock is removed and a cash report is written like any other. One rule remains to save repeated work: what was paid is what is invoiced. Payment amount goes to invoice net and total together, tax is zero (no tax on cash), and the invoice number stays empty since there is no invoice.
 * What the employee typed in the same write is respected: the rule fills blanks and never overrides intent.
 */
function deriveCashTotals(patch, current) {
  const given = (f) => Object.prototype.hasOwnProperty.call(patch, f);
  const amount = Number(given('paymentAmount') ? patch.paymentAmount : current.paymentAmount) || 0;
  if (amount <= 0) return patch;

  // No tax on cash: written as an explicit zero, not left empty.
  if (!given('tax')) patch.tax = 0;
  if (!given('netInvoice')) patch.netInvoice = amount;
  if (!given('totalInvoice')) patch.totalInvoice = amount;
  return patch;
}

function deriveInvoiceTotals(patch, current) {
  const hasNet = Object.prototype.hasOwnProperty.call(patch, 'netInvoice');
  if (!hasNet) return patch;
  const net = Number(patch.netInvoice) || 0;
  const vat = Math.round(net * VAT_RATE * 100) / 100;
  patch.tax = vat;
  patch.totalInvoice = Math.round((net + vat) * 100) / 100;
  return patch;
}

/**
 * Payment type is written by hand and not inferred from the customer. It used to be read from the customer file and filled automatically, as if a fixed customer attribute; the same customer says 'pay me cash' on one load and 'open an invoice' on another, so it belongs to the shipment.
 * Inferring from the file writes on the sheet what nobody said and sends it to a collections page that is not its own, a silent error found only when a customer is billed an invoice agreed to be cash. History is kept since the type is written on the sheet itself.
 * (The function is deleted rather than disabled, so an uncalled function is not revived without reading why it was removed.)
 */

/** Applies payment type rules to an incoming edit. Returns the dropped fields by name, so rejections are reported rather than swallowed. */
/**
 * Fills payment type from the customer file before applying the rules. Also done here although sync does it: sync fills reports from the platform, but a report created by hand here, or an old one given a payment date today, never passes through it and would stay typeless and appear on no collections screen. Writing the payment date is the moment when 'where is the report' gets asked.
 * A written type is never replaced: only empty is filled, a hand choice is untouched.
 */
async function fillPaymentTypeFromCustomer(patch, current = {}, partyTypes = null) {
  if (Object.prototype.hasOwnProperty.call(patch, 'paymentType')) return null;
  // Choosing one of the four types is choosing the type; nothing is derived over it.
  if (Object.prototype.hasOwnProperty.call(patch, 'paymentSubtype')) return null;
  if (String(current.paymentTypeSource || '') === 'manual') return null;
  // A unified report keeps its customer's attribute and is not re-derived, unless a real tax invoice is being written for it now (see isUnified).
  if (isUnified(current)) {
    const merged = { ...current, ...patch };
    if (!hasIssuedInvoice(merged) || String(current.paymentType || '') === 'tax') return null;
    patch.paymentType = 'tax';
    patch.paymentTypeSource = 'unified';
    patch.__derivedPaymentType = true;
    return 'tax';
  }

  const name = patch.username !== undefined ? patch.username : current.username;
  if (!name) return null;
  try {
    const CollectionsParty = require('../models/CollectionsParty');
    const key = CollectionsParty.fold(name);
    if (!key) return null;
    // A large batch reads customers once, not per row. partyTypes (folded key to attribute) is loaded once in bulk update; otherwise 37,000 reports meant 37,000 database round trips.
    const party = partyTypes
      ? (partyTypes.has(key) ? { paymentType: partyTypes.get(key) } : null)
      : await CollectionsParty.findOne({ kind: 'customer', nameKey: key }).select('paymentType').lean();
    const merged = { ...current, ...patch };
    const next = derivePaymentTypeFor(merged, party?.paymentType);
    if (!next || next === String(current.paymentType || '')) return null;
    patch.paymentType = next;
    patch.paymentTypeSource = 'auto';
    // A flag marking this as derived and not a hand choice. applyBillingRules stamps every paymentType in an edit as manual, right for what staff write and wrong for what we derive: a manually stamped report is never touched by the payment types page, freezing it on a type nobody chose and counting it under 'manual choice'.
    patch.__derivedPaymentType = true;
    return next;
  } catch (_) { return null; }
}

/**
 * An invoice number written on a report creates its entry in the invoice ledger. The tax invoices screen reads the ledger (CollectionInvoice), not the reports, since the invoice is the unit and may span reports; a number written on a report has no ledger entry and never appears in collections, so it must arrive there immediately.
 * The entry is created at the first write and left alone afterwards: delivery, collection and status are collections work on the invoice itself and a report write must not overwrite them.
 */
async function ensureLedgerInvoice(workflow, previousNumber = '') {
  const numbers = [workflow && workflow.invoiceNumber, previousNumber];
  return syncOpsInvoices(numbers);
}

/**
 * An entry born from a report follows its reports. It used to be created once and never touched, causing two errors in collections: a number corrected on the report left the old entry as an invoice with no report, and a number written before its amounts stayed zero after the amounts were completed.
 * An entry with sheetCode 'workflow' is recomputed from its reports on every edit: amount is the sum of their totals, party is their customer, reports are their numbers. If no report remains and collections has not worked on it (no delivery or collection) it is removed. A company-ledger entry is touched only to fill a missing side. Delivery, collection and status after creation are collections work and untouched here.
 */
async function syncOpsInvoices(rawNumbers) {
  const CollectionInvoice = require('../models/CollectionInvoice');
  const numbers = [...new Set((rawNumbers || []).map((n) => String(n || '').trim())
    .filter((n) => n && !NO_INVOICE_RX.test(n)))];
  let touched = 0;
  for (const no of numbers) {
    try {
      const reports = await OperationsWorkflow.find({
        invoiceNumber: no,
        executionStatus: { $nin: ['ملغي', 'ملغى', 'ملغاة', 'cancelled', 'canceled', 'Cancelled'] },
      }).select('reportNumber username invoiceNumber invoiceDate netInvoice tax totalInvoice paymentType').lean();
      const taxReports = reports.filter((w) => w.paymentType !== 'cash' && hasTaxInvoice(w));
      // Tax only: a cash shipment number is a different sequence that may equal an invoice number.
      const existing = await CollectionInvoice.findOne({ invoiceNumber: no, kind: 'tax' });

      if (!taxReports.length) {
        if (existing && existing.sheetCode === 'workflow' && !existing.collectionDate && !existing.deliveryDate
          && !/collected|delivered/i.test(existing.status || '')) {
          await CollectionInvoice.deleteOne({ _id: existing._id });
          touched += 1;
        }
        continue;
      }

      const first = taxReports[0];
      let party = null;
      try {
        const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
        party = await ensureCollectionsParty(first.username, { paymentType: 'tax', source: 'operations_workflow' });
      } catch (_) { /* */ }
      const sum = (k) => Math.round(taxReports.reduce((a, w) => a + (Number(w[k]) || 0), 0) * 100) / 100;
      const dates = taxReports.map((w) => w.invoiceDate).filter(Boolean).map((d) => new Date(d).getTime());

      if (!existing) {
        await CollectionInvoice.create({
          invoiceNumber: no,
          kind: 'tax',
          party: party?._id || undefined,
          partyCode: party?.code || '',
          partyName: first.username || '',
          // The day its number was written if it has no date: not the payment date or the report date (see stampInvoiceDate).
          invoiceDate: dates.length ? new Date(Math.min(...dates)) : new Date(`${require('../utils/companyDay').todayKey()}T00:00:00.000Z`),
          total: sum('totalInvoice'),
          reportNumbers: taxReports.map((w) => String(w.reportNumber || '')).filter(Boolean),
          // The entry's source is recorded: an entry born from a report differs from one that came from the company ledger.
          sheetCode: 'workflow',
          source: 'operations_workflow',
          status: '',
        });
        touched += 1;
        continue;
      }

      const $set = {};
      if (!existing.party && party?._id) { $set.party = party._id; $set.partyCode = party.code || ''; }
      // A number reserved in the ledger becomes an invoice on reports. The collections ledger holds numbers reserved in the sequence (unused) that are neither shown nor counted. When such a number is written on tax reports it becomes a real invoice; it used to stay a hidden reserved zero (58 invoices never reached collections). It is opened and treated like one born from a report: amount, party and reports from them.
      const wasReserved = existing.unused === true;
      if (wasReserved) {
        $set.unused = false;
        if (existing.sheetCode !== 'workflow') {
          const clash = await CollectionInvoice.exists({ kind: 'tax', invoiceNumber: no, sheetCode: 'workflow' });
          if (!clash) $set.sheetCode = 'workflow';
        }
        $set.source = 'operations_workflow';
      }
      if (existing.sheetCode === 'workflow' || wasReserved) {
        if (!existing.totalLocked) $set.total = sum('totalInvoice');
        $set.partyName = first.username || existing.partyName;
        if (party?._id) { $set.party = party._id; $set.partyCode = party.code || ''; }
        $set.reportNumbers = taxReports.map((w) => String(w.reportNumber || '')).filter(Boolean);
        if (dates.length) $set.invoiceDate = new Date(Math.min(...dates));
      }
      if (Object.keys($set).length) {
        await CollectionInvoice.updateOne({ _id: existing._id }, { $set });
        touched += 1;
      }
    } catch (e) {
      console.error('[ledger] تعذّرت مزامنة الفاتورة', no, e.message);
    }
  }
  if (touched) {
    try { require('./collectionsLedgerController').invalidate(); } catch (_) {}
    try { cache.clear('collections-dept:'); cache.clear('cdr:'); } catch (_) {}
  }
  return touched;
}

// Fields whose change on a report changes its invoice entry.
const LEDGER_FIELDS = ['invoiceNumber', 'netInvoice', 'tax', 'totalInvoice', 'invoiceDate', 'paymentType', 'username', 'executionStatus'];

function applyBillingRules(patch, current = {}) {
  // A real invoice number means a credit-invoice type (company owner: anything tax became 'credit - invoice'). Tax is identified by its invoice number. An invoice file used to bring a number for a report marked cash-3PL or cash and be rejected ('change its type to tax first'), but the number is the change: writing it issues the invoice.
  // The report becomes credit-invoice and the number is accepted, from the file and from single and bulk edits, unless the edit itself picks a cash type by hand together with the number: a contradiction, rejected as before.
  if (Object.prototype.hasOwnProperty.call(patch, 'invoiceNumber') && hasTaxInvoice(patch)) {
    const hasType = Object.prototype.hasOwnProperty.call(patch, 'paymentType');
    const chosen = hasType ? String(patch.paymentType || '') : '';
    const handPickedCash = hasType && !patch.__derivedPaymentType
      && (chosen === 'cash' || subtypeFamily(chosen) === 'cash');
    const effective = hasType ? (subtypeFamily(chosen) || chosen) : current.paymentType;
    if (!handPickedCash && effective !== 'tax') {
      patch.paymentType = TAX_SUBTYPE;
      delete patch.__derivedPaymentType;   // An invoice number written by a person: a hand choice.
    }
  }

  // The chosen type writes its family first. 'Cash - 3PL' arrives as paymentType 'cash_3pl', so the type is cash_3pl and the family is cash, and all cash rules apply to the family as before. The automatic move to tax takes 'credit - invoice'. See utils/paymentType.
  normalizePaymentChoice(patch, current);
  const nextType = Object.prototype.hasOwnProperty.call(patch, 'paymentType')
    ? patch.paymentType
    : current.paymentType;

  // A hand choice is stamped as a hand choice. The payment types page derives the type from the customer attribute and runs over reports whenever it changes; without marking what staff chose on a specific report, the first run overwrites it. One customer is cash on one load and tax on the next, so the choice on the report is the most accurate. See utils/paymentType.
  if (Object.prototype.hasOwnProperty.call(patch, 'paymentType')) {
    // Except what we just derived (see fillPaymentTypeFromCustomer).
    if (!patch.__derivedPaymentType) patch.paymentTypeSource = 'manual';
  }
  delete patch.__derivedPaymentType;

  // Tax is not written, and tax-report total is not written. They are computed from net (deriveInvoiceTotals), so what a screen sends in them is dropped; in cash the total stays hand-written (company owner).
  if (!Object.prototype.hasOwnProperty.call(patch, 'netInvoice')) {
    delete patch.tax;
    if (nextType !== 'cash') delete patch.totalInvoice;
  }

  const blocked = [];
  if (nextType === 'cash') {
    // Cash has no invoice number. Decision of the company owner: cash gets a net and its tax is computed, but no invoice number, since the invoice number alone is the evidence of tax (see hasTaxInvoice). A real number written on a report that stays cash (type chosen by hand or unified, so derivation did not flip it) is rejected: change its type to tax first, or no number.
    if (Object.prototype.hasOwnProperty.call(patch, 'invoiceNumber') && hasTaxInvoice(patch)) {
      delete patch.invoiceNumber;
      blocked.push('invoiceNumber');
    }
    // If net is written by hand, tax and total are computed from it as for tax; if not written it is filled with what was paid (see deriveCashTotals).
    if (Object.prototype.hasOwnProperty.call(patch, 'netInvoice')) deriveInvoiceTotals(patch, current);
    deriveCashTotals(patch, current);
  } else {
    // Collection amount is for cash only. Tax is collected by its invoice and its net is the amount, so a second field with another amount would leave unknown which is right. Cash has no invoice, so its collection amount is entered by hand.
    if (Object.prototype.hasOwnProperty.call(patch, 'collectedAmount') && patch.collectedAmount) {
      delete patch.collectedAmount;
      blocked.push('collectedAmount');
    }
    // Leaving cash releases what the lock closed. The lock used to be one-way: choosing cash zeroed nine columns, and switching back left the zeros in open columns saying '0' with no real zero, so staff thought the report was invoiced at zero or cleared nine columns by hand.
    // Only what the lock itself set is cleared: each cell is compared to the lock value, so a lock zero returns to empty and what a person wrote stays.
    const wasCash = current.paymentType === 'cash';
    if (wasCash) {
      const locked = cashLockedValues();
      for (const f of CASH_LOCKED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, f)) continue;   // Written by the user now.
        const now = current[f];
        const placeholder = locked[f];
        const isPlaceholder = placeholder === null
          ? (now === null || now === undefined)
          : String(now ?? '') === String(placeholder);
        if (isPlaceholder) patch[f] = CASH_ZERO_NUMERIC.has(f) ? 0 : (f.endsWith('Date') ? null : '');
      }
    }
    deriveInvoiceTotals(patch, current);
  }
  return { patch, blocked };
}

// Filter update body to only include fields the role can edit
// Dropping is not silent. Dropping a field the requester does not own is right, but dropping it and then saying 'saved' is a lie, not a block. Rejected fields are returned by name so the caller decides: respond 403 naming them, or proceed.
const filterFieldsByRole = (body, role, resolvedFields) => {
  const allowedFields = resolvedFields || ROLE_FIELD_ACCESS[role] || [];
  const filtered = {}; const rejected = [];
  for (const key of Object.keys(body)) {
    if (allowedFields.includes(key)) filtered[key] = body[key];
    // Fields the server adds itself are not user input and are not counted as rejections.
    else if (!['lastModifiedBy', 'createdBy', 'stage', '_id', '__v'].includes(key)) rejected.push(key);
  }
  Object.defineProperty(filtered, '__rejected', { value: rejected, enumerable: false });
  return filtered;
};

// Lock expiry time: 5 minutes
const LOCK_EXPIRY_MS = 5 * 60 * 1000;

const isLocked = (workflow, userId) => {
  if (!workflow.lockedBy) return false;
  // Lock expired
  if (workflow.lockedAt && Date.now() - new Date(workflow.lockedAt).getTime() > LOCK_EXPIRY_MS) {
    return false;
  }
  // Locked by someone else
  return workflow.lockedBy.toString() !== userId.toString();
};

// Column filters: column values are computed in the database and filtering runs there.

/** Columns allowed for filtering. A deliberate whitelist: the column name goes straight into the $group key and the $in condition, so accepting any name from the browser would expose values of fields the table does not show, including money fields hidden from most roles. */
const FILTERABLE_COLUMNS = new Set([
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
  'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
  'username', 'userPhone', 'taxIndicator', 'purchaseValue', 'sellingValue',
  'driverName', 'truckType', 'truckSize', 'representativeName', 'operationsReview',
  'paymentDate', 'payingBranch', 'documentNumber', 'sendingDate',
  'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'collectionDate', 'stage',
  // Columns that were shown with a list but rejected by the server. Payment type, payment amount, final destination, collection amount and data owner were added to the table but not here, so opening their list returned 400 and showed empty with no message ('payment type filters nothing').
  'paymentAmount', 'paymentType', 'finalReportDestination', 'collectedAmount',
  // The raw field (shown as-is by the private page) and the column shown in the workflow: name, then the wallet recorder, then the import source. See utils/dataOwnerIndex.
  'paymentDateByName', 'dataOwnerShown',
  // Invoice number: present / empty / placeholder such as 'no inv'. A computed column, not a field: the filter bar asks which reports have an invoice, which the invoice-number filter itself cannot answer since its values are hundreds of numbers, not three states.
  'invoiceState',
  // Clearance: the linked transaction number, and empty means not linked. A computed column from customsLink.refNumber, answering which reports have a transaction and which reports belong to a given transaction with the same filter.
  'customsRef',
]);

// The three invoice-number states: one condition read by both the list and the filter.
const INVOICE_STATE_COND = {
  has: ISSUED_INVOICE_QUERY,
  none: { invoiceNumber: { $in: require('../utils/colFilter').BLANK_VALUES } },
  placeholder: { invoiceNumber: { $regex: NO_INVOICE_RX } },
};

// The value always arrives from the browser as text while the database field is a number or date. Comparing different BSON types never matches, so filtering on purchase value or payment date would silently return zero rows; each type is converted back before building the condition.
const NUMERIC_COLUMNS = new Set(['purchaseValue', 'sellingValue', 'netInvoice', 'tax', 'totalInvoice', 'paymentAmount', 'collectedAmount']);
const DATE_COLUMNS = new Set(['reportDate', 'paymentDate', 'sendingDate', 'branchDeliveryDate', 'deliveryDate', 'invoiceDate', 'collectionDate']);

/**
 * Date columns group by day, not by instant. The stored value is a second-precision instant but the cell shows only the day, so grouping by instant listed 28 identical-looking lines and raised distinct values to 23,000 in one column.
 * The timezone is fixed to Riyadh time because the company is entirely there: grouping in UTC pushes reports after 9 pm into the next day, which then does not match the day written in the cell.
 */
const TZ = 'Asia/Riyadh';
// TZ_OFFSET = '+03:00' used to be hand-written here; it now lives in utils/companyDay, where the zone is asked for its offset instead of assumed, and the whole system reads it.
const DAY_MS = 24 * 60 * 60 * 1000;
const isDayString = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Cap on the number of values returned in one column list. Columns such as report number and invoice number have a distinct value per row (tens of thousands) and sending them all brings back the freeze this solution removed. The most frequent are returned and the rest are found by searching within the list, executed on the server. */
const MAX_FILTER_VALUES = 500;

/** A pattern matching the value with any whitespace around or inside it; see utils/colFilter. */
const { textMatcher, BLANK_VALUES, normKey: colKey } = require('../utils/colFilter');

const decodeColumnValue = (field, v) => {
  if (NUMERIC_COLUMNS.has(field)) { const n = Number(v); return Number.isNaN(n) ? undefined : n; }
  if (DATE_COLUMNS.has(field)) { const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; }
  return v;
};

/**
 * Conditions from table column filters: cf_<column> repeated per selected value. Repetition rather than comma separation because values themselves contain commas (owner names, invoice notes) and splitting would cut a value in two and match no row.
 * skipField is used by the values list: a column's values are computed with all filters except its own, otherwise only the already chosen values would appear and widening the selection would be impossible.
 */
function columnFilters(query, skipField, allowMoney = true, allowSelling = true) {
  const conds = [];
  for (const key of Object.keys(query || {})) {
    if (!key.startsWith('cf_')) continue;
    const field = key.slice(3);
    if (!FILTERABLE_COLUMNS.has(field) || field === skipField) continue;
    // Filtering on a hidden column reveals it by inference ('show those whose invoice total is X' answers about a value not shown), so it is dropped for roles without it.
    if (AMOUNT_FIELDS.includes(field) && !allowMoney) continue;
    // Likewise selling value for roles outside its list.
    if (SELLING_FIELDS.includes(field) && !allowSelling) continue;
    const raw = Array.isArray(query[key]) ? query[key] : [query[key]];
    const vals = raw.map((v) => String(v == null ? '' : v));
    if (!vals.length) continue;
    // An empty cell is a real category users ask about ('reports not yet invoiced'), and in the database it has three forms: missing field, null and empty string. One selection must return all three, or rows appear to vanish.
    // Data owner is a column computed from three sources, not one field; see utils/dataOwnerIndex.
    if (field === 'dataOwnerShown') { conds.push(require('../utils/dataOwnerIndex').ownerCondition(vals)); continue; }
    // Payment type shows six values: the four types, and tax/cash for rows that remain without a type.
    if (field === 'paymentType') { conds.push(paymentKindCondition(vals)); continue; }
    if (field === 'invoiceState') {
      const cs = vals.map((v) => INVOICE_STATE_COND[v]).filter(Boolean);
      if (cs.length) conds.push(cs.length === 1 ? cs[0] : { $or: cs });
      continue;
    }
    if (field === 'customsRef') { conds.push(customsRefCondition(vals)); continue; }
    const wantsBlank = vals.some((v) => v === '');
    const rest = vals.filter((v) => v !== '');

    if (DATE_COLUMNS.has(field)) {
      // A day is a range, not an instant: $eq on midnight of the day does not match a report recorded at 3 pm that day, so it would vanish from a filter the user chose by name.
      const clauses = [];
      // A date outside what Mongo can write (year 57371 in the send date, an entry error) falls in the list under 'empty', so it is returned with it; otherwise the list counted it and the selection did not return it.
      if (wantsBlank) clauses.push({ [field]: { $in: ['', null] } }, { [field]: { $gte: new Date('9999-12-31T21:00:00.000Z') } });
      for (const v of rest) {
        if (isDayString(v)) {
          const start = startOfDay(v);
          if (!start) continue;
          clauses.push({ [field]: { $gte: start, $lt: new Date(start.getTime() + COMPANY_DAY_MS) } });
        } else {
          const exact = new Date(v);
          if (!isNaN(exact.getTime())) clauses.push({ [field]: exact });
        }
      }
      if (clauses.length) conds.push(clauses.length === 1 ? clauses[0] : { $or: clauses });
      continue;
    }

    // Text is matched ignoring surrounding spaces. Sync writes through an aggregation pipeline, so the schema trim does not run and values such as 'Dammam ' and '13  ' are stored as received beside trimmed forms in other rows, which the table shows as one.
    // Mongoose trims the value in the query too, so choosing 'Dammam ' from the list searched 'Dammam' and returned zero of 9,351 reports. So every text value becomes a fixed pattern allowing spaces around it (patterns are not trimmed), and the list merges both forms into one line (see filterOptions).
    const textual = !NUMERIC_COLUMNS.has(field);
    const list = rest.map((v) => decodeColumnValue(field, v)).filter((v) => v !== undefined)
      .map((v) => (textual && typeof v === 'string' ? textMatcher(v) : v));
    if (wantsBlank) list.push(...(textual ? BLANK_VALUES : ['', null]));
    if (list.length) conds.push({ [field]: { $in: list } });
  }
  return conds;
}

/** Clearance column condition: specific transaction numbers, and '' means no linked transaction (including one a person unlinked by hand: customsLink present without a transaction). */
const LINKED = { 'customsLink.clearance': { $type: 'objectId' } };
function customsRefCondition(vals) {
  const refs = vals.filter((v) => v !== '');
  const cs = [];
  if (vals.includes('')) cs.push({ 'customsLink.clearance': { $not: { $type: 'objectId' } } });
  if (refs.length) cs.push({ 'customsLink.refNumber': { $in: refs }, ...LINKED });
  return cs.length === 1 ? cs[0] : { $or: cs };
}

/** Invalidates the cached value lists after every write. The list is cached for twenty seconds to merge concurrent requests, but a new status or deleted report cannot wait out the period: the user would filter on a value that no longer exists, see an empty table and think the filter is broken. */
const bustFilterCache = () => { try { cache.clear('wf:'); } catch (e) {} };

/**
 * What is sent to the table. A document carries about sixty fields, including leftovers of old imports that nothing displays or reads (ownerName, region, product, invoiceRef, volume). Fifty full rows are 63 KB on a cluster limited to about 100 KB per second, so one open cost 1.5 seconds. The query itself takes zero milliseconds: transfer is the whole cost.
 * Only the table's columns are sent; what is not shown is not transferred.
 */
const LIST_FIELDS = [
  'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch',
  'carOwner', 'carNumber', 'ownerType', 'executionStatus', 'applicationStatus',
  // Read only by the page's Excel export.
  'ownerName', 'ownerPhone', 'carName',
  'paymentMethod', 'username', 'userPhone', 'taxIndicator',
  'purchaseValue', 'sellingValue', 'loadingTime', 'driverRentalType', 'reference',
  'driverName', 'driverPhone', 'truckType', 'truckSize', 'loadType', 'quantity',
  'representativeName', 'operationsReview',
  'paymentDate', 'payingBranch', 'paymentAmount', 'paymentType', 'paymentSubtype',
  // Data owner is read in the table; without it it appears after saving and disappears at the first live update, since the row returns from the list without the field.
  'paymentDateByName', 'paymentDateAt',
  'finalReportDestination', 'documentNumber', 'sendingDate',
  'branchDeliveryDate', 'deliveryDate',
  'accountingReview', 'invoiceNumber', 'netInvoice', 'tax', 'totalInvoice',
  'invoiceDate', 'invoiceNotes', 'collectedAmount', 'collectionDate',
  'stage', 'lockedBy', 'lockedByName', 'lockedAt', 'externalSource', 'shipmentOrder', 'fleetShipment', 'createdAt',
  // The linked clearance transaction as a small copy (number, bill of lading, containers). See services/customsOpsLink.
  'customsLink',
].join(' ');

// GET /api/workflows
/**
 * One table page of reports, newest first, and the total.
 * The total is counted first because it decides the plan: for a narrow search (few matches) walking the createdAt index reads every report before filling a page, while the per-field search indexes read only the matches; sorting on { createdAt, _id } (no such index) makes the planner take the search indexes. A broad match fills the page early by walking createdAt, so it keeps that sort.
 */
const NARROW_MATCH = 3000;
async function pageOfReports(filter, { select, skip = 0, limit = 50, searching = false }) {
  const total = await OperationsWorkflow.countDocuments(filter);
  const sort = searching && total <= NARROW_MATCH ? { createdAt: -1, _id: -1 } : { createdAt: -1 };
  let q = OperationsWorkflow.find(filter);
  if (select) q = q.select(select);
  const rows = await q.sort(sort).skip(skip).limit(limit).lean();
  return { rows, total };
}

exports.getWorkflows = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    // Rows per page are chosen by the user, with an upper limit of 500.
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    // The search condition is built in one place read by the table, statistics and export, so the row counter never shows one number while the table shows rows of another condition.
    const filter = buildWorkflowFilter(req.query, undefined, canSeeMoney(req.user.role), canSeeSelling(req.user.role));

    const skip = (parseInt(page) - 1) * parseInt(limit);
    // No populate for what the list does not read. There were three on every page (creator, last editor, locker) but the table reads only lockedBy._id, the raw id already present: three database trips per open and per search keystroke for nothing displayed. Details are populated on the report page where they are read.
    const { rows: workflows, total } = await pageOfReports(filter, { select: LIST_FIELDS, skip, limit: parseInt(limit), searching: !!String(req.query.search || '').trim() });

    // Reports paid by the wallet: their payment amount cell is shown locked.
    const { walletPaidMap, walletRecorderMap } = require('../utils/walletPayment');
    const nums = workflows.map((w) => w.reportNumber);
    const [walletPaid, recorders] = await Promise.all([walletPaidMap(nums), walletRecorderMap(nums)]);
    for (const w of workflows) if (walletPaid.has(String(w.reportNumber || '').trim())) w.paidFromWallet = true;

    // Data owner is read from three sources in order: who wrote the payment date here; else who recorded the purchase in the wallet (who paid then); else the row was transferred from the operations platform and nobody here wrote it, which is stated explicitly rather than an empty cell read as unknown.
    for (const w of workflows) {
      const rn = String(w.reportNumber || '').trim();
      const who = String(w.paymentDateByName || '').trim();
      if (who) { w.dataOwnerShown = who; w.dataOwnerFrom = 'system'; continue; }
      const rec = recorders.get(rn);
      if (rec) { w.dataOwnerShown = rec; w.dataOwnerFrom = 'wallet'; continue; }
      if (w.externalSource) {
        // The same text the filter list is built on; see utils/dataOwnerIndex.
        w.dataOwnerShown = require('../utils/dataOwnerIndex').importLabel(w.externalSource);
        w.dataOwnerFrom = 'import';
        continue;
      }
      w.dataOwnerShown = '';
      w.dataOwnerFrom = '';
    }
    res.json({
      workflows: stripRowFor(req.user.role, workflows),
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Get workflows error:', error);
    res.status(500).json({ message: 'Failed to load workflows' });
  }
};

// Build the same match filter getWorkflows uses (stage/date/search/pendingOnly)
// so stats and the table always agree. Kept as a helper for the stats endpoint.
/**
 * Bond not arrived: one definition used by both the counter and the filter. Two conditions:
 * 1) No payment date. The condition used to combine its absence with an absent invoice number, so a paid report whose invoice was not recorded dropped out of the count though not pending.
 * 2) Not cancelled. A cancelled report has no payment by nature, since the shipment never happened; counting them inverted the card (5,642 in the period, 4,152 of them cancelled) and buried the real work of 1,490.
 */
const CANCELLED = ['cancelled', 'canceled'];
const PENDING_PAYMENT = {
  $and: [
    { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
    { applicationStatus: { $nin: CANCELLED } },
  ],
};

/** Bonds not arrived as of a past moment: not cancelled, and no payment date or a payment date after that moment, so a bond that arrived later still counts as pending back then (owner request for a point-in-time view). */
const pendingAsOfMatch = (asOf) => ({
  $and: [
    { $or: [{ paymentDate: null }, { paymentDate: { $exists: false } }, { paymentDate: { $gt: asOf } }] },
    { applicationStatus: { $nin: CANCELLED } },
  ],
});
/**
 * A single picked day means «everything up to that day»: the as-of view then covers
 * manifests from the start of 2026 to that day (owner, 2026-10-29). A range keeps its start.
 */
const AS_OF_START = '2026-01-01';
// Non-enumerable search hints set by primeRelatedSearch; copies of the query must carry them.
const SEARCH_HINTS = ['_related', '_exactId', '_textIds'];
/** A copy of the query with some keys replaced, keeping the non-enumerable search hints a spread would drop (the copy then searched by regex again, ~1 s per query). */
const withQuery = (query, patch) => {
  const q = { ...(query || {}), ...patch };
  for (const k of SEARCH_HINTS) if (query && query[k]) Object.defineProperty(q, k, { value: query[k], enumerable: false });
  return q;
};
const asOfQuery = (query) => {
  const q = { ...(query || {}) };
  // The search hints are non-enumerable (kept out of exports), so a spread drops them; carry them over.
  for (const k of SEARCH_HINTS) if (query && query[k]) Object.defineProperty(q, k, { value: query[k], enumerable: false });
  if (q.dateTo && (!q.dateFrom || q.dateFrom === q.dateTo)) q.dateFrom = AS_OF_START;
  return q;
};
/** The moment «as of» is read at: the end of the period's last day, or now without one. */
const pendingAsOfDate = (query) => {
  const to = query && query.dateTo;
  return to ? endOfDay(to) : new Date();
};

/**
 * Report ids whose text fields contain `term`, from the Atlas Search index; null when the index cannot answer (not built yet, unavailable, or too many matches to pass as a list), so the caller keeps the regex.
 * `scope` 'names' searches the name and place fields only, as the whole-phrase alternative does.
 */
const WHOLE = '\u0000whole';
const TEXT_ID_CAP = 15000;
async function textSearchIds(term, scope) {
  return require('../config/workflowSearch').ids(OperationsWorkflow, term, { namesOnly: scope === 'names', cap: TEXT_ID_CAP });
}

/** A number belonging to one of the report owners. Called before buildWorkflowFilter (which is synchronous): each number of six or more digits in the search is translated to its owners in the registers (a driver's residence number to name and phone, a truck chassis to its plate) and attached to req.query._related as a non-enumerable property, so it does not appear in any copy or export of the query. */
const RELATED_FIELDS = { name: ['driverName'], phone: ['driverPhone', 'userPhone', 'ownerPhone'], plate: ['carNumber', 'plateNumber'] };
async function primeRelatedSearch(req, res, next) {
  try {
    const raw = String((req.query && (req.query.search || req.query.q)) || '');
    const { westernDigits } = require('../utils/arabicSearch');
    const nums = [...new Set(westernDigits(raw).split(/\s+/).map((t) => t.replace(/\D/g, '')).filter((d) => d.length >= 6))].slice(0, 3);
    if (nums.length) {
      const { relatedClauses } = require('../utils/relatedPeopleSearch');
      const map = {};
      for (const d of nums) map[d] = await relatedClauses(d, RELATED_FIELDS); // eslint-disable-line no-await-in-loop
      Object.defineProperty(req.query, '_related', { value: map, enumerable: false, configurable: true });
    }
    // A single number that is exactly a report or document number is answered from those indexes alone. Invoice numbers are left out: readers without money rights do not search them, so a hit there would hide what they can find.
    // As a contains-match over eight code fields it scanned every report (~40k) for each of the eight queries a search fires (table, count, stat cards): the heaviest load on the database in Atlas query stats.
    const tokens = westernDigits(raw).trim().split(/\s+/).filter(Boolean);
    const bare = tokens.length === 1 && /^[\d\s+()\-]+$/.test(tokens[0]) ? tokens[0].replace(/\D/g, '') : '';
    if (bare) {
      const hit = await OperationsWorkflow.exists({ $or: [{ reportNumber: bare }, { documentNumber: bare }] });
      if (hit) Object.defineProperty(req.query, '_exactId', { value: bare, enumerable: false, configurable: true });
    }
    // Text words are answered by the Atlas Search index (config/workflowSearch) as id lists; a word it cannot answer keeps the regex path.
    const words = tokens.filter((t) => !/^[\d\s+()\-]+$/.test(t));
    if (words.length) {
      const ids = {};
      for (const w of words) ids[w] = await textSearchIds(w, 'all'); // eslint-disable-line no-await-in-loop
      if (tokens.length > 1) ids[WHOLE] = await textSearchIds(tokens.join(' '), 'names');
      Object.defineProperty(req.query, '_textIds', { value: ids, enumerable: false, configurable: true });
    }
  } catch (e) { console.error('related search:', e.message); }
  next();
}

function buildWorkflowFilter(queryIn, skipField, allowMoney = true, allowSelling = true) {
  // The as-of view widens a single day back to the start of the year (see asOfQuery).
  const query = queryIn && queryIn.pendingAsOf === 'true' ? asOfQuery(queryIn) : queryIn;
  const {
    stage, search, dateFrom, dateTo, pendingOnly, invoiceGap, pendingKind, pendingAsOf,
  } = query || {};
  const filter = {};
  // Which section a row comes from; the default shows both.
  const origin = String((query && query.origin) || '');
  if (origin === 'fleet') filter.fleetShipment = { $type: 'objectId' };
  if (origin === 'orders') filter.fleetShipment = { $in: [null] };

  // Linked to clearance / not linked / a specific transaction. The filter bar above the table and the operations-sheets button on the transaction page both express it as one word: customs=linked|unlinked|<transaction id>.
  // Excluding cancelled (company owner): a sticky button until removed; numbers, table and export all omit cancelled reports.
  if (String((query && query.excludeCancelled) || '') === '1') {
    // A number typed in search is a request for that one row, cancelled or not.
    const asked = require('../utils/arabicSearch').westernDigits(String((query && query.search) || '').trim());
    const exact = asked && !/\s/.test(asked) ? [{ reportNumber: asked }, { documentNumber: asked }] : [];
    // While searching, the exclusion is an $expr: as a plain $nin the planner chose the status index and read every non-cancelled report (34k) instead of the search indexes. Same meaning, including reports with no status.
    const searching = !!String((query && query.search) || '').trim();
    const notCancelled = searching
      ? { $expr: { $not: { $in: [{ $ifNull: ['$applicationStatus', null] }, CANCELLED] } } }
      : { applicationStatus: { $nin: CANCELLED } };
    filter.$and = [...(filter.$and || []), { $or: [notCancelled, ...exact] }];
  }
  const customs = String((query && query.customs) || '');
  if (customs === 'linked') filter.$and = [...(filter.$and || []), LINKED];
  else if (customs === 'unlinked') filter.$and = [...(filter.$and || []), { 'customsLink.clearance': { $not: { $type: 'objectId' } } }];
  else if (mongoose.isValidObjectId(customs)) filter.$and = [...(filter.$and || []), { 'customsLink.clearance': new mongoose.Types.ObjectId(customs) }];

  // A report invoiced as tax but with no invoice number. The invoice number is entered by hand here and does not come from the operations platform, so it is empty on 30,000 of 35,000 reports, most truly not yet invoiced.
  // An amount alone is not proof. The condition used to be 'has net, tax or total', which caught 49 cash reports with no gap: deriveCashTotals writes their figures (payment amount copied to net and total, tax zero) and deliberately leaves the invoice number empty, since cash has no invoice, so the card demanded filling a non-gap.
  // Tax is the divider: deriveInvoiceTotals computes it from net for every tax invoicing, so it is above zero, while cash is written as explicit zero. So tax with no number means invoiced as tax with the number forgotten, and that alone is the gap.
  if (invoiceGap === 'true') {
    filter.$and = [...(filter.$and || []), {
      $or: [
        { invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } },
        { invoiceNumber: { $regex: '^\\s*(no\\s*inv|بدون|لا\\s*يوجد|-|—|ىى)\\s*$', $options: 'i' } },
      ],
    }, { tax: { $gt: 0 } },
    // Cash may have tax computed and no number by decision (see hasTaxInvoice), so it is not a gap.
    { paymentType: { $ne: 'cash' } }];
  }
  // Invoices not arrived means no payment date and nothing else. The condition used to combine absence of payment date and invoice number, so a paid report with no recorded invoice left the count though not pending, and an unpaid report with an invoice number left too. The card answers one question, which report's payment has not arrived, so its condition is single.
  if (pendingOnly === 'true') {
    filter.$and = [...(filter.$and || []), PENDING_PAYMENT];
    // Bonds not arrived, cash / tax: the same split the two cards count (see PENDING_SPLIT in getWorkflowStats), so what a card says is what the table opens.
    if (pendingKind === 'cash') filter.$and.push({ paymentType: 'cash' });
    else if (pendingKind === 'tax') filter.$and.push({ paymentType: { $ne: 'cash' } });
  }
  if (pendingAsOf === 'true') filter.$and = [...(filter.$and || []), pendingAsOfMatch(pendingAsOfDate(query))];
  if (stage) filter.stage = stage;
  // The period is measured by report date, not by entry time. The filter used createdAt, the moment the row was written to our database and not the work date; 27,000 of 33,000 were entered in one batch, so 'show January reports' returned empty although all its reports were there. The screen showed zero, read as 'no work' and not as 'filtered on the wrong column'.
  // reportDate carries a real time from the operations platform, so the range covers the whole day at both ends and an 11 pm report does not drop from its day.
  if (dateFrom || dateTo) {
    const range = {};
    // The bound is Riyadh time, not GMT. The line built midnight in GMT, which is 3 am locally, so choosing 'from January 1' lost the first three hours of that day (2,121 of 33,917 reports). It also contradicted the column filter below, which computes the day in Riyadh, making 'January 1' differ from 'January 1 to January 1'.
    if (dateFrom) range.$gte = startOfDay(dateFrom);
    // An empty 'to' means 'until now', not unbounded. An open range includes reports dated in the future (entered wrongly or with an inverted date) and shows a larger count than happened; a user who writes only 'from' means from that day to now, not forever.
    range.$lte = dateTo ? endOfDay(dateTo) : new Date();
    // A report with no date is measured by its entry time, the best known about it.
    filter.$and = [...(filter.$and || []), { $or: [
      { reportDate: range },
      { $and: [{ $or: [{ reportDate: null }, { reportDate: { $exists: false } }] }, { createdAt: range }] },
    ] }];
  }
  if (search) {
    // Search answers what was asked, not what contains it: one unanchored regex over seventeen fields made '8730' match phone digits and a city name match nearly every report.
    // Identity numbers (report, document, invoice): exact match, using the index. Codes (plate) and phones: contains, phones only from six digits.
    // Names and places: contains with letter-variant folding (see utils/arabicSearch).
    // Words are combined, so each word is a required condition and adding a word narrows the result.
    const { arabicSearchRegex, westernDigits } = require('../utils/arabicSearch');
    const term = westernDigits(String(search).trim());
    const ID_EXACT = ['reportNumber', 'documentNumber', ...(allowMoney ? ['invoiceNumber'] : [])];
    // Clearance transaction number and bill of lading are written as is, so their report is found. Load number, reference and invoice reference are codes searched by part (owner request: any number related to the shipment).
    const CODE_FIELDS = ['carNumber', 'plateNumber', 'customsLink.refNumber', 'customsLink.blNumber', 'customsLink.containersText', 'loadNumber', 'reference', 'invoiceRef'];
    const PHONE_FIELDS = ['driverPhone', 'userPhone', 'ownerPhone'];
    // Notes are outside quick search on purpose: free text lets a passing word pull in unrelated reports. They have their own column filter.
    const NAME_FIELDS = [
      'username', 'carOwner', 'driverName', 'branch', 'payingBranch',
      'fromLocation', 'toLocation', 'finalReportDestination',
      'truckType', 'truckSize', 'agentName', 'representativeName',
      'ownerName', 'carName', 'product',
    ];
    // Driver residence and truck chassis are not on the report: primeRelatedSearch first translates them to the driver's name and phone and the truck's plate (utils/relatedPeopleSearch).
    const related = (query && query._related) || {};

    const clauseFor = (tk) => {
      // '+966506793241', '0506793241' and '506793241' are one number: decoration is stripped and the last nine digits are matched, so the phone is found however it was written.
      const bare = tk.replace(/\D/g, '');
      const numeric = /^[\d\s+()\-]+$/.test(tk) && bare.length > 0;
      const rx = arabicSearchRegex(tk);
      if (numeric && query && query._exactId === bare) {
        return ID_EXACT.map((f) => ({ [f]: bare }));  // reportNumber / documentNumber (and invoiceNumber for money readers), all indexed
      }
      if (numeric) {
        const rxBare = new RegExp(bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const tail = bare.length > 9 ? bare.slice(-9) : bare;
        const rxTail = new RegExp(`${tail}$`);
        return [
          ...ID_EXACT.map((f) => ({ [f]: bare })),
          ...CODE_FIELDS.map((f) => ({ [f]: rxBare })),
          ...(bare.length >= 6 ? PHONE_FIELDS.map((f) => ({ [f]: rxTail })) : []),
          ...(related[bare] || []),
        ];
      }
      const ids = query && query._textIds && query._textIds[tk];
      if (ids) return [{ _id: { $in: ids } }];
      return [...NAME_FIELDS, ...CODE_FIELDS].map((f) => ({ [f]: rx }));
    };

    const tokens = term.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
      filter.$or = clauseFor(term);
    } else {
      // Each word is an independent condition combined with $and; the whole phrase is also accepted in name fields (a name containing a space is written as is).
      const whole = arabicSearchRegex(term);
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { $and: tokens.map((tk) => ({ $or: clauseFor(tk) })) },
            ...((query && query._textIds && query._textIds[WHOLE]) ? [{ _id: { $in: query._textIds[WHOLE] } }] : NAME_FIELDS.map((f) => ({ [f]: whole }))),
          ],
        },
      ];
    }
  }
  // Column filters are applied here and not in the browser. The page used to download the whole table and filter locally, costing tens of thousands of rows and freezing the tab.
  // They are added inside $and, not at the root, because the day filter needs an $or (day range or empty cell) and the root's single $or is used by search, so one would silently erase the other.
  const conds = columnFilters(query, skipField, allowMoney, allowSelling);
  if (conds.length) filter.$and = [...(filter.$and || []), ...conds];
  return filter;
}

// GET /api/workflows/stats — aggregates over the WHOLE matching set (not one
// page): total rows, "invoices not arrived" count, and total purchase value.
// Powers the operations-page summary cards so they reflect all ~27k records.
exports.getWorkflowStats = async (req, res) => {
  try {
    const filter = buildWorkflowFilter(req.query, undefined, canSeeMoney(req.user.role), canSeeSelling(req.user.role));
    // The same condition that filters with the button, from one definition, so the counter and the button cannot disagree.
    const pendingMatch = { ...filter, $and: [...(filter.$and || []), PENDING_PAYMENT] };
    /**
     * The number asked right after 'bonds not arrived'. A row with no payment date counts as bond not arrived while its order status says bond received. This contradiction cannot be read from the two cards separately: the first totals 988 and the status totals four thousand, with no way to know the intersection.
     * This is where the work is: the bond arrived (status says so) but the payment date was not written, so either a date is missing or a status needs correction. It is counted explicitly.
     */
    const bondReceivedPending = {
      ...filter,
      $and: [...(filter.$and || []), PENDING_PAYMENT, { applicationStatus: 'bond_received' }],
    };
    /**
     * Bonds not arrived as cash and tax, summing exactly to the total (company owner rule: the two cards equal the total card). The split is on paymentType, the same column shown as payment type and read by collections:
     * cash = payment type cash.
     * tax = everything else: tax, and those with no type yet.
     * The untyped are inside tax because a report without a type waits for an invoice number to reach collections (reachesCollections: non-cash 'awaiting invoice number'), so it is on the tax path. Their count is stated under the card (pendingUntyped) so they do not hide. All three numbers come from one aggregation, so the sum cannot diverge from the total even if a row changes between queries.
     */
    const PENDING_SPLIT = OperationsWorkflow.aggregate([
      { $match: pendingMatch },
      { $group: { _id: { $ifNull: ['$paymentType', ''] }, n: { $sum: 1 } } },
    ]);
    // Bonds pending as of the end of the filtered period (counted on the same filter, minus «pendingOnly»).
    const asOf = pendingAsOfDate(req.query);
    const asOfBase = buildWorkflowFilter(asOfQuery(withQuery(req.query, { pendingOnly: '', pendingAsOf: '' })), undefined, canSeeMoney(req.user.role), canSeeSelling(req.user.role));
    const asOfMatch = { ...asOfBase, $and: [...(asOfBase.$and || []), pendingAsOfMatch(asOf)] };
    // Status counts ignore the status filter, origin counts ignore the origin filter (explained below); every count runs in one round.
    const statusFree = buildWorkflowFilter(req.query, 'applicationStatus', canSeeMoney(req.user.role), canSeeSelling(req.user.role));
    const anyOrigin = buildWorkflowFilter(withQuery(req.query, { origin: '' }), undefined, canSeeMoney(req.user.role), canSeeSelling(req.user.role));
    const [total, pendingRows, pendingBondReceived, agg, stages, pendingAsOfCount, byStatusRows, allOrigins, fleetCount] = await Promise.all([
      OperationsWorkflow.countDocuments(filter),
      PENDING_SPLIT,
      OperationsWorkflow.countDocuments(bondReceivedPending),
      OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: null, sumPurchaseValue: { $sum: '$purchaseValue' } } },
      ]),
      // Each stage counter is computed here too. It used to be computed in the browser from loaded rows, saying 'complete: 4' while seeing only fifty of tens of thousands.
      OperationsWorkflow.aggregate([
        { $match: filter },
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
      OperationsWorkflow.countDocuments(asOfMatch),
      OperationsWorkflow.aggregate([
        { $match: statusFree },
        { $group: { _id: { $ifNull: ['$applicationStatus', ''] }, count: { $sum: 1 } } },
      ]),
      OperationsWorkflow.countDocuments(anyOrigin),
      OperationsWorkflow.countDocuments({ $and: [anyOrigin, { fleetShipment: { $type: 'objectId' } }] }),
    ]);

    // Application status counts. The status cards above the table existed only on the platform shipments page, and they are the first question here too: how many on the way, how many arrived without a bond. Computing in the browser from loaded rows counts fifty of 36,000.
    // They are computed under the existing filters except the status filter itself, as Excel does: someone filtering 'on the way' wants to see the other statuses to move to them, not zeros. skipField is the mechanism built for this in buildWorkflowFilter.
    const byStatus = {};
    let statusTotal = 0;
    byStatusRows.forEach((r) => { byStatus[r._id || '(بلا حالة)'] = r.count; statusTotal += r.count; });

    let pendingCash = 0; let pendingTax = 0; let pendingUntyped = 0;
    for (const r of pendingRows) {
      if (r._id === 'cash') pendingCash += r.n;
      else { pendingTax += r.n; if (r._id !== 'tax') pendingUntyped += r.n; }
    }
    const pendingInvoices = pendingCash + pendingTax;
    // Origin counts ignore the origin filter so both sections stay visible once one of them is picked.
    res.json({
      total,
      byOrigin: { orders: allOrigins - fleetCount, fleet: fleetCount },
      pendingInvoices,
      pendingCash,
      pendingTax,
      pendingUntyped,
      pendingBondReceived,
      pendingAsOf: pendingAsOfCount,
      pendingAsOfDate: asOf,
      pendingAsOfFrom: asOfQuery(req.query).dateFrom || '',
      sumPurchaseValue: agg[0]?.sumPurchaseValue || 0,
      byStage: stages.reduce((acc, r) => { acc[r._id || 'draft'] = r.count; return acc; }, {}),
      byStatus,
      statusTotal,
    });
  } catch (error) {
    console.error('Get workflow stats error:', error);
    res.status(500).json({ message: 'Failed to load workflow stats' });
  }
};

/**
 * GET /api/workflows/filters?field=<column> - values of one column with the row count of each.
 * The filter list used to be built from the loaded rows (fifty), showing three of nine statuses; the fix of downloading the whole table at the first filter moved tens of thousands of rows and froze the tab for a minute. Counting in the database returns all values in one small query.
 * Values are computed under the active filters (stage, search, range, other columns), since a list showing values with no rows after filtering invites a choice that returns an empty table.
 */
exports.filterOptions = async (req, res) => {
  try {
    const field = String(req.query.field || '');
    if (!FILTERABLE_COLUMNS.has(field)) {
      return res.status(400).json({ message: 'Unknown filter column' });
    }
    // A hidden column's value list would show its values one by one (invoice total read from the list as from the table), so it is blocked for roles without it.
    if (AMOUNT_FIELDS.includes(field) && !canSeeMoney(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    if (SELLING_FIELDS.includes(field) && !canSeeSelling(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    // The key carries the permission. The condition now varies by role (money column filters are dropped for roles without them), so a key without it would serve one role a result computed for another, in the first second after an accountant opens the same list.
    const money = canSeeMoney(req.user.role);
    const selling = canSeeSelling(req.user.role);
    const key = `wf:filters:${money ? 'm' : 'x'}${selling ? 's' : 'x'}:${JSON.stringify(req.query || {})}`;
    const hit = cache.get(key);
    if (hit !== undefined) return res.json(hit);

    // The three invoice-number states are counted by their condition, not by grouping the field.
    if (field === 'invoiceState') {
      const base = buildWorkflowFilter(req.query, field, money, selling);
      const states = Object.keys(INVOICE_STATE_COND);
      const counts = await Promise.all(states.map((k) => OperationsWorkflow.countDocuments(
        { $and: [base, INVOICE_STATE_COND[k]] })));
      const values = states.map((value, i) => ({ value, count: counts[i] }));
      const body = { filters: [{ key: field, values, truncated: false, distinct: values.length }] };
      cache.set(key, body, 20000);
      return res.json(body);
    }

    // Clearance is grouped by transaction number, and empty means not linked.
    if (field === 'customsRef') {
      const base = buildWorkflowFilter(req.query, field, money, selling);
      const q = String(req.query.q || '').trim().toLowerCase();
      const agg = await OperationsWorkflow.aggregate([
        { $match: base },
        { $group: { _id: { $cond: [{ $eq: [{ $type: '$customsLink.clearance' }, 'objectId'] }, '$customsLink.refNumber', ''] }, count: { $sum: 1 } } },
      ]);
      let values = agg.map((r) => ({ value: String(r._id || ''), count: r.count }))
        .filter((o) => !q || o.value.toLowerCase().includes(q))
        .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : b.value.localeCompare(a.value, 'en', { numeric: true })));
      const distinct = values.length;
      const truncated = values.length > MAX_FILTER_VALUES;
      if (truncated) values = values.slice(0, MAX_FILTER_VALUES);
      const body = { filters: [{ key: field, values, truncated, distinct }] };
      cache.set(key, body, 20000);
      return res.json(body);
    }

    // Data owner is counted by the three sources that fill its cell; see utils/dataOwnerIndex.
    if (field === 'dataOwnerShown') {
      const owner = require('../utils/dataOwnerIndex');
      await owner.ensure();
      const base = buildWorkflowFilter(req.query, field, money, selling);
      const q = String(req.query.q || '').trim().toLowerCase();
      let values = (await owner.ownerOptions(OperationsWorkflow, base))
        .filter((o) => !q || o.value.toLowerCase().includes(q))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
      const distinct = values.length;
      const truncated = values.length > MAX_FILTER_VALUES;
      if (truncated) values = values.slice(0, MAX_FILTER_VALUES);
      const body = { filters: [{ key: field, values, truncated, distinct }] };
      cache.set(key, body, 20000);
      return res.json(body);
    }

    const match = buildWorkflowFilter(req.query, field, money, selling);
    // Search within the list runs here and not in the browser, because the browser holds only the values up to the cap: searching for a report number outside the 500 most frequent returned 'no values' though it exists in the database.
    const q = String(req.query.q || '').trim();
    // (Payment type is six values read by name, not key, so it has no search.)
    if (q && field !== 'paymentType' && !NUMERIC_COLUMNS.has(field) && !DATE_COLUMNS.has(field)) {
      const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      const prev = match[field];
      // The condition on a column may be a single value (stage selection from the top bar); spreading a string into an object breaks it into characters and makes the condition meaningless.
      match[field] = prev === undefined ? rx
        : (prev && typeof prev === 'object' && !(prev instanceof Date) ? { ...prev, ...rx } : { $eq: prev, ...rx });
    }

    const isDate = DATE_COLUMNS.has(field);
    // Order follows the column's nature. Dates are newest first: whoever filters by date looks for recent days, not the day that happened to have the most reports.
    // Number columns (report, document, invoice) have a nearly unique value per row, so ordering by frequency raises a number repeated twice by mistake to the top and buries 37,000 others, which reads as an imposed filter. They are ordered by value descending: newest at the top, as wanted. (Seen in the invoice ledger; see collectionsDeptController.invoiceColumnOptions.)
    const ID_LIKE = new Set(['reportNumber', 'documentNumber', 'invoiceNumber', 'carNumber', 'plateNumber']);
    const isIdLike = !isDate && ID_LIKE.has(field);
    const sort = isDate ? { _id: -1 } : (isIdLike ? { _num: -1, _id: -1 } : { count: -1, _id: 1 });
    const [agg] = await OperationsWorkflow.aggregate([
      { $match: match },
      {
        $group: {
          // Payment type groups by what the cell shows: the type if present, otherwise the family.
          _id: isDate ? { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TZ } }
            : (field === 'paymentType' ? PAYMENT_KIND_EXPR : `$${field}`),
          count: { $sum: 1 },
        },
      },
      // The number is read as a number, not text: '10012' after '7679', not before.
      ...(isIdLike ? [{ $addFields: { _num: { $convert: { input: '$_id', to: 'double', onError: null, onNull: null } } } }] : []),
      {
        $facet: {
          values: [{ $sort: sort }, { $limit: MAX_FILTER_VALUES + 1 }],
          meta: [{ $count: 'distinct' }],
        },
      },
    ]).allowDiskUse(true);

    // A missing field and null produce the same key (null) and an empty string produces '', all of which the user sees as one thing, '(empty)'. Merging them here avoids two identical lines in the list.
    const merged = new Map();
    for (const r of (agg?.values || [])) {
      const id = r._id;
      // Text is grouped trimmed: 'Dammam ' and 'Dammam' are one line as in the table, and its filter matches both forms (see columnFilters).
      const value = id === null || id === undefined || id === ''
        ? ''
        : (id instanceof Date ? id.toISOString() : (typeof id === 'string' ? colKey(id) : String(id)));
      merged.set(value, (merged.get(value) || 0) + r.count);
    }
    // Merging keeps the database order: re-sorted with the same rule as above.
    const numOf = (v) => { const n = Number(String(v).replace(/[\s,]/g, '')); return Number.isFinite(n) ? n : null; };
    let values = [...merged.entries()].map(([value, count]) => ({ value, count }))
      .sort((a, b) => {
        if (isDate) return b.value.localeCompare(a.value);
        if (isIdLike) {
          const na = numOf(a.value); const nb = numOf(b.value);
          if (na !== null && nb !== null) return nb - na;
          if (na !== null) return -1;
          if (nb !== null) return 1;
          return b.value.localeCompare(a.value, 'ar', { numeric: true });
        }
        return b.count - a.count || a.value.localeCompare(b.value, 'ar', { numeric: true });
      });
    const distinct = agg?.meta?.[0]?.distinct || values.length;
    const truncated = values.length > MAX_FILTER_VALUES;
    if (truncated) values = values.slice(0, MAX_FILTER_VALUES);

    // The same shape used by the HR filters and the vehicle register, so each section does not learn its own: { filters: [{ key, values: [{ value, count }] }] }.
    const body = { filters: [{ key: field, values, truncated, distinct }] };
    cache.set(key, body, 20000);
    res.json(body);
  } catch (error) {
    console.error('workflow filterOptions', error);
    res.status(500).json({ message: 'Failed to load column filter values' });
  }
};

// GET /api/workflows/:id
exports.getWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    res.json(stripRowFor(req.user.role, workflow));
  } catch (error) {
    console.error('Get workflow error:', error);
    res.status(500).json({ message: 'Failed to load workflow details' });
  }
};

// POST /api/workflows
exports.createWorkflow = async (req, res) => {
  try {
    const filteredBody = filterFieldsByRole(req.body, req.user.role, await fieldsForRole(req.user.role));
    const newBranchError = await require('../utils/branchList').applyBranchList(filteredBody);
    if (newBranchError) return res.status(400).json({ message: newBranchError });
    if (filteredBody.username !== undefined) {
      const chk = await require('../utils/approvedCustomerName').checkCustomerName(filteredBody.username, '');
      if (chk.error) return res.status(400).json({ code: 'CUSTOMER_NOT_APPROVED', message: chk.error });
      filteredBody.username = chk.value;
    }
    // Payment type decides the report's shape from creation, not after the first edit.
    await fillPaymentTypeFromCustomer(filteredBody, {});
    applyBillingRules(filteredBody, {});
    filteredBody.createdBy = req.user._id;
    filteredBody.lastModifiedBy = req.user._id;
    filteredBody.stage = 'draft';

    const workflow = await OperationsWorkflow.create(filteredBody);
    if (filteredBody.invoiceNumber) await ensureLedgerInvoice(workflow);
    // A report that clearance already named in a transport field before it was created, or whose bond is a transaction's bill of lading.
    await require('../services/customsOpsLink').resolveReports({ _id: workflow._id })
      .catch((e) => console.error('customs link (workflow create):', e.message));
    // A report created in the system for a new customer enters that customer into the collections section with its code and load type, as platform sync does. See ensureCollectionsParty.
    if (workflow.username) {
      const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
      ensureCollectionsParty(workflow.username, { paymentType: workflow.paymentType, source: 'operations_workflow' }).catch(() => {});
    }

    // The report is not copied to a customer and invoice. Each report used to create a customer record and an invoice in the removed workflow module and add to that customer's receivable, giving one thing two numbers: editing the report left the receivable on the old value with no way to know which was right.
    // The report itself is the document: collections reads what is owed to and by us from it directly (collectionsDeptController) and the party file is built from its rows. Copying added only a second number that lags the first.

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'create_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { after: filteredBody },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitPerRole('workflow:created', (r) => stripRowFor(r, populated)); } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json(populated);
  } catch (error) {
    console.error('Create workflow error:', error);
    res.status(500).json({ message: 'Failed to create workflow' });
  }
};

// PUT /api/workflows/:id
/**
 * Invoice date is the day its number was written. When the invoice number is first written with no date, its date is set to the writing day (company time) and stays editable by hand like any cell.
 * Customer delivery date is separate and never derived from it: the invoice is issued today and delivered days or weeks later. The user writes it by hand, here or in collections, and what is written in one appears in the other at once (ledger sync on save and the deliver button in collections).
 */
function stampInvoiceDate(patch, current) {
  if (!Object.prototype.hasOwnProperty.call(patch, 'invoiceNumber')) return;
  const was = String((current && current.invoiceNumber) || '').trim();
  const now = String(patch.invoiceNumber || '').trim();
  if (!now || was) return;
  const sent = Object.prototype.hasOwnProperty.call(patch, 'invoiceDate') && patch.invoiceDate;
  if (sent || (current && current.invoiceDate)) return;
  patch.invoiceDate = new Date(`${require('../utils/companyDay').todayKey()}T00:00:00.000Z`);
}
exports._stampInvoiceDate = stampInvoiceDate;
exports._applyBillingRules = applyBillingRules;

/**
 * Selling value to the operations platform. The platform holds two prices per shipment: purchase_price (cost to company) and selling_price (price charged to client), via PATCH /api/v1/admin/shipments/{id} with multipart/form-data, all fields optional (UpdateShipmentDto). Only selling_price is sent and purchase_price is never touched: it is our cost and the purchase value here is read from it.
 * A report not from the platform (created here or imported) has no shipment there: it is written here only, and the response says so (platform: false).
 */
// Suspended until the company owner decides. Writing the real selling price to the platform shows our margin to its team, and the value there used to equal cost, so the write stayed off until the owner approved it explicitly. Turning it off means false here and a new deploy.
const PUSH_SELLING_TO_PLATFORM = true;

async function pushSellingValue(workflow, value) {
  if (!PUSH_SELLING_TO_PLATFORM) return { platform: false, held: true };
  if (workflow.externalSource !== 'ops_upl' || !workflow.externalId) return { platform: false };
  const upl = require('../services/uplClient');
  if (!upl.isConfigured()) return { platform: false };
  const shipmentId = String(workflow.externalId);
  await upl.patch(`/admin/shipments/${encodeURIComponent(shipmentId)}`, { form: { selling_price: value } });
  return { platform: true, shipmentId };
}
exports._pushSellingValue = pushSellingValue;

/** Whoever reads sellingValue and keeps what it read; cleared before any broadcast. */
/** Cache of the collections section (dashboard, tree and ledger); cleared before any broadcast that reads it. */
function invalidateCollectionsReaders() {
  try { require('./collectionsDeptController').invalidate(); } catch (_) { /* */ }
  try { require('./collectionsLedgerController').invalidate(); } catch (_) { /* */ }
}

function invalidateSellingReaders() {
  for (const p of ['wf:', 'collections-dept:', 'cdr:', 'colledger:', 'opsprivate:', 'ops:']) {
    try { cache.clear(p); } catch (_) { /* */ }
  }
}

/**
 * Selling value: one path for every screen. It had two copies: the sellingValue column on the report and the real price in PrivateSellingPrice written only by the private operations page, so correcting one left the other on the old value with no way to know which was right.
 * The report is now the single reference (company owner), and writing from any screen goes through here: validation, then the platform, then saving, then cache and broadcast.
 * prepareSellingValue runs before saving: validates and pushes to the platform, and returns an error with its status if rejected (nothing is saved and the platform stays on the old value). announceSellingValue runs after saving: clears the cache before the broadcast and broadcasts.
 */
async function prepareSellingValue(workflow, raw) {
  const v = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    return { error: { status: 400, body: { code: 'BAD_SELLING_VALUE', fields: ['sellingValue'], message: 'قيمة البيع يجب أن تكون رقمًا لا يقلّ عن صفر.' } } };
  }
  const value = Math.round(v * 100) / 100;
  if (value === Math.round((Number(workflow.sellingValue) || 0) * 100) / 100) return { unchanged: true, value };
  let push;
  try {
    push = await pushSellingValue(workflow, value);
  } catch (e) {
    return {
      error: {
        status: 502,
        body: {
          code: 'PLATFORM_WRITE_FAILED',
          fields: ['sellingValue'],
          message: `تعذّرت كتابة قيمة البيع في منصّة التشغيل — لم يُحفظ شيء. (${e.message || 'خطأ في المنصّة'})`,
        },
      },
    };
  }
  return { value, push };
}

function announceSellingValue(workflow, push) {
  invalidateSellingReaders();
  try { emitToAll('collections:changed', { source: 'workflow', field: 'sellingValue', reportNumber: workflow.reportNumber }); } catch (e) { /* */ }
  // The private page hears its event by name; it reads the same column.
  try { emitToAll('operationsPrivate:updated', { _id: String(workflow._id), sellingValue: workflow.sellingValue }); } catch (e) { /* */ }
  if (push && push.platform) {
    try { emitToAll('ops:shipments:changed', { resource: 'shipments', action: 'selling_price', ids: [push.shipmentId], at: Date.now() }); } catch (e) { /* */ }
  }
}

/**
 * Writes selling value alone on a report, for a screen that edits nothing else (the private operations page). The rules are those of updateWorkflow exactly: field permission (SELLING_ROLES), the lock, the platform first, and source 'manual' so sync does not write over it.
 * Returns { status, body } and does not write the response itself.
 */
async function setSellingValue(id, raw, user, { ip, note } = {}) {
  if (!mongoose.isValidObjectId(id)) return { status: 400, body: { message: 'معرّف غير صالح' } };
  const fields = await fieldsForRole(user.role);
  if (!fields.includes('sellingValue')) {
    return {
      status: 403,
      body: { code: 'FIELDS_NOT_ALLOWED', fields: ['sellingValue'], message: 'صلاحيّتك لا تسمح بتعديل: sellingValue — لم يُحفظ شيء.' },
    };
  }
  // These roles request the change; an approver applies it (services/sellingPriceRequests).
  if (sellingByRequest(user)) {
    const workflow = await OperationsWorkflow.findById(id).lean();
    if (!workflow) return { status: 404, body: { message: 'أمر النقل غير موجود' } };
    const r = await sellingRequests().createRequest({ workflow, origin: 'workflow', raw, user });
    if (r.error) return r.error;
    if (r.unchanged) return { status: 200, body: { workflow: stripRowFor(user.role, workflow), unchanged: true } };
    return { status: 200, body: { workflow: stripRowFor(user.role, workflow), sellingRequest: r.request, sellingRequestMessage: sellingRequests().PENDING_MESSAGE } };
  }
  return writeSellingValue(id, raw, user, { ip, note });
}

/**
 * The selling-price write itself, without the role check: setSellingValue checks the
 * field, an approved change request is its own authority. Lock, platform and broadcast still apply.
 */
async function writeSellingValue(id, raw, user, { ip, note } = {}) {
  const workflow = await OperationsWorkflow.findById(id);
  if (!workflow) return { status: 404, body: { message: 'أمر النقل غير موجود' } };
  if (isLocked(workflow, user._id)) {
    return { status: 423, body: { message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}` } };
  }
  const prep = await prepareSellingValue(workflow, raw);
  if (prep.error) return prep.error;
  if (prep.unchanged) return { status: 200, body: { workflow: stripRowFor(user.role, workflow), unchanged: true } };

  const before = { sellingValue: workflow.sellingValue, sellingValueSource: workflow.sellingValueSource };
  workflow.sellingValue = prep.value;
  workflow.sellingValueSource = 'manual';
  workflow.lastModifiedBy = user._id;
  await workflow.save();

  await logAudit({
    user: user._id,
    action: 'update_workflow',
    entity: 'OperationsWorkflow',
    entityId: workflow._id,
    changes: { before, after: { sellingValue: prep.value, sellingValueSource: 'manual', ...(note ? { note } : {}) } },
    ipAddress: ip,
  });

  bustFilterCache();
  announceSellingValue(workflow, prep.push);
  try { emitPerRole('workflow:updated', (r) => stripRowFor(r, workflow)); } catch (e) { console.error('WebSocket emit error:', e); }
  require('../services/shipmentOrderWorkflowLink').pullSoon(workflow._id, user, ['sellingValue']);
  return {
    status: 200,
    body: { workflow: stripRowFor(user.role, workflow), sellingPlatform: !!(prep.push && prep.push.platform) },
  };
}
exports.setSellingValue = setSellingValue;
exports.writeSellingValue = writeSellingValue;

/** GET /customer-names - the approved customer names for the customer picker. */
exports.customerNames = async (req, res) => {
  try {
    res.json({ names: await require('../utils/approvedCustomerName').approvedNames() });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load customer names' });
  }
};

exports.updateWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const filteredBody = filterFieldsByRole(req.body, req.user.role, await fieldsForRole(req.user.role));
    const branchError = await require('../utils/branchList').applyBranchList(filteredBody, workflow);
    if (branchError) return res.status(400).json({ message: branchError });

    // Payment amount from the wallet is not written here. A report with wallet purchases has the amount the custody employee wrote; opening the report and saving with the field empty used to erase it (see utils/walletPayment).
    if (Object.prototype.hasOwnProperty.call(filteredBody, 'paymentAmount')) {
      const walletAmount = await require('../utils/walletPayment').walletPurchaseAmount(workflow.reportNumber);
      if (walletAmount != null) filteredBody.paymentAmount = walletAmount;
    }

    // What the requester does not own is reported, not swallowed, otherwise they would think it saved.
    const rejected = filteredBody.__rejected || [];
    if (rejected.length && !Object.keys(filteredBody).length) {
      return res.status(403).json({
        code: 'FIELDS_NOT_ALLOWED',
        fields: rejected,
        message: `صلاحيّتك لا تسمح بتعديل: ${rejected.join('، ')} — لم يُحفظ شيء.`,
      });
    }

    // A selling-price edit from these roles becomes a request; the stored price stays until approved.
    let sellingRequest = null;
    if (sellingByRequest(req.user) && Object.prototype.hasOwnProperty.call(filteredBody, 'sellingValue')) {
      const r = await sellingRequests().createRequest({ workflow: workflow.toObject(), origin: 'workflow', raw: filteredBody.sellingValue, user: req.user });
      if (r.error) return res.status(r.error.status).json(r.error.body);
      delete filteredBody.sellingValue;
      if (r.request) sellingRequest = r.request;
      if (!Object.keys(filteredBody).length) {
        const row = stripRowFor(req.user.role, workflow);
        return res.json(Object.assign(row.toObject ? row.toObject() : { ...row }, sellingRequest
          ? { sellingRequest, sellingRequestMessage: sellingRequests().PENDING_MESSAGE } : {}));
      }
    }

    if (filteredBody.username !== undefined) {
      const chk = await require('../utils/approvedCustomerName').checkCustomerName(filteredBody.username, workflow.username);
      if (chk.error) return res.status(400).json({ code: 'CUSTOMER_NOT_APPROVED', message: chk.error });
      filteredBody.username = chk.value;
    }

    stampInvoiceDate(filteredBody, workflow);

    // Payment date is not recorded before the bond is received. Payment acknowledges that money arrived, which cannot precede receipt of the delivery bond; recording it earlier makes financial reports count an amount not received.
    // The condition is on the server and not only the screen: the screen prevents mistakes and the server prevents fraud, and any other path (mobile, import, direct call) passes through here.
    const settingPayment = Object.prototype.hasOwnProperty.call(filteredBody, 'paymentDate')
      && filteredBody.paymentDate && String(filteredBody.paymentDate).trim();
    if (settingPayment) {
      const statusAfter = String(
        Object.prototype.hasOwnProperty.call(filteredBody, 'applicationStatus')
          ? filteredBody.applicationStatus
          : workflow.applicationStatus || '',
      ).trim();
      if (statusAfter !== 'bond_received') {
        return res.status(400).json({
          code: 'BOND_NOT_RECEIVED',
          message: 'لا يُسجَّل تاريخ السداد إلا بعد أن تصبح حالة الشحنة «استُلم السند».'
            + ' السداد إقرارٌ بوصول المال، ولا يصل قبل استلام السند.',
          applicationStatus: statusAfter || null,
        });
      }
    }

    // Who wrote the date is written with it. Recorded at the first write and at every date change, so the column means 'last person to touch payment', not 'first to write it'. See paymentDateBy in the model.
    if (Object.prototype.hasOwnProperty.call(filteredBody, 'paymentDate')) {
      const nextDate = filteredBody.paymentDate ? String(filteredBody.paymentDate) : '';
      const prevDate = workflow.paymentDate ? new Date(workflow.paymentDate).toISOString().slice(0, 10) : '';
      if (nextDate.slice(0, 10) !== prevDate) {
        filteredBody.paymentDateBy = req.user._id;
        filteredBody.paymentDateByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
        filteredBody.paymentDateAt = new Date();
      }
    }

    // Billing rules are applied here. A cash report is not invoiced, and invoice net derives its tax and total. The condition is on the server and not the screen: any other path (bulk update, app, direct call) passes through here too.
    // What the user actually sent is captured before zeroing, because applyBillingRules adds the locked columns with zero values; measured afterwards, the request would look like it carried allowed fields and nothing was rejected.
    const sentKeys = Object.keys(filteredBody);
    // Payment type is filled from the customer file before applying the rules, so a cash report is locked in the same save that recorded its payment, not in a second edit.
    await fillPaymentTypeFromCustomer(filteredBody, workflow.toObject());
    const billing = applyBillingRules(filteredBody, workflow.toObject());
    // An invoice number on a cash report is rejected explicitly even when sent with other fields: dropping it silently and saving the rest reads as 'number saved' when it was not.
    if (billing.blocked.includes('invoiceNumber')) {
      return res.status(400).json({
        code: 'CASH_INVOICE_NUMBER',
        fields: ['invoiceNumber'],
        message: 'اخترتَ نوعًا نقديًّا مع رقم فاتورة — الكاش ليس له رقم فاتورة. اترك النوع (يصير «آجل - فاتورة» برقمه) أو امسح الرقم.',
      });
    }
    if (billing.blocked.length && sentKeys.every((k) => billing.blocked.includes(k))) {
      return res.status(400).json({
        code: 'CASH_INVOICE_LOCKED',
        fields: billing.blocked,
        message: 'أمر النقل نقديّ: لا فاتورة له ولا سند — الأعمدة المقفولة لا تُكتب.'
          + ` (${billing.blocked.join('، ')})`,
      });
    }

    // Selling value is written to the operations platform first, then here. The platform owns the shipment's selling_price and rewrites it at every sync; written here only, two screens would disagree (platform one price, workflow another). So it is pushed first (see pushSellingValue) and nothing is saved if the platform rejects, so 'saved' is never said while the platform stays on the old value.
    let sellingChanged = false;
    let sellingPush = null;
    // (The same path the private operations page writes through; see prepareSellingValue.)
    if (Object.prototype.hasOwnProperty.call(filteredBody, 'sellingValue')) {
      const prep = await prepareSellingValue(workflow, filteredBody.sellingValue);
      if (prep.error) return res.status(prep.error.status).json(prep.error.body);
      if (prep.unchanged) {
        delete filteredBody.sellingValue;
      } else {
        filteredBody.sellingValue = prep.value;
        sellingPush = prep.push;
        filteredBody.sellingValueSource = 'manual';
        sellingChanged = true;
      }
    }

    filteredBody.lastModifiedBy = req.user._id;

    const before = workflow.toObject();
    const hadCollectionDate = !!workflow.collectionDate;
    Object.assign(workflow, filteredBody);
    // A collection written by hand here is a hand collection. Whoever changed the collection date or amount from this screen took the report from the wallet: the wallet does not write over it again nor lift it. See utils/walletCollection.
    if (['collectionDate', 'collectedAmount'].some((k) => filteredBody[k] !== undefined
      && String(before[k] ?? '') !== String(workflow[k] ?? ''))) {
      workflow.collectedByWallet = false;
    }
    await workflow.save();
    // An invoice number just written creates its ledger entry, so it reaches the tax screen at once.
    if (LEDGER_FIELDS.some((k) => filteredBody[k] !== undefined)) await ensureLedgerInvoice(workflow, before.invoiceNumber);
    if (filteredBody.username !== undefined || filteredBody.paymentType !== undefined) {
      const { ensureCollectionsParty } = require('../utils/ensureCollectionsParty');
      if (workflow.username) ensureCollectionsParty(workflow.username, { paymentType: workflow.paymentType, source: 'operations_workflow' }).catch(() => {});
    }

    // The collections ledger follows the report. A collection or customer-delivery date written or cleared here is followed by its row in the collections ledger, so the two sections' screens do not say different things about one invoice.
    {
      const moved = (k) => filteredBody[k] !== undefined && String(before[k] || '') !== String(workflow[k] || '');
      const changed = { collectionDate: moved('collectionDate'), deliveryDate: moved('deliveryDate') };
      if (changed.collectionDate || changed.deliveryDate) {
        await require('./collectionsDeptController').syncLedgerFromWorkflows(workflow, changed)
          .catch((e) => console.error('ledger sync (workflow update):', e.message));
      }
    }

    // Wallet collection follows the report's type. If it became cash and has a collection entry in the wallet it is collected; if it stopped being cash, what the wallet wrote is lifted. Likewise when its number changes. See utils/walletCollection.
    if (String(before.paymentType || '') !== String(workflow.paymentType || '')
      || String(before.reportNumber || '') !== String(workflow.reportNumber || '')) {
      await require('../utils/walletCollection')
        .syncWalletCollection([workflow.reportNumber, before.reportNumber], { user: req.user, reason: 'تغيّر نوع أمر النقل' })
        .catch((e) => console.error('wallet cash-collection (workflow update):', e.message));
    }

    // Payment type is followed by collections immediately. The collections board splits receivables by the four types (see collectionsReceivablesController.subtypeCards) and reads a cache, so the cache is cleared before the broadcast below, otherwise the listener reads the old data and lags one step (announce-before-invalidate).
    const kindMoved = String(before.paymentType || '') !== String(workflow.paymentType || '')
      || String(before.paymentSubtype || '') !== String(workflow.paymentSubtype || '');
    // Every cell that brings a report into the collections screen or removes it. Operations review wrote nothing there and the report was missing from cash invoices; no broadcast was sent for it. A change in any of them clears the collections cache then announces to everyone (below).
    const GATE_FIELDS = ['operationsReview', 'accountingReview', 'paymentDate', 'invoiceNumber', 'collectedAmount', 'collectionDate', 'cashCollectionStatus'];
    const gateMoved = kindMoved || GATE_FIELDS.some((f) => String(before[f] ?? '') !== String(workflow[f] ?? ''));
    if (gateMoved) invalidateCollectionsReaders();

    // Collection date does not create a payment elsewhere. Recording a collection date used to create a Payment and update an invoice and customer balance in the removed workflow module; no longer. The date on the report is the proof: collections reads 'what was collected' from the collection column itself, not from a copy.

    // The receipt number may be a clearance transaction's bill of lading or container. The report is re-linked before its copy is fetched, so the response and the broadcast carry the new link.
    if (String(before.documentNumber || '') !== String(workflow.documentNumber || '')
      || String(before.reportNumber || '') !== String(workflow.reportNumber || '')) {
      await require('../services/customsOpsLink').resolveReports({ _id: workflow._id })
        .catch((e) => console.error('customs link (workflow update):', e.message));
    }

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: filteredBody },
      ipAddress: req.ip,
    });

    bustFilterCache();
    // Selling value is read by collections (cash receivable and ages), the private page and platform dashboards; their cache is cleared before the broadcast, otherwise the listener reads the old data and lags one step (see announce-before-invalidate).
    if (sellingChanged) invalidateSellingReaders();
    try { emitPerRole('workflow:updated', (r) => stripRowFor(r, populated)); } catch (e) { console.error('WebSocket emit error:', e); }
    require('../services/shipmentOrderWorkflowLink').pullSoon(workflow._id, req.user, Object.keys(filteredBody));
    // emitPerRole does not cross to the other worker, so the collections event is broadcast to everyone.
    if (gateMoved) {
      try { emitToAll('collections:changed', { source: 'workflow', field: kindMoved ? 'paymentType' : 'gate', reportNumber: workflow.reportNumber }); } catch (e) { /* */ }
    }
    // The clearance transaction page shows the whole report and edits it in place. workflow:updated is broadcast per role on this worker only, so the transaction's event goes to everyone without a row; the page fetches what its reader may see. (No cache holds the transaction's reports, so nothing is cleared before it: they are read from the database every request.)
    {
      const linkedTo = [before.customsLink && before.customsLink.clearance, populated.customsLink && populated.customsLink.clearance]
        .filter(Boolean).map(String);
      if (linkedTo.length) {
        try { emitToAll('customs:opsLinks', { clearanceIds: [...new Set(linkedTo)], reportNumbers: [workflow.reportNumber], edited: true }); } catch (e) { /* */ }
      }
    }
    if (sellingChanged) announceSellingValue(workflow, sellingPush);

    // What was rejected is reported even when other fields succeeded: a silent partial save leaves the employee thinking all six were saved when one was.
    // The save response is stripped as the list is: it is the copy of the row that replaces the old one on screen, so returning it complete would bring the hidden fields back through the save.
    const out = stripRowFor(req.user.role, populated);
    const extra = {};
    if (rejected.length) {
      extra.refusedFields = rejected;
      extra.refusedMessage = `لم تُحفظ (خارج صلاحيّتك): ${rejected.join('، ')}`;
    }
    // Reports where selling value was written: on the platform and here, or here only (a report not from it).
    if (sellingPush) extra.sellingPlatform = !!sellingPush.platform;
    if (sellingRequest) {
      extra.sellingRequest = sellingRequest;
      extra.sellingRequestMessage = sellingRequests().PENDING_MESSAGE;
    }
    if (Object.keys(extra).length) {
      return res.json(Object.assign(out.toObject ? out.toObject() : { ...out }, extra));
    }
    res.json(out);
  } catch (error) {
    console.error('Update workflow error:', error);
    res.status(500).json({ message: 'Failed to update workflow' });
  }
};

// PUT /api/workflows/:id/stage
exports.updateStage = async (req, res) => {
  try {
    const { stage } = req.body;
    const validTransitions = {
      draft: ['submitted_to_ops'],
      submitted_to_ops: ['ops_completed', 'draft'],
      ops_completed: ['submitted_to_collections', 'submitted_to_ops'],
      submitted_to_collections: ['completed', 'ops_completed'],
      completed: [],
    };

    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Check lock
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    const allowed = validTransitions[workflow.stage] || [];
    // Super admin can force any transition
    // Finance roles are included (see config/financeAuthority).
    if (!require('../config/constants').isTopRole(req.user.role) && !isFinanceFull(req.user.role) && !allowed.includes(stage)) {
      return res.status(400).json({
        message: `Cannot transition from "${workflow.stage}" to "${stage}"`,
      });
    }

    // Role-based stage transition authorization
    const stageRoleMap = {
      submitted_to_ops: ['moderator', 'super_admin', 'admin', 'it_manager', 'it_specialist', ...FINANCE_FULL_ROLES],
      ops_completed: ['operations_manager', 'super_admin', 'admin', 'it_manager', 'it_specialist', ...FINANCE_FULL_ROLES],
      submitted_to_collections: ['operations_manager', 'super_admin', 'admin', 'it_manager', 'it_specialist', ...FINANCE_FULL_ROLES],
      completed: ['admin', 'employee', 'super_admin', ...FINANCE_FULL_ROLES],
      draft: ['moderator', 'operations_manager', 'super_admin', 'admin', 'it_manager', 'it_specialist', ...FINANCE_FULL_ROLES], // rollback
    };

    const allowedRoles = stageRoleMap[stage] || [];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this stage transition' });
    }

    const before = { stage: workflow.stage };
    workflow.stage = stage;
    workflow.lastModifiedBy = req.user._id;
    await workflow.save();

    // Release lock only after stage transition saved successfully
    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    const populated = await OperationsWorkflow.findById(workflow._id)
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName')
      .populate('lockedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'workflow_stage_change',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before, after: { stage } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitPerRole('workflow:stageChanged', (r) => stripRowFor(r, populated)); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json(populated);
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({ message: 'Failed to update workflow stage' });
  }
};

// POST /api/workflows/:id/lock
exports.lockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    workflow.lockedBy = req.user._id;
    workflow.lockedByName = `${req.user.firstName} ${req.user.lastName}`;
    workflow.lockedAt = new Date();
    await workflow.save();

    try {
      emitToAll('workflow:locked', {
        _id: workflow._id,
        lockedBy: { _id: req.user._id, firstName: req.user.firstName, lastName: req.user.lastName },
        lockedByName: workflow.lockedByName,
        lockedAt: workflow.lockedAt,
      });
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row locked successfully' });
  } catch (error) {
    console.error('Lock workflow error:', error);
    res.status(500).json({ message: 'Failed to lock workflow' });
  }
};

// POST /api/workflows/:id/unlock
exports.unlockWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    // Only the locker or super_admin can unlock
    if (
      workflow.lockedBy &&
      workflow.lockedBy.toString() !== req.user._id.toString() &&
      !require('../config/constants').isTopRole(req.user.role) && !isFinanceFull(req.user.role)
    ) {
      return res.status(403).json({ message: 'Only the locking user or super admin can unlock' });
    }

    workflow.lockedBy = null;
    workflow.lockedByName = '';
    workflow.lockedAt = null;
    await workflow.save();

    try { emitToAll('workflow:unlocked', { _id: workflow._id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Row unlocked successfully' });
  } catch (error) {
    console.error('Unlock workflow error:', error);
    res.status(500).json({ message: 'Failed to unlock workflow' });
  }
};

// DELETE /api/workflows/:id
exports.deleteWorkflow = async (req, res) => {
  try {
    const workflow = await OperationsWorkflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({
        message: `This record is currently being edited by ${workflow.lockedByName || 'another user'}`,
      });
    }

    await require('../services/shipmentOrderWorkflowLink').deleteShipments({ rows: [workflow] });

    await logAudit({
      user: req.user._id,
      action: 'delete_workflow',
      entity: 'OperationsWorkflow',
      entityId: req.params.id,
      changes: { before: workflow.toObject() },
      ipAddress: req.ip,
    });

    bustFilterCache();
    try { emitToAll('workflow:deleted', { _id: req.params.id }); } catch (e) { console.error('WebSocket emit error:', e); }

    res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Delete workflow error:', error);
    res.status(500).json({ message: 'Failed to delete workflow' });
  }
};

// PATCH /api/workflows/:id/application-status
/**
 * Order status is changed from the workflow table and written to the platform, not here. applicationStatus is a mirror column that the platform writes and rewrites at every sync, so a local-only write would be erased within minutes, which is what happened to anyone editing it from the table: it changed and then reverted.
 * The write goes to its source: PATCH /admin/shipments/status on the platform, then the shipment is read back, our row is written with what settled there, and broadcast. So the workflow table and the orders page show the same thing at the same moment, and the platform with them. A report not from the platform has no order status to change here.
 */
const UPL_STATUSES = [
  'requesting', 'loading', 'uploaded', 'on_way', 'arrived',
  'bond_sent', 'bond_received', 'late', 'invoiced', 'cancelled',
];

/**
 * Pushes the order status to the platform, then reads what settled there. A separate function because the workflow table calls it when staff change it by hand and the wallet calls it when a purchase is recorded on a report (a purchase declares the bond in hand). Duplicating the logic would give two ways to write the status: one pushes to the platform and re-syncs, the other writes locally and is erased by the first sync.
 * Returns what settled, or null if the report is not from the platform at all.
 */
/** Same move where no platform answers: a row owned by a shipment created here, or any row once the link is off. `null` otherwise. */
async function setLocalStatus(workflow, status, actor) {
  const row = await OperationsWorkflow.findById(workflow._id).select('shipmentOrder fleetShipment applicationStatus externalSource').lean();
  const linkOff = !require('../services/uplClient').isConfigured();
  if (!row?.shipmentOrder && !row?.fleetShipment && !(linkOff && row?.externalSource === 'ops_upl')) return null;
  const before = String(row.applicationStatus || '');
  if (before === status) return { applicationStatus: status, unchanged: true };
  await OperationsWorkflow.updateOne({ _id: workflow._id }, { $set: { applicationStatus: status, executionStatus: status } });
  const link = require('../services/shipmentOrderWorkflowLink');
  await (row.shipmentOrder || row.fleetShipment ? link.pullWorkflow(workflow._id, actor) : link.pullPlatformRow(workflow._id, ['applicationStatus']));
  bustFilterCache();
  try { emitToAll('workflow:bulkImported', { source: 'shipment_orders', live: true, write: true }); } catch (e) { /* */ }
  if (actor) {
    await logAudit({
      user: actor._id || actor,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before: { applicationStatus: before }, after: { applicationStatus: status } },
    });
  }
  return OperationsWorkflow.findById(workflow._id).lean();
}

async function pushApplicationStatus(workflow, status, actor) {
  if (!UPL_STATUSES.includes(status)) throw new Error(`حالةٌ غير معروفة: ${status}`);
  if (workflow.externalSource !== 'ops_upl' || !workflow.externalId || !require('../services/uplClient').isConfigured()) {
    return setLocalStatus(workflow, status, actor);
  }
  if (String(workflow.applicationStatus || '') === status) return { applicationStatus: status, unchanged: true };

  const before = String(workflow.applicationStatus || '');
  const upl = require('../services/uplClient');
  await upl.patch('/admin/shipments/status', { body: { status, ids: [String(workflow.externalId)] } });

  const { syncShipmentsById } = require('../services/opsWorkflowSyncService');
  const out = await syncShipmentsById([String(workflow.externalId)]);
  const row = (out.rows || [])[0] || null;

  try { cache.clear('ops:'); } catch (e) { /* */ }
  bustFilterCache();
  try {
    emitToAll('ops:shipments:changed', {
      resource: 'shipments', action: 'status', ids: [String(workflow.externalId)], status, at: Date.now(),
    });
  } catch (e) { /* */ }
  if (actor) {
    await logAudit({
      user: actor._id || actor,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before: { applicationStatus: before }, after: { applicationStatus: row?.applicationStatus || status } },
    });
  }
  return row || { applicationStatus: status };
}
exports.pushApplicationStatus = pushApplicationStatus;
exports.STATUS_ROLES = STATUS_ROLES;

exports.updateApplicationStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!UPL_STATUSES.includes(status)) {
      return res.status(400).json({ message: `حالةٌ غير معروفة: ${status || '(فارغة)'}` });
    }
    // Whoever owns the status column in the table owns changing it: the same map.
    const allowed = await fieldsForRole(req.user.role);
    if (!allowed.includes('applicationStatus')) {
      return res.status(403).json({ message: 'صلاحيّتك لا تسمح بتغيير حالة الشحنة.' });
    }

    const workflow = await OperationsWorkflow.findById(req.params.id)
      .select('externalSource externalId shipmentOrder fleetShipment applicationStatus reportNumber lockedBy lockedByName lockedAt');
    if (!workflow) return res.status(404).json({ message: 'Workflow not found' });
    if (isLocked(workflow, req.user._id)) {
      return res.status(423).json({ message: `أمر النقل مفتوحٌ لدى ${workflow.lockedByName || 'مستخدمٍ آخر'}` });
    }
    if (workflow.shipmentOrder || workflow.fleetShipment || !require('../services/uplClient').isConfigured()) {
      const row = await setLocalStatus(workflow, status, req.user);
      if (!row) return res.status(400).json({ message: 'هذا أمر النقل لا حالةَ طلبٍ له تُغيَّر.' });
      return res.json(row.unchanged ? { _id: workflow._id, applicationStatus: status, unchanged: true } : stripRowFor(req.user.role, row));
    }
    if (workflow.externalSource !== 'ops_upl' || !workflow.externalId) {
      return res.status(400).json({
        message: 'هذا أمر النقل ليس من منصّة التشغيل — لا حالةَ طلبٍ له تُغيَّر.',
      });
    }
    if (String(workflow.applicationStatus || '') === status) {
      return res.json({ _id: workflow._id, applicationStatus: status, unchanged: true });
    }

    const before = String(workflow.applicationStatus || '');
    const upl = require('../services/uplClient');
    await upl.patch('/admin/shipments/status', {
      body: { status, ids: [String(workflow.externalId)] },
    });

    // What settled on the platform is what is shown, not what was requested.
    const { syncShipmentsById } = require('../services/opsWorkflowSyncService');
    const out = await syncShipmentsById([String(workflow.externalId)]);
    const row = (out.rows || [])[0] || null;

    try { cache.clear('ops:'); } catch (e) { /* */ }
    bustFilterCache();
    try {
      emitToAll('ops:shipments:changed', {
        resource: 'shipments', action: 'status', ids: [String(workflow.externalId)], status, at: Date.now(),
      });
    } catch (e) { /* */ }

    await logAudit({
      user: req.user._id,
      action: 'update_workflow',
      entity: 'OperationsWorkflow',
      entityId: workflow._id,
      changes: { before: { applicationStatus: before }, after: { applicationStatus: row?.applicationStatus || status } },
      ipAddress: req.ip,
    });

    // The response is stripped as the list is: it is the copy of the row that replaces the old one.
    res.json(row ? stripRowFor(req.user.role, row) : { _id: workflow._id, applicationStatus: status });
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error('updateApplicationStatus:', error.message);
    res.status(status).json({ message: error.message || 'تعذّر تغيير حالة الشحنة في منصّة التشغيل' });
  }
};

// POST /api/workflows/bulk-delete
/**
 * Bulk update: one field on many reports. The collections team receives a batch of bonds in one day with one payment date and one branch, and used to open a hundred rows and write the same date a hundred times; repeated writing is also a hundred chances for an error.
 * It is not a loop of calls from the screen (a hundred rows would be a hundred parallel requests on a constrained cluster). It is one request here under the same rules, field permission and 'no payment before the bond', and each row returns its reason if rejected, so 'done' is never said when half was not.
 */
/**
 * All filter results: the same conditions and the count the user saw. The table shows fifty per page while the filter may return 37,000, so the table's own conditions (query) are sent and everything matching is extracted with the function the table reads rows with, so nothing is written to what the filter owner cannot see.
 * The cap was one thousand, which made changing one large customer's payment type impossible except by cutting the filter by hand. It is now a safety cap, not a work cap (ALL_MATCHING_CAP), and the real condition is the count the user confirmed (expectedCount): if the filter now matches more than the confirmation window showed (sync added reports meanwhile), the request is rejected with the new count for re-confirmation, so no report is written that was not displayed.
 */
const ALL_MATCHING_CAP = 60000;
const IDS_CAP = 1000;

async function idsForAllMatching(body, role) {
  const q = Object.fromEntries(Object.entries(body.query || {}).filter(([k]) => !['page', 'limit', 'sort', 'order', 'scope'].includes(k)));
  if (q.cf_dataOwnerShown !== undefined) await require('../utils/dataOwnerIndex').ensure().catch(() => {});
  const filter = buildWorkflowFilter(q, undefined, canSeeMoney(role), canSeeSelling(role));
  const found = await OperationsWorkflow.find(filter).select('_id').limit(ALL_MATCHING_CAP + 1).lean();
  if (found.length > ALL_MATCHING_CAP) {
    return { error: { status: 400, body: { message: `نتائجُ الفلتر أكثرُ من ${ALL_MATCHING_CAP.toLocaleString('en-US')} أمر نقل — ضيِّق الفلتر ثمّ أعِد.` } } };
  }
  const expected = Number(body.expectedCount);
  if (Number.isFinite(expected) && expected >= 0 && found.length > expected) {
    return {
      error: {
        status: 409,
        body: {
          code: 'COUNT_CHANGED', count: found.length, expectedCount: expected,
          message: `تغيّرت نتائجُ الفلتر: صارت ${found.length} بدل ${expected} — لم يُحفظ شيء. أكِّد العددَ الجديد ثمّ أعِد.`,
        },
      },
    };
  }
  return { ids: found.map((x) => x._id) };
}
exports._idsForAllMatching = idsForAllMatching;

exports.bulkUpdate = async (req, res) => {
  try {
    let ids = Array.isArray(req.body.ids) ? req.body.ids.filter((x) => mongoose.isValidObjectId(x)) : [];
    const allMatching = !!(req.body.allMatching && req.body.query && typeof req.body.query === 'object');
    if (allMatching) {
      const r = await idsForAllMatching(req.body, req.user.role);
      if (r.error) return res.status(r.error.status).json(r.error.body);
      ids = r.ids;
    }
    if (!ids.length) return res.status(400).json({ message: 'لم تُحدَّد أيُّ أوامر نقل.' });
    if (!allMatching && ids.length > IDS_CAP) return res.status(400).json({ message: `الحدُّ الأقصى ${IDS_CAP} أمر نقل في المرّة — أو اختر «كلّ نتائج الفلتر».` });

    const patch = filterFieldsByRole(req.body.fields || {}, req.user.role, await fieldsForRole(req.user.role));
    const bulkBranchError = await require('../utils/branchList').applyBranchList(patch);
    if (bulkBranchError) return res.status(400).json({ message: bulkBranchError });
    // The same rules apply in bulk: nobody gains by selecting many what they lack singly. (Re-applied per row below because payment type differs between reports.)
    const refused = patch.__rejected || [];
    // Selling value is not written in bulk. Each report is written to the operations platform call by call (see pushSellingValue), and one price for a hundred reports of various customers and routes is not pricing. It is edited report by report.
    if (Object.prototype.hasOwnProperty.call(patch, 'sellingValue')) {
      delete patch.sellingValue;
      refused.push('sellingValue');
    }
    if (patch.username !== undefined) {
      const chk = await require('../utils/approvedCustomerName').checkCustomerName(patch.username, '');
      if (chk.error) return res.status(400).json({ code: 'CUSTOMER_NOT_APPROVED', message: chk.error });
      patch.username = chk.value;
    }
    const keys = Object.keys(patch);
    if (!keys.length) {
      return res.status(403).json({
        code: 'FIELDS_NOT_ALLOWED', fields: refused,
        message: `صلاحيّتك لا تسمح بتعديل: ${refused.join('، ')} — لم يُحفظ شيء.`,
      });
    }

    const wantsPayment = keys.includes('paymentDate') && patch.paymentDate && String(patch.paymentDate).trim();
    const rows = await OperationsWorkflow.find({ _id: { $in: ids } })
      // paymentTypeSource and what the type derives from: without them each row reads as 'not manual and not unified' and what a person chose or unified would be re-derived (see fillPaymentTypeFromCustomer).
      .select('reportNumber applicationStatus paymentType paymentSubtype paymentTypeSource paymentMethod reportDate tax netInvoice username lockedBy lockedByName lockedAt invoiceNumber').lean();

    // Rules are applied row by row. Payment type differs between reports, so one edit does not produce one change: a cash report in the batch drops the invoice columns and a tax report derives its tax from its net. One rule for all would have written an invoice on a cash customer.
    const skipped = []; const perRow = [];
    // Payment amount of a report the wallet paid stays the wallet's amount (see utils/walletPayment).
    const walletPaid = Object.prototype.hasOwnProperty.call(patch, 'paymentAmount')
      ? await require('../utils/walletPayment').walletPaidMap(rows.map((r) => r.reportNumber))
      : new Map();
    // Customer attributes once per batch (see partyTypes in fillPaymentTypeFromCustomer).
    let partyTypes = null;
    if (!keys.includes('paymentType') && !keys.includes('paymentSubtype') && rows.length > 50) {
      const CollectionsParty = require('../models/CollectionsParty');
      const names = [...new Set(rows.map((r) => CollectionsParty.fold(patch.username !== undefined ? patch.username : r.username || '')).filter(Boolean))];
      partyTypes = new Map();
      // First per key, as findOne takes in the single path.
      for (const p of await CollectionsParty.find({ kind: 'customer', nameKey: { $in: names } }).select('nameKey paymentType').lean()) {
        if (!partyTypes.has(p.nameKey)) partyTypes.set(p.nameKey, p.paymentType);
      }
    }
    for (const r of rows) {
      // A row being edited by someone else is not overwritten by a batch they cannot see.
      if (isLocked(r, req.user._id)) {
        skipped.push({ reportNumber: r.reportNumber, reason: `قيد التعديل لدى ${r.lockedByName || 'مستخدم آخر'}` });
        continue;
      }
      if (wantsPayment && String(r.applicationStatus || '').trim() !== 'bond_received') {
        skipped.push({ reportNumber: r.reportNumber, reason: 'لم يُستلم السند بعد' });
        continue;
      }
      const rowPatch = { ...patch };
      // Who wrote the payment date is recorded with it in the batch, as in the single edit.
      if (Object.prototype.hasOwnProperty.call(patch, 'paymentDate') && patch.paymentDate) {
        rowPatch.paymentDateBy = req.user._id;
        rowPatch.paymentDateByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
        rowPatch.paymentDateAt = new Date();
      }
      if (walletPaid.has(String(r.reportNumber || '').trim())) rowPatch.paymentAmount = walletPaid.get(String(r.reportNumber || '').trim());
      // Payment type is filled per row from its customer file: one batch holds various customers, and one rule for all would write an invoice on a cash customer.
      await fillPaymentTypeFromCustomer(rowPatch, r, partyTypes);
      stampInvoiceDate(rowPatch, r);
      const own = applyBillingRules(rowPatch, r);
      if (own.blocked.includes('invoiceNumber')) {
        skipped.push({ reportNumber: r.reportNumber, reason: 'أمر نقل نقديّ — ليس له رقم فاتورة' });
        continue;
      }
      if (own.blocked.length && !Object.keys(own.patch).length) {
        skipped.push({ reportNumber: r.reportNumber, reason: 'أمر نقل نقديّ — لا فاتورة له' });
        continue;
      }
      // Collection date or amount written by hand in the batch: the report no longer belongs to the wallet.
      if (['collectionDate', 'collectedAmount'].some((k) => Object.prototype.hasOwnProperty.call(own.patch, k))) {
        own.patch.collectedByWallet = false;
      }
      perRow.push({
        _id: r._id, patch: own.patch, reportNumber: r.reportNumber,
        typeBefore: r.paymentType || '', subBefore: r.paymentSubtype || '',
      });
    }

    let updated = 0;
    if (perRow.length) {
      // Rows taking the same edit are grouped into one write, so a hundred rows are not a hundred database trips.
      const byPatch = new Map();
      for (const t of perRow) {
        const k = JSON.stringify(t.patch);
        if (!byPatch.has(k)) byPatch.set(k, { patch: t.patch, ids: [] });
        byPatch.get(k).ids.push(t._id);
      }
      // Ids are chunked at five thousand per condition: 37,000 in a single $in is a heavy request on the cluster for no reason.
      const CHUNK = 5000;
      const ops = [];
      for (const g of byPatch.values()) {
        for (let i = 0; i < g.ids.length; i += CHUNK) {
          ops.push({
            updateMany: {
              filter: { _id: { $in: g.ids.slice(i, i + CHUNK) } },
              update: { $set: { ...g.patch, lastModifiedBy: req.user._id } },
            },
          });
        }
      }
      const results = await OperationsWorkflow.bulkWrite(ops, { ordered: false });
      updated = results.modifiedCount || 0;
      cache.clear('wf:');
      {
        const link = require('../services/shipmentOrderWorkflowLink');
        perRow.forEach((t) => link.pullSoon(t._id, req.user, Object.keys(t.patch)));
      }
      // Receipt number written in bulk: its reports are re-linked to clearance (bill of lading or container).
      if (keys.includes('documentNumber')) {
        await require('../services/customsOpsLink').resolveReports({ _id: { $in: perRow.map((t) => t._id) } })
          .catch((e) => console.error('customs link (workflow bulk):', e.message));
      }
      // An invoice number written in bulk creates its ledger entry as the single edit does, otherwise these invoices would be missing from collections entirely. See ensureLedgerInvoice.
      {
        const hit = perRow.filter((t) => LEDGER_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(t.patch, k)));
        if (hit.length) {
          // Both the old and the new number: the old one's entry is recomputed or removed.
          const oldNo = new Map(rows.map((r) => [String(r._id), r.invoiceNumber]));
          const fresh = await OperationsWorkflow.find({ _id: { $in: hit.map((t) => t._id) } }).select('invoiceNumber').lean();
          await syncOpsInvoices([...fresh.map((w) => w.invoiceNumber), ...hit.map((t) => oldNo.get(String(t._id)))]);
        }
      }
      // The collections ledger follows collection or delivery dates written in bulk, as in the single edit.
      {
        const has = (k) => perRow.some((t) => Object.prototype.hasOwnProperty.call(t.patch, k));
        const changed = { collectionDate: has('collectionDate'), deliveryDate: has('deliveryDate') };
        if (changed.collectionDate || changed.deliveryDate) {
          const touched = perRow.filter((t) => ['collectionDate', 'deliveryDate'].some((k) => Object.prototype.hasOwnProperty.call(t.patch, k))).map((t) => t._id);
          const fresh = await OperationsWorkflow.find({ _id: { $in: touched } }).select('invoiceNumber collectionDate deliveryDate').lean();
          await require('./collectionsDeptController').syncLedgerFromWorkflows(fresh, changed)
            .catch((e) => console.error('ledger sync (workflow bulk):', e.message));
        }
      }
      // Payment type changed in bulk: wallet collection is reconsidered for those reports.
      {
        const retyped = perRow.filter((t) => Object.prototype.hasOwnProperty.call(t.patch, 'paymentType')
          && String(t.patch.paymentType || '') !== t.typeBefore).map((t) => t.reportNumber);
        // Matching the wallet report by report is two trips per report; when reports are many, all entries (far fewer) are matched once in the background with the same result.
        if (retyped.length > 300) {
          require('../utils/walletCollection').resyncAllWalletCollections({ user: req.user, reason: 'تغيّر نوع أمر النقل' })
            .catch((e) => console.error('wallet cash-collection (workflow bulk, all):', e.message));
        } else if (retyped.length) {
          await require('../utils/walletCollection').syncWalletCollection(retyped, { user: req.user, reason: 'تغيّر نوع أمر النقل' })
            .catch((e) => console.error('wallet cash-collection (workflow bulk):', e.message));
        }
      }
      // Payment type (family or type) changed: the collections board cache is cleared before the broadcast.
      const kindMoved = perRow.some((t) => (Object.prototype.hasOwnProperty.call(t.patch, 'paymentType')
          && String(t.patch.paymentType || '') !== t.typeBefore)
        || (Object.prototype.hasOwnProperty.call(t.patch, 'paymentSubtype')
          && String(t.patch.paymentSubtype || '') !== t.subBefore));
      // Cells of the collections door too (operations review, payment date, and so on); see the single edit.
      const BULK_GATE = ['operationsReview', 'accountingReview', 'paymentDate', 'invoiceNumber', 'collectedAmount', 'collectionDate', 'cashCollectionStatus'];
      const gateMoved = kindMoved || perRow.some((t) => BULK_GATE.some((f) => Object.prototype.hasOwnProperty.call(t.patch, f)));
      if (gateMoved) invalidateCollectionsReaders();
      try { emitToAll('workflow:bulkImported', { bulkUpdate: true, updated }); } catch (e) {}
      if (gateMoved) {
        try { emitToAll('collections:changed', { source: 'workflow', field: kindMoved ? 'paymentType' : 'gate', bulk: true }); } catch (e) { /* */ }
      }
      // A batch is recorded with its reports and values. The log used to say only 'fifteen reports - paymentType', so which reports and to what was unknown when asked 'I changed it and it did not change'. Numbers and values are written with it.
      logAudit({
        user: req.user, action: 'bulk_update', entity: 'OperationsWorkflow',
        details: `${updated} أمر نقل · ${keys.join('، ')}`, ip: req.ip,
        changes: {
          details: `${updated} أمر نقل · ${keys.join('، ')}`,
          fields: Object.fromEntries(keys.map((k) => [k, patch[k]])),
          reports: perRow.slice(0, 2000).map((t) => t.reportNumber),
          skipped: skipped.slice(0, 500),
        },
      });
    }

    // The skipped list is truncated in the response (the full count is in skippedCount): ten thousand reasons cannot be read in a dialog and weigh the response down.
    res.json({
      updated,
      requested: ids.length,
      skipped: skipped.slice(0, 300),
      skippedCount: skipped.length,
      refusedFields: refused.length ? refused : undefined,
      message: skipped.length
        ? `حُفظ ${updated} من ${ids.length} — و${skipped.length} لم يُحفظ.`
        : `حُفظ ${updated} أمر نقل.`,
    });
  } catch (e) {
    console.error('bulkUpdate error:', e);
    res.status(500).json({ message: e.message || 'تعذّر التحديث الجماعي' });
  }
};

exports.bulkDelete = async (req, res) => {
  try {
    let { ids } = req.body;
    // All filter results here as in bulk update: same conditions and the count the user confirmed (see idsForAllMatching).
    const allMatching = !!(req.body.allMatching && req.body.query && typeof req.body.query === 'object');
    if (allMatching) {
      const r = await idsForAllMatching(req.body, req.user.role);
      if (r.error) return res.status(r.error.status).json(r.error.body);
      ids = r.ids;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array' });
    }
    if (!allMatching && ids.length > IDS_CAP) {
      return res.status(400).json({ message: `الحدُّ الأقصى ${IDS_CAP} أمر نقل في المرّة — أو اختر «كلّ نتائج الفلتر».` });
    }

    // Check for locked workflows
    const workflows = await OperationsWorkflow.find({ _id: { $in: ids } }).select('lockedBy lockedAt lockedByName shipmentOrder fleetShipment externalSource externalId').lean();
    const lockedIds = workflows.filter((w) => isLocked(w, req.user._id)).map((w) => w._id.toString());
    if (lockedIds.length > 0) {
      return res.status(423).json({ message: `${lockedIds.length} workflow(s) are locked and cannot be deleted` });
    }

    await require('../services/shipmentOrderWorkflowLink').deleteShipments({ rows: workflows });

    await logAudit({
      user: req.user._id,
      action: 'bulk_delete_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      // All ids up to one thousand; above that, its count and condition, not a megabyte record.
      changes: { before: { count: ids.length, ids: ids.slice(0, 1000), ...(allMatching ? { query: req.body.query } : {}) } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    // An event per row is reasonable for a page; for thousands, one event to which the list responds by reloading.
    if (ids.length > 200) {
      try { emitToAll('workflow:bulkImported', { bulkDelete: true, deleted: ids.length }); } catch (e) { /* */ }
    } else {
      ids.forEach((id) => {
        try { emitToAll('workflow:deleted', { _id: id }); } catch (e) { console.error('WebSocket emit error:', e); }
      });
    }

    res.json({ message: `${ids.length} workflow(s) deleted successfully`, deleted: ids.length });
  } catch (error) {
    console.error('Bulk delete workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk delete workflows' });
  }
};

// GET /api/workflows/export
/**
 * Workflow export: the file is built on the server and downloaded ready, instead of the screen requesting the whole table and building it. The bottleneck is the shared cluster transfer rate (about 0.1 MB/s), not the build or the query.
 * The unfiltered whole-table file is built once, kept on disk and served instantly; a stale file is served at once while a new one is built behind it, and its age is in the response header.
 * A filtered export is not stored since its condition differs per request.
 * Columns and translations are exactly those of the workflow page; only scope=all bypasses the filter.
 */
async function buildWorkflowWorkbook(filter, money, selling = true) {
  {
    const { SHIPMENT_STATUS_AR } = require('../config/constants');

    const PAYMENT_AR = { cash: 'كاش', late: 'آجل' };
    const STAGE_AR = {
      draft: 'مسودة', submitted_to_ops: 'مرسل للتشغيل', ops_completed: 'تم التشغيل',
      submitted_to_collections: 'مرسل للتحصيل', completed: 'مكتمل',
    };
    const d = (v) => (v ? new Date(v).toLocaleDateString('en-GB') : '');
    const st = (v) => SHIPMENT_STATUS_AR[v] || v || '';
    const yes = (v) => (v ? 'تمّت' : '');

    // The column and its reader in one line; the third flag means money not everyone sees.
    const COLUMNS = [
      ['رقم الطلب', (w) => w.reportNumber || ''],
      ['تاريخ الطلب', (w) => d(w.reportDate)],
      ['من', (w) => w.fromLocation || ''],
      ['إلى', (w) => w.toLocation || ''],
      ['الفرع', (w) => w.branch || ''],
      ['مالك السيارة', (w) => w.carOwner || w.ownerName || ''],
      ['جوال المالك', (w) => w.ownerPhone || ''],
      ['رقم السيارة', (w) => w.carNumber || ''],
      ['اسم السيارة', (w) => w.carName || ''],
      ['نوع الملكية', (w) => w.ownerType || ''],
      ['حالة التنفيذ', (w) => st(w.executionStatus)],
      ['حالة الشحنة', (w) => st(w.applicationStatus)],
      ['طريقة الدفع', (w) => PAYMENT_AR[w.paymentMethod] || w.paymentMethod || ''],
      ['العميل', (w) => w.username || ''],
      ['هاتف العميل', (w) => w.userPhone || ''],
      ['قيمة الشراء', (w) => w.purchaseValue || 0],
      ['قيمة البيع', (w) => w.sellingValue || 0, 'selling'],
      ['السائق', (w) => w.driverName || ''],
      ['جوال السائق', (w) => w.driverPhone || ''],
      ['نوع الشاحنة', (w) => w.truckType || ''],
      ['حجم الشاحنة', (w) => w.truckSize || ''],
      ['نوع الحمولة', (w) => w.loadType || ''],
      ['الكمية', (w) => w.quantity || ''],
      ['المندوب', (w) => w.representativeName || ''],
      ['مراجعة العمليات', (w) => yes(w.operationsReview)],
      ['تاريخ السداد', (w) => d(w.paymentDate)],
      ['مسؤول البيانات', (w) => w.paymentDateByName || ''],
      ['فرع السداد', (w) => w.payingBranch || ''],
      ['مبلغ السداد', (w) => w.paymentAmount || 0],
      // The six as shown in the cell; see paymentKindLabel.
      ['نوع الدفع', (w) => paymentKindLabel(w)],
      ['وجهة أمر النقل النهائية', (w) => w.finalReportDestination || ''],
      ['رقم المستند', (w) => w.documentNumber || ''],
      // The linked clearance transaction and its bill of lading; see services/customsOpsLink.
      ['معاملة التخليص', (w) => (w.customsLink && w.customsLink.clearance ? w.customsLink.refNumber || '' : '')],
      ['البوليصة', (w) => (w.customsLink && w.customsLink.clearance ? w.customsLink.blNumber || '' : '')],
      ['الحاويات', (w) => (w.customsLink && w.customsLink.clearance ? (w.customsLink.containers || []).join('، ') : '')],
      ['تاريخ الإرسال', (w) => d(w.sendingDate)],
      ['تاريخ التسليم للفرع', (w) => d(w.branchDeliveryDate)],
      ['تاريخ التسليم للعميل', (w) => d(w.deliveryDate)],
      ['مراجعة المحاسبة', (w) => yes(w.accountingReview)],
      ['رقم الفاتورة', (w) => w.invoiceNumber || ''],
      ['صافي الفاتورة', (w) => w.netInvoice || 0, 'money'],
      ['الضريبة', (w) => w.tax || 0, 'money'],
      ['إجمالي الفاتورة', (w) => w.totalInvoice || 0, 'money'],
      ['تاريخ الفاتورة', (w) => d(w.invoiceDate), 'money'],
      ['مبلغ التحصيل', (w) => w.collectedAmount || 0, 'money'],
      ['تاريخ التحصيل', (w) => d(w.collectionDate), 'money'],
      ['المرحلة', (w) => STAGE_AR[w.stage] || w.stage || ''],
    ];

    // The file is opened outside the system where there is no guard, so what is not shown on screen does not leave in it; otherwise hiding would be decoration bypassed by an export button. Selling value only for those in its list (see SELLING_ROLES).
    const cols = COLUMNS.filter(([, , tag]) => (tag !== 'money' || money) && (tag !== 'selling' || selling));
    const headers = cols.map(([h]) => h);

    // Fields with no column are not read: the query used to fetch the whole document including long free-text notes that never enter the file.
    const FIELDS = [
      'reportNumber', 'reportDate', 'fromLocation', 'toLocation', 'branch', 'carOwner',
      'carNumber', 'ownerType', 'executionStatus', 'applicationStatus', 'paymentMethod',
      'username', 'userPhone', 'purchaseValue', 'sellingValue', 'driverName', 'truckType',
      'truckSize', 'representativeName', 'operationsReview', 'paymentDate', 'payingBranch',
      'paymentType', 'paymentSubtype', 'finalReportDestination', 'documentNumber', 'sendingDate', 'branchDeliveryDate',
      'deliveryDate', 'accountingReview', 'invoiceNumber', 'netInvoice', 'tax',
      'totalInvoice', 'invoiceDate', 'collectionDate', 'stage', 'customsLink',
      'ownerName', 'ownerPhone', 'carName', 'driverPhone', 'loadType', 'quantity',
      'paymentDateByName', 'paymentAmount', 'collectedAmount',
    ].join(' ');

    // Rows are read as a stream, not in one batch. 35,000 documents in one array is a needless memory peak on a worker serving others at the same time; they are read row by row and converted at once to the file line, so only what will be written stays in memory.
    const aoa = [headers];
    // A large batch, not a hundred rows per trip: the default of 101 would mean about 350 database trips for a table this size, and round-trip cost dominates here, not disk reads.
    const cursor = OperationsWorkflow.find(filter).select(FIELDS)
      .sort({ createdAt: -1 }).lean().cursor({ batchSize: 5000 });
    const unnamed = [];
    for (let w = await cursor.next(); w != null; w = await cursor.next()) {
      aoa.push(cols.map(([, get]) => get(w)));
      if (!w.paymentDateByName) unnamed.push({ row: aoa.length - 1, rn: w.reportNumber });
    }
    // Same order as the screen: whoever wrote the date, then the wallet recorder.
    const ownerCol = headers.indexOf('مسؤول البيانات');
    const { walletRecorderMap } = require('../utils/walletPayment');
    const recorders = new Map();
    for (let i = 0; i < unnamed.length; i += 5000) {
      for (const [k, v] of await walletRecorderMap(unnamed.slice(i, i + 5000).map((u) => u.rn))) recorders.set(k, v);
    }
    for (const u of unnamed) aoa[u.row][ownerCol] = recorders.get(String(u.rn || '').trim()) || '';

    // compression shrinks the file to about a fifth, a difference of seconds on the network. Writing runs in a worker thread, otherwise this worker stops serving everyone for the duration (measured: a health request during an export took fourteen seconds). See xlsxBuilder.
    const buf = await require('../utils/xlsxBuilder').buildXlsx(aoa, {
      sheetName: 'العمليات',
      cols: headers.map((h) => ({ wch: Math.max(h.length + 4, 14) })),
    });
    return { buf, rows: aoa.length - 1 };
  }
}

// The whole-table store on disk. On disk and not in worker memory: production has two workers, and a memory per worker would mean two builds and two copies. The disk is shared between them.
const EXPORT_DIR = path.join(__dirname, '..', '..', 'uploads', 'exports');
const ALL_TTL_MS = 60 * 60 * 1000;
// Four copies, not two: with and without money, with and without selling value.
const allFile = (money, selling = true) => path.join(EXPORT_DIR, `operations-all${money ? '' : '-nomoney'}${selling ? '' : '-nosell'}.xlsx`);
let buildingAll = false;

async function refreshAllExport(money, selling = true) {
  if (buildingAll) return;
  buildingAll = true;
  try {
    const { buf, rows } = await buildWorkflowWorkbook({}, money, selling);
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    // Written to a temporary name then moved, so a reader during the write gets a complete old file and not a file half new and half old.
    const tmp = `${allFile(money, selling)}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, allFile(money, selling));
    console.log(`[workflowExport] بُني ملفُّ الجدول كلِّه: ${rows} صفًّا · ${(buf.length / 1048576).toFixed(1)}MB`);
  } catch (e) {
    console.error('[workflowExport] تعذّر البناء:', e.message);
  } finally {
    buildingAll = false;
  }
}

exports.exportWorkflows = async (req, res) => {
  try {
    const money = canSeeMoney(req.user.role);
    const selling = canSeeSelling(req.user.role);
    const wantsAll = String(req.query.scope || '') === 'all';
    const name = `operations-${new Date().toISOString().split('T')[0]}.xlsx`;
    const head = (len, ageMs) => {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${name}`);
      res.setHeader('Content-Length', String(len));
      // The file's age is declared and not hidden: someone who takes a one-hour-old copy can know it.
      if (ageMs != null) res.setHeader('X-Export-Age-Seconds', String(Math.round(ageMs / 1000)));
    };

    if (wantsAll) {
      const f = allFile(money, selling);
      let stat = null;
      try { stat = fs.statSync(f); } catch (e) { /* Not built yet */ }
      if (stat) {
        const age = Date.now() - stat.mtimeMs;
        // The stale file is delivered now and refreshed behind it: waiting is worse than an hour of age.
        if (age > ALL_TTL_MS) refreshAllExport(money, selling).catch(() => {});
        head(stat.size, age);
        return fs.createReadStream(f).pipe(res);
      }
      // First time: built now and stored, so nobody waits for it afterwards.
      const { buf } = await buildWorkflowWorkbook({}, money, selling);
      try {
        fs.mkdirSync(EXPORT_DIR, { recursive: true });
        fs.writeFileSync(allFile(money, selling), buf);
      } catch (e) { /* Failing to store does not prevent delivery */ }
      head(buf.length, 0);
      return res.send(buf);
    }

    // A filtered export is built on the spot; its condition belongs to its requester.
    const filter = buildWorkflowFilter(req.query, undefined, money, selling);
    const { buf } = await buildWorkflowWorkbook(filter, money, selling);
    head(buf.length, 0);
    return res.send(buf);
  } catch (error) {
    console.error('Export workflows error:', error);
    return res.status(500).json({ message: 'Failed to export workflows' });
  }
};

/** The same build for a background export request (controllers/exportJobsController). Columns and role-based hiding are identical here and there: one file whatever the path. */
exports.buildExportFile = async (query = {}, user = {}) => {
  const money = canSeeMoney(user.role);
  const selling = canSeeSelling(user.role);
  const all = String(query.scope || '') === 'all';
  const filter = all ? {} : buildWorkflowFilter(query, undefined, money, selling);
  const { buf, rows } = await buildWorkflowWorkbook(filter, money, selling);
  return { buf, rows, name: `operations-${new Date().toISOString().slice(0, 10)}.xlsx` };
};

exports.refreshAllExport = refreshAllExport;

// POST /api/workflows/bulk-import
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'rows must be a non-empty array' });
    }

    // Moderator can import application + manual_moderator fields
    const allowedImportFields = [...FIELD_GROUPS.application, ...FIELD_GROUPS.manual_moderator];

    const workflowsToCreate = rows.map((row) => {
      const workflow = {};
      allowedImportFields.forEach((field) => {
        if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
          workflow[field] = row[field];
        }
      });
      workflow.stage = 'draft';
      workflow.createdBy = req.user._id;
      workflow.lastModifiedBy = req.user._id;
      return workflow;
    });

    // Use save() instead of insertMany to trigger pre-save hooks (auto reportNumber)
    // and handle duplicates gracefully.
    // ONE $in resolves every duplicate up front — the per-row findOne was a
    // round trip per row (~200 imports ≈ 20s of pure latency at 90ms RTT).
    const wanted = workflowsToCreate.map((w) => w.reportNumber).filter(Boolean);
    const dupes = new Set(
      (await OperationsWorkflow.find({ reportNumber: { $in: wanted } }).select('reportNumber').lean())
        .map((w) => w.reportNumber)
    );
    const createdWorkflows = [];
    const skipped = [];
    for (const wfData of workflowsToCreate) {
      try {
        if (wfData.reportNumber && dupes.has(wfData.reportNumber)) {
          skipped.push(wfData.reportNumber);
          continue;
        }
        const wf = new OperationsWorkflow(wfData);
        await wf.save();
        createdWorkflows.push(wf);
      } catch (err) {
        if (err.code === 11000) {
          skipped.push(wfData.reportNumber || 'unknown');
          continue;
        }
        throw err;
      }
    }

    // Not copied to customers and invoices. Import used to create behind each row a customer record and an invoice in the removed workflow module and add to the receivable. The section is gone and the report is the only document: collections reads from it directly.

    // Reports that clearance named in transport fields, or whose bond is a transaction's bill of lading, are linked to it.
    if (createdWorkflows.length) {
      await require('../services/customsOpsLink').resolveReports({ _id: { $in: createdWorkflows.map((w) => w._id) } })
        .catch((e) => console.error('customs link (bulk import):', e.message));
    }

    const populated = await OperationsWorkflow.find({
      _id: { $in: createdWorkflows.map((w) => w._id) },
    })
      .populate('createdBy', 'firstName lastName')
      .populate('lastModifiedBy', 'firstName lastName');

    await logAudit({
      user: req.user._id,
      action: 'bulk_import_workflows',
      entity: 'OperationsWorkflow',
      entityId: null,
      changes: { after: { count: createdWorkflows.length } },
      ipAddress: req.ip,
    });

    bustFilterCache();
    // Rows in the broadcast are stripped per role as in the list; they used to go out complete to every socket, with money and selling value.
    try {
      emitPerRole('workflow:bulkImported', (r) => ({
        count: createdWorkflows.length,
        workflows: stripRowFor(r, populated),
      }));
    } catch (e) { console.error('WebSocket emit error:', e); }

    res.status(201).json({
      imported: createdWorkflows.length,
      skipped: skipped.length,
      skippedReports: skipped,
      workflows: stripRowFor(req.user.role, populated),
    });
  } catch (error) {
    console.error('Bulk import workflows error:', error);
    res.status(500).json({ message: 'Failed to bulk import workflows' });
  }
};

// GET /api/workflows/pending-by-customer/:customerId
exports.getPendingByCustomer = async (req, res) => {
  try {
    // The party comes from the collections record and not from Customer: that is a record of the removed workflow module, and this is the one the section knows and builds the customer file from.
    const CollectionsParty = require('../models/CollectionsParty');
    const party = await CollectionsParty.findById(req.params.customerId).select('name').lean();
    if (!party) {
      return res.status(404).json({ message: 'الطرف غير موجود' });
    }

    const workflows = await OperationsWorkflow.find({
      username: flexSpaceRegex(party.name),
      $and: [
        { $or: [{ paymentDate: null }, { paymentDate: '' }, { paymentDate: { $exists: false } }] },
        { $or: [{ invoiceNumber: null }, { invoiceNumber: '' }, { invoiceNumber: { $exists: false } }] },
      ],
    })
      .select('reportNumber reportDate fromLocation toLocation branch carOwner sellingValue stage createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ workflows: stripRowFor(req.user.role, workflows), total: workflows.length });
  } catch (error) {
    console.error('Get pending invoices by customer error:', error);
    res.status(500).json({ message: 'Failed to load pending invoices' });
  }
};

// Return field permissions info for the frontend
exports.getFieldPermissions = async (req, res) => {
  // roleAccess stays as is (screens read it by key), and myFields is added: the fields of this page's own reader, the only one that knows a created role.
  res.json({
    groups: FIELD_GROUPS,
    roleAccess: ROLE_FIELD_ACCESS,
    myFields: await fieldsForRole(req.user.role),
    // What this reader may see, independent of what it may write.
    view: { amounts: canSeeMoney(req.user.role), selling: canSeeSelling(req.user.role) },
    // Selling-price edits from this reader go to approval; and whether this reader approves them.
    sellingByRequest: sellingByRequest(req.user),
    canApproveSelling: canApproveSelling(req.user),
    // The 'link to clearance transaction' button is shown to whoever has it; the server checks it again.
    canLinkCustoms: await canLinkCustoms(req.user.role),
  });
};

// One filter condition for everything that reads these reports. The private operations page shows the same reports with our selling price; if it built its own condition, the two tables would split at the first edit here (rows on one screen not on the other, a total not equal to a total). So the function is exported and the condition is read from one place.
module.exports.buildWorkflowFilter = buildWorkflowFilter;
module.exports.isLocked = isLocked;
module.exports.primeRelatedSearch = primeRelatedSearch;
module.exports.pageOfReports = pageOfReports;
module.exports.SEARCH_HINTS = SEARCH_HINTS;
// Hiding money columns is also single: the private page shows all report columns, and whoever lacks the invoice here lacks it there.
module.exports.canSeeMoney = canSeeMoney;
module.exports.AMOUNT_FIELDS = AMOUNT_FIELDS;
module.exports.MONEY_VIEW_ROLES = MONEY_VIEW_ROLES;
module.exports.fieldsForRole = fieldsForRole;
module.exports.stripMoneyFor = stripMoneyFor;
module.exports.canSeeSelling = canSeeSelling;
module.exports.SELLING_ROLES = SELLING_ROLES;
// The report is shown whole on the clearance transaction page, with the same hiding and fields.
module.exports.stripRowFor = stripRowFor;
module.exports.FULL_FIELDS = FULL_FIELDS;

/** Whether this role reaches PUT /api/workflows/:id and has at least one field accepted. Another screen (the clearance transaction page) shows an edit button on the report and saves through the same endpoint, so it asks what the whole route asks: the operations section guard (sectionGate) with its matrix and default (view does not write, none blocks), then the route's role list, then the role's fields. So no button appears that is rejected every time. */
async function canWriteWorkflows(role) {
  const fields = await fieldsForRole(role);
  if (!fields.length) return { canEdit: false, fields };
  const { FULL_ACCESS_ROLES } = require('../config/constants');
  if (FULL_ACCESS_ROLES.includes(role)) return { canEdit: true, fields };
  try {
    const { getOverride, liftFinance } = require('../utils/permissions');
    const { defaultAccess } = require('../config/sections');
    const saved = await getOverride(role, 'Operations');
    const access = saved == null ? liftFinance(role, defaultAccess(role, 'Operations')) : saved;
    if (access === 'edit') return { canEdit: true, fields };
    // No grant and no default: the route's roles line decides, and all the map's roles are in it.
    if (saved == null && access === 'none') return { canEdit: !!ROLE_FIELD_ACCESS[role], fields };
    return { canEdit: false, fields };
  } catch (e) {
    return { canEdit: false, fields };
  }
}
module.exports.canWriteWorkflows = canWriteWorkflows;
module.exports.syncOpsInvoices = syncOpsInvoices;

// Invoice checks - GET /api/workflows/invoice-checks[/:kind]
// Invoice numbers, values and customer names: only for those who have the money columns.
exports.invoiceChecks = async (req, res) => {
  try {
    if (!canSeeMoney(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    res.json(await require('../services/invoiceChecksService').summary());
  } catch (e) {
    console.error('invoiceChecks:', e);
    res.status(500).json({ message: 'تعذّر حساب فحوص الفواتير' });
  }
};
exports.invoiceCheckList = async (req, res) => {
  try {
    if (!canSeeMoney(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    const rows = await require('../services/invoiceChecksService').list(String(req.params.kind || ''));
    if (!rows) return res.status(404).json({ message: 'فحصٌ غير معروف' });
    res.json({ kind: req.params.kind, rows, total: rows.length });
  } catch (e) {
    console.error('invoiceCheckList:', e);
    res.status(500).json({ message: 'تعذّر جلب القائمة' });
  }
};

// Upload invoice data from Excel - POST /api/workflows/import-invoices
/**
 * Sales sheet from the accounting system: one row per report. The shipping order column is our report number, alongside bond, invoice number, net, tax, total and date, written to each report in one batch.
 * Columns are read by name; the customer column is not read. For a repeated report number the last row wins and overwrites the report.
 * Each row passes the single-edit rules (permission, lock by someone else, payment type, tax derivation); a tax invoice number reaches collections at once (syncOpsInvoices).
 * apply: false returns a preview only: what will and will not be written and why.
 */
exports.importInvoices = async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const dataUrl = String(req.body.dataUrl || '');
    const m = dataUrl.match(/^data:[^;]*;base64,(.*)$/);
    if (!m) return res.status(400).json({ message: 'ارفع ملفّ إكسل' });
    let wb;
    try { wb = XLSX.read(Buffer.from(m[1], 'base64'), { type: 'buffer', cellDates: false }); }
    catch (_) { return res.status(400).json({ message: 'الملفّ ليس إكسل صالحًا' }); }

    const norm = (s) => String(s ?? '').replace(/[ \s]+/g, ' ').trim();
    const fold = (s) => norm(s).replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '');
    const COLS = {
      reportNumber: ['امرالشحن', 'رقمالكشف', 'رقمكشفالتخريج'],
      documentNumber: ['السند', 'رقمالسند'],
      invoiceNumber: ['رقمالفاتوره'],
      netInvoice: ['اجماليالسعر', 'صافيالفاتوره'],
      totalInvoice: ['المجموعالصافي', 'اجماليالفاتوره'],
      tax: ['ضريبهالبند', 'الضريبه'],
      invoiceDate: ['التاريخ', 'تاريخالفاتوره'],
      // The customer is not written to the report (it comes from the report); it is kept with the sheet row to compare with the report's customer (the customer name mismatch card).
      customerName: ['العميل', 'اسمالعميل'],
    };
    // Any column named like a table column is written likewise (company owner). The customer delivery date in the file is written to the same column on its report, and so are the other hand-written table columns, with their page names in the log. (What comes from the platform is not written from a file; selling value is written to the platform with it, so from the table.)
    const EXTRA = [
      { field: 'paymentDate', type: 'date', names: ['تاريخ السداد', 'Payment date'] },
      { field: 'payingBranch', type: 'text', names: ['الفرع المسدد', 'الفرع المسدِّد', 'فرع السداد', 'Paying branch'] },
      { field: 'paymentAmount', type: 'num', names: ['مبلغ السداد', 'Payment amount'] },
      { field: 'paymentType', type: 'payment', names: ['نوع الدفع', 'نوع السداد', 'Payment type'] },
      { field: 'finalReportDestination', type: 'text', names: ['وجهة الكشف النهائية', 'Final report destination', 'Final destination'] },
      { field: 'sendingDate', type: 'date', names: ['تاريخ الارسال', 'تاريخ الإرسال', 'Sending date'] },
      { field: 'branchDeliveryDate', type: 'date', names: ['تاريخ التسليم للفرع', 'Branch delivery date'] },
      { field: 'deliveryDate', type: 'date', names: ['تاريخ التسليم للعميل', 'Customer delivery date', 'Delivery date'] },
      { field: 'invoiceNotes', type: 'text', names: ['ملاحظات الفاتورة', 'Invoice notes'] },
      { field: 'collectedAmount', type: 'num', names: ['مبلغ التحصيل', 'المبلغ المحصل', 'المبلغ المحصَّل', 'Collected amount'] },
      { field: 'collectionDate', type: 'date', names: ['تاريخ التحصيل', 'Collection date'] },
    ].map((x) => ({ ...x, keys: x.names.map((n) => fold(n).toLowerCase()) }));
    // Payment type with its six names as displayed; the four are what is chosen.
    const PAY = { 'اجل-فاتوره': 'deferred_invoice', 'اجل-كاش': 'deferred_cash', 'نقدي-3pl': 'cash_3pl', 'نقدي-ht': 'cash_ht', 'ضريبي': 'tax', 'كاش': 'cash',
      'deferred–invoice': 'deferred_invoice', 'deferred–cash': 'deferred_cash', 'cash–3pl': 'cash_3pl', 'cash–ht': 'cash_ht', 'tax': 'tax', 'cash': 'cash' };
    const payOf = (v) => { const k = fold(v).toLowerCase().replace(/[-–]/g, (c) => (c === '–' ? '–' : '-')); return PAY[k] || PAY[k.replace(/-/g, '–')] || ''; };
    const num = (v) => {
      if (v === null || v === undefined || v === '') return undefined;
      const n = Number(String(v).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/,/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
    };
    const text = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'number' ? String(Math.round(v)) : norm(v);
      return s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
    };
    // The date is a serial number in Excel, read by its parts (not cellDates, which loses a day). See xlsx-date-epoch.
    const date = (v) => {
      if (v === null || v === undefined || v === '') return undefined;
      if (typeof v === 'number') {
        const p = XLSX.SSF.parse_date_code(v);
        return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : undefined;
      }
      const s = norm(v);
      let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (mm) return new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3]));
      mm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
      if (mm) return new Date(Date.UTC(+mm[3], +mm[2] - 1, +mm[1]));
      return undefined;
    };

    // Rows are read from every sheet that has the shipping order column.
    const byReport = new Map(); let fileRows = 0; const badRows = [];
    // The sheet rows as they came are stored after applying: (invoice, report), last wins as in byReport. See services/invoiceChecksService.
    const lineMap = new Map();
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
      const hi = aoa.findIndex((r) => (r || []).some((c) => COLS.reportNumber.includes(fold(c))));
      if (hi < 0) continue;
      const head = aoa[hi].map(fold);
      const at = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
      const headLower = head.map((h) => String(h).toLowerCase());
      const extraAt = EXTRA.map((x) => ({ ...x, i: headLower.findIndex((h) => x.keys.includes(h)) })).filter((x) => x.i >= 0);
      for (let i = hi + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const rep = text(r[at.reportNumber]);
        if (!rep) continue;
        fileRows += 1;
        const patch = {};
        if (at.documentNumber >= 0 && text(r[at.documentNumber])) patch.documentNumber = text(r[at.documentNumber]);
        if (at.invoiceNumber >= 0 && text(r[at.invoiceNumber])) patch.invoiceNumber = text(r[at.invoiceNumber]);
        if (at.netInvoice >= 0 && num(r[at.netInvoice]) !== undefined) patch.netInvoice = num(r[at.netInvoice]);
        if (at.tax >= 0 && num(r[at.tax]) !== undefined) patch.tax = num(r[at.tax]);
        if (at.totalInvoice >= 0 && num(r[at.totalInvoice]) !== undefined) patch.totalInvoice = num(r[at.totalInvoice]);
        if (at.invoiceDate >= 0 && date(r[at.invoiceDate])) patch.invoiceDate = date(r[at.invoiceDate]);
        for (const x of extraAt) {
          const v = r[x.i];
          if (v === null || v === undefined || String(v).trim() === '') continue; // An empty cell does not erase
          if (x.type === 'date') { const d = date(v); if (d) patch[x.field] = d; }
          else if (x.type === 'num') { const n = num(v); if (n !== undefined) patch[x.field] = n; }
          else if (x.type === 'payment') { const p = payOf(v); if (p) patch.paymentType = p; }
          else { const tv = norm(v); if (tv) patch[x.field] = tv; }
        }
        if (!Object.keys(patch).length) { badRows.push({ reportNumber: rep, reason: 'لا بيانات في الصفّ تُكتب' }); continue; }
        byReport.set(rep, { patch, sheetRow: i + 1, sheet: name }); // The last wins
        if (patch.invoiceNumber) {
          lineMap.set(`${patch.invoiceNumber}|${rep}`, {
            invoiceNumber: patch.invoiceNumber, reportNumber: rep,
            net: patch.netInvoice ?? null, tax: patch.tax ?? null, total: patch.totalInvoice ?? null,
            customerName: at.customerName >= 0 ? norm(r[at.customerName]) : '',
            invoiceDate: patch.invoiceDate || null, sheet: name, sheetRow: i + 1,
          });
        }
      }
    }
    if (!byReport.size) return res.status(400).json({ message: 'لم يُعثر على عمود «امر الشحن» أو لا صفوف فيه' });

    const allowed = await fieldsForRole(req.user.role);
    const reports = await OperationsWorkflow.find({ reportNumber: { $in: [...byReport.keys()] } })
      .select('reportNumber applicationStatus paymentType paymentSubtype paymentTypeSource paymentMethod reportDate tax netInvoice totalInvoice invoiceNumber invoiceDate documentNumber username lockedBy lockedByName lockedAt executionStatus '
        + 'paymentDate payingBranch paymentAmount finalReportDestination sendingDate branchDeliveryDate deliveryDate invoiceNotes collectedAmount collectionDate').lean();
    const found = new Map(reports.map((r) => [String(r.reportNumber).trim(), r]));

    const notFound = []; const skipped = []; const unchanged = []; const plan = [];
    for (const [rep, item] of byReport) {
      const r = found.get(rep);
      if (!r) { notFound.push(rep); continue; }
      if (isLocked(r, req.user._id)) { skipped.push({ reportNumber: rep, reason: `قيد التعديل لدى ${r.lockedByName || 'مستخدم آخر'}` }); continue; }
      const rowPatch = { ...item.patch };
      // Payment date is not written before bond receipt: the same rule as bulk update.
      if (rowPatch.paymentDate && String(r.applicationStatus || '').trim() !== 'bond_received') {
        delete rowPatch.paymentDate;
        if (!Object.keys(rowPatch).length) { skipped.push({ reportNumber: rep, reason: 'لم يُستلم السند بعد (تاريخ السداد)' }); continue; }
      }
      const own = filterFieldsByRole(rowPatch, req.user.role, allowed);
      const refused = own.__rejected || [];
      if (!Object.keys(own).length) { skipped.push({ reportNumber: rep, reason: `صلاحيّتك لا تسمح بـ: ${refused.join('، ')}` }); continue; }
      await fillPaymentTypeFromCustomer(own, r);
      stampInvoiceDate(own, r);
      const billed = applyBillingRules(own, r);
      if (billed.blocked.includes('invoiceNumber')) { skipped.push({ reportNumber: rep, reason: 'نوعٌ نقديٌّ في الملفّ مع رقم فاتورة — الرقمُ وحدَه يجعله «آجل - فاتورة»' }); continue; }
      const patch = billed.patch;
      const diff = Object.keys(patch).filter((k) => {
        const a = patch[k]; const b = r[k];
        if (a instanceof Date || b instanceof Date) return String(a ? new Date(a).toISOString().slice(0, 10) : '') !== String(b ? new Date(b).toISOString().slice(0, 10) : '');
        return String(a ?? '') !== String(b ?? '');
      });
      if (!diff.length) { unchanged.push(rep); continue; }
      plan.push({ _id: r._id, reportNumber: rep, patch, before: Object.fromEntries(diff.map((k) => [k, r[k] ?? null])), oldInvoice: r.invoiceNumber, refused });
    }

    const summary = {
      fileRows, reports: byReport.size, toUpdate: plan.length, unchanged: unchanged.length,
      notFound, skipped, badRows,
      sample: plan.slice(0, 15).map((p) => ({ reportNumber: p.reportNumber, before: p.before, after: Object.fromEntries(Object.keys(p.before).map((k) => [k, p.patch[k]])) })),
    };
    // Upload warnings: the three checks on this sheet's rows. In the preview the reports are read as they will be after applying (what will be written over what they hold), so no warning is raised for a difference that applying itself removes.
    const invChecks = require('../services/invoiceChecksService');
    const lines = [...lineMap.values()];
    if (!req.body.apply) {
      const overlay = new Map(plan.map((p) => [p.reportNumber, p.patch]));
      const checks = await invChecks.checkLines(lines, overlay);
      return res.json({ preview: true, ...summary, checks });
    }

    // Writing
    let updated = 0;
    for (const p of plan) {
      const r = await OperationsWorkflow.updateOne({ _id: p._id }, { $set: { ...p.patch, lastModifiedBy: req.user._id } });
      updated += r.modifiedCount || 0;
    }
    // All sheet rows are stored, including those with no report (which its card is built on).
    const uploadAt = new Date();
    const savedLines = await invChecks.persistLines(lines, {
      batchId: `${uploadAt.getTime().toString(36)}-${String(req.user._id).slice(-6)}`,
      fileName: String(req.body.fileName || '').slice(0, 200), at: uploadAt,
      userId: req.user._id, userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    });
    cache.clear('wf:');
    const fresh = await OperationsWorkflow.find({ _id: { $in: plan.map((p) => p._id) } }).select('invoiceNumber').lean();
    await syncOpsInvoices([...fresh.map((w) => w.invoiceNumber), ...plan.map((p) => p.oldInvoice)]);
    // The bond from the sheet may be a clearance transaction's bill of lading; see services/customsOpsLink.
    {
      const withDoc = plan.filter((p) => Object.prototype.hasOwnProperty.call(p.patch, 'documentNumber')).map((p) => p._id);
      if (withDoc.length) {
        await require('../services/customsOpsLink').resolveReports({ _id: { $in: withDoc } })
          .catch((e) => console.error('customs link (import invoices):', e.message));
      }
    }
    // Other columns written take effect as in bulk update.
    {
      const touched = (k) => plan.filter((p) => Object.prototype.hasOwnProperty.call(p.patch, k));
      const changed = { collectionDate: touched('collectionDate').length > 0, deliveryDate: touched('deliveryDate').length > 0 };
      if (changed.collectionDate || changed.deliveryDate) {
        const ids2 = [...new Set([...touched('collectionDate'), ...touched('deliveryDate')].map((p) => p._id))];
        const fr = await OperationsWorkflow.find({ _id: { $in: ids2 } }).select('invoiceNumber collectionDate deliveryDate').lean();
        await require('./collectionsDeptController').syncLedgerFromWorkflows(fr, changed).catch((e) => console.error('ledger sync (import):', e.message));
      }
      const retyped = touched('paymentType').map((p) => p.reportNumber);
      if (retyped.length) {
        await require('../utils/walletCollection').syncWalletCollection(retyped, { user: req.user, reason: 'تغيّر نوع أمر النقل' }).catch(() => {});
        invalidateCollectionsReaders();
        try { emitToAll('collections:changed', { source: 'workflow', field: 'paymentType', bulk: true }); } catch (_) { /* */ }
      }
    }
    const checks = await invChecks.checkLines(lines);
    try { emitToAll('workflow:bulkImported', { importInvoices: true, updated }); } catch (_) { /* */ }
    logAudit({
      user: req.user, action: 'import_invoices', entity: 'OperationsWorkflow',
      details: `رفع بيانات فواتير: ${updated} أمر نقل من ${byReport.size} في الملفّ (${notFound.length} غير موجود، ${skipped.length} لم يُكتب)`, ip: req.ip,
    });
    return res.json({ preview: false, updated, savedLines, ...summary, checks });
  } catch (e) {
    console.error('importInvoices:', e);
    res.status(500).json({ message: e.message || 'تعذّر رفع بيانات الفواتير' });
  }
};

// Linking a report to a clearance transaction by hand. The automatic evidence (the transaction's transport fields, and receipt number equal to a bill of lading or container) does not cover every report: many have no bond. The operations employee links it by hand after searching by transaction number, bill of lading or container. See services/customsOpsLink.

/** Who links and unlinks: whoever writes the receipt number or operations review in this table. */
async function canLinkCustoms(role) {
  if (['super_admin', 'admin', 'it_manager', 'it_specialist', 'operations_manager'].includes(role) || isFinanceFull(role)) return true;
  const f = await fieldsForRole(role);
  return f.includes('documentNumber') || f.includes('operationsReview');
}

/** GET /api/workflows/customs-search?q= - transactions matching its number, bill of lading or container. */
exports.customsSearch = async (req, res) => {
  try {
    const CustomsClearance = require('../models/CustomsClearance');
    const link = require('../services/customsOpsLink');
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ clearances: [] });
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const k = link.normKey(q);
    // Bill of lading and container are written with or without spaces and dashes, so the search uses letters and digits only.
    const loose = k ? k.split('').join('[\\s\\-/._]*') : '';
    const or = [{ refNumber: { $regex: esc, $options: 'i' } }, { customerName: { $regex: esc, $options: 'i' } }];
    if (loose) or.push({ blNumber: { $regex: loose, $options: 'i' } }, { 'containers.containerNumber': { $regex: loose, $options: 'i' } });
    const rows = await CustomsClearance.find({ $or: or, cancelled: { $ne: true } })
      .select('refNumber blNumber customerName containerCount cargoType stage containers.containerNumber isCompleted upcoming')
      .sort({ createdAt: -1 }).limit(15).lean();
    res.json({
      clearances: rows.map((c) => ({
        _id: String(c._id), refNumber: c.refNumber || '', blNumber: c.blNumber || '',
        customerName: c.customerName || '', containerCount: c.containerCount || 0, cargoType: c.cargoType || 'containers',
        stage: c.stage || '', isCompleted: !!c.isCompleted, upcoming: !!c.upcoming,
        containers: (c.containers || []).map((u) => u.containerNumber).filter(Boolean),
      })),
    });
  } catch (e) {
    console.error('customs search', e);
    res.status(500).json({ message: 'تعذّر البحث في معاملات التخليص' });
  }
};

async function afterLinkWrite(req, wf, link, kind) {
  // One shipment, one link: the Shipments screen hears a link made here, and its empty
  // B/L and container fill from the clearance.
  if (wf.shipmentOrder) {
    const row = await OperationsWorkflow.findById(wf._id).select('customsLink').lean();
    await require('../models/ShipmentOrder').updateOne({ _id: wf.shipmentOrder }, { $set: { customsLink: row.customsLink } });
    await link.afterShipmentSaved(wf.shipmentOrder).catch((e) => console.error('customs link → shipment:', e.message));
  }
  const populated = await OperationsWorkflow.findById(wf._id)
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName')
    .populate('lockedBy', 'firstName lastName');
  // The cache is cleared then broadcast, inside announce.
  link.announce({ reportNumbers: [wf.reportNumber], clearanceIds: kind.clearanceIds });
  try { emitPerRole('workflow:updated', (r) => stripRowFor(r, populated)); } catch (_) { /* */ }
  await logAudit({
    user: req.user._id, action: kind.action, entity: 'OperationsWorkflow', entityId: wf._id,
    changes: { before: { customsLink: wf.customsLink || null }, after: { customsLink: populated.customsLink || null } }, ipAddress: req.ip,
  });
  return stripRowFor(req.user.role, populated);
}

/** PUT /api/workflows/:id/customs-link {clearanceId, containers?} - manual link. */
exports.setCustomsLink = async (req, res) => {
  try {
    if (!(await canLinkCustoms(req.user.role))) return res.status(403).json({ message: 'صلاحيّتك لا تسمح بربط الكشف بمعاملة تخليص' });
    const id = String(req.body.clearanceId || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'اختر معاملةَ التخليص' });
    const CustomsClearance = require('../models/CustomsClearance');
    const c = await CustomsClearance.findById(id).select('refNumber blNumber customerName containers.containerNumber cancelled').lean();
    if (!c || c.cancelled) return res.status(404).json({ message: 'معاملةُ التخليص غيرُ موجودة' });
    const wf = await OperationsWorkflow.findById(req.params.id).select('reportNumber customsLink shipmentOrder').lean();
    if (!wf) return res.status(404).json({ message: 'أمر النقل غير موجود' });
    const known = new Set((c.containers || []).map((u) => String(u.containerNumber || '').trim()).filter(Boolean));
    const containers = (Array.isArray(req.body.containers) ? req.body.containers : [])
      .map((x) => String(x || '').trim()).filter((x) => known.has(x));
    const link = require('../services/customsOpsLink');
    const next = {
      clearance: c._id, refNumber: c.refNumber || '', blNumber: c.blNumber || '', customerName: c.customerName || '',
      containers: [...new Set(containers)].sort(), via: 'manual', at: new Date(),
      byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    };
    await OperationsWorkflow.updateOne({ _id: wf._id }, { $set: { customsLink: next, lastModifiedBy: req.user._id } });
    const before = wf.customsLink && wf.customsLink.clearance ? [String(wf.customsLink.clearance)] : [];
    const out = await afterLinkWrite(req, wf, link, { action: 'link_workflow_customs', clearanceIds: [...new Set([...before, id])] });
    res.json(out);
  } catch (e) {
    console.error('set customs link', e);
    res.status(500).json({ message: 'تعذّر ربط الكشف بمعاملة التخليص' });
  }
};

/**
 * DELETE /api/workflows/:id/customs-link - unlink.
 * What the clearance section wrote in the transport field is not unlinked from here; it is corrected in the transaction itself, otherwise the link returns at its first save with no clue why.
 */
exports.clearCustomsLink = async (req, res) => {
  try {
    if (!(await canLinkCustoms(req.user.role))) return res.status(403).json({ message: 'صلاحيّتك لا تسمح بفكّ ربط أمر النقل' });
    const wf = await OperationsWorkflow.findById(req.params.id).select('reportNumber customsLink shipmentOrder').lean();
    if (!wf) return res.status(404).json({ message: 'أمر النقل غير موجود' });
    const cur = wf.customsLink || {};
    if (!cur.clearance) return res.status(400).json({ message: 'الكشفُ غيرُ مرتبطٍ بمعاملة تخليص' });
    if (cur.via === 'move') {
      return res.status(409).json({
        code: 'LINKED_FROM_CUSTOMS',
        message: `رقمُ هذا الكشف مكتوبٌ في خانة نقلٍ في المعاملة ${cur.refNumber || ''} — يُصحَّح من صفحة المعاملة في قسم التخليص.`,
      });
    }
    const link = require('../services/customsOpsLink');
    await OperationsWorkflow.updateOne({ _id: wf._id }, {
      $set: {
        customsLink: {
          clearance: null, refNumber: '', blNumber: '', customerName: '', containers: [], via: 'unlinked', at: new Date(),
          byName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
        },
        lastModifiedBy: req.user._id,
      },
    });
    const out = await afterLinkWrite(req, wf, link, { action: 'unlink_workflow_customs', clearanceIds: [String(cur.clearance)] });
    res.json(out);
  } catch (e) {
    console.error('clear customs link', e);
    res.status(500).json({ message: 'تعذّر فكّ الربط' });
  }
};

// For documentation (services/apiFieldScan): the fields accepted by create and update are the same list filterFieldsByRole filters with, a reference and not a copy, so it follows.
exports.createWorkflow.__docFields = { body: ALL_FIELDS };
exports.updateWorkflow.__docFields = { body: ALL_FIELDS };
