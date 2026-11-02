/**
 * Collection parties: customers we collect from and suppliers we pay.
 * A register rather than a name on the statement, because customer and vehicle-owner names are free text on each statement: one spelling variation splits a party (one supplier read 4528 and 1960 of 6488 statements). The register groups a party's rows and holds what the statement cannot: payment terms, collection status, follow-up owner, and the contact actually called.
 * Both kinds share one collection: same structure (name, contact, terms, balance), differing only in money direction, so two collections would duplicate every fix.
 */
const mongoose = require('mongoose');

/**
 * Folded name, the join key to operations statements.
 * Letters from other scripts (Persian/Urdu variants of Arabic letters) are folded on purpose: real data uses them in place of the Arabic ones, and without folding our biggest supplier stays split in two rows.
 */
const fold = (v) => String(v || '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
  .replace(/چ/g, 'ج').replace(/گ/g, 'ك').replace(/ڤ/g, 'ف').replace(/پ/g, 'ب')
  .replace(/[ً-ْـ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const collectionsPartySchema = new mongoose.Schema({
  kind: { type: String, enum: ['customer', 'supplier'], required: true, index: true },
  name: { type: String, required: true, trim: true, index: true },
  nameKey: { type: String, index: true },

  // Contact.
  // Whoever is called about an invoice is not necessarily who signed the contract; the three fields are separate because calling the owner about a voucher wastes a day.
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  // More than one email per customer; the account statement goes to all of them.
  // `email` stays the first for any reader (utils/partyEmails merges both).
  emails: { type: [String], default: [] },
  contactPerson: { type: String, trim: true, default: '' },
  contactPhone: { type: String, trim: true, default: '' },
  accountantName: { type: String, trim: true, default: '' },
  accountantPhone: { type: String, trim: true, default: '' },

  // Commercial identity
  commercialRegister: { type: String, trim: true, default: '' },
  taxNumber: { type: String, trim: true, default: '' },
  iban: { type: String, trim: true, default: '' },
  bankName: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  partyType: { type: String, trim: true, default: '' },

  // Accounting code: the account's identity.
  // Names vary and official forms change, but the code does not, so it is the key rather than the name. Tax accounts use the `1104xxxx` series and cash accounts `C####`; a new account takes the next number in its own series.
  // Account code = the customer's code (utils/customerCode), kept in step with the master by customerHub.
  code: { type: String, trim: true, default: '', set: (v) => require('../utils/customerCode').normCode(v) },

  // Other names.
  // The accounting name differs from the name written on operations statements (two spellings of one company are one account), so alternate forms are stored folded and used to map the statement to its account.
  aliases: [{ type: String, trim: true }],
  aliasKeys: [{ type: String, index: true }],

  // Account data in the collections register
  collectionOfficer: { type: String, trim: true, default: '', index: true }, // Responsible collections employee (name as displayed)
  /**
   * The officer is a system user, not a written name.
   * `collectionOfficer` is text from the ledger ("Hossam", "Orabi") that matches no single user, so "my accounts" cannot be known at login and assignment would not follow a renamed user. This reference is the assignment; the text stays for display and filters and is written from it. See utils/collectionsOfficer (reference takes precedence over text).
   */
  collectionOfficerUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  officer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },            // Legacy, nobody writes it
  hoLocation: { type: String, trim: true, default: '', index: true },        // Customer branch
  grade: { type: String, trim: true, default: '', index: true },             // A1 … C3
  salesManagers: [{ type: String, trim: true }],                             // May be handled by more than one rep
  department: { type: String, trim: true, default: '', index: true },        // Branches / Fleet / Customs Clearance
  region: { type: String, trim: true, default: '' },                         // Central / Western / …
  // Agreed payment term.
  // Counted from the invoice delivery date, not its issue date, since the customer cannot start counting before receiving it.
  creditDays: { type: Number, default: 0 },

  // Customer account type, not a rule about its shipments.
  // It says which ledger holds this account: cash in the cash register with a `C####` code, tax in the tax register with a `1104####` code. The code is generated from it and the aging register filtered by it.
  // It is not inferred as a statement's payment type: one customer says "charge me cash" on one load and "open an invoice" on another, so the type belongs to the shipment, and inference wrote values nobody stated. Seventeen customers are tax per the payment-type sheet yet sit in the cash ledger with C codes; both are right as they deal both ways. The statement's own type stays on the statement.
  paymentType: { type: String, enum: ['', 'cash', 'tax'], default: '' },

  // Collection terms
  paymentTerms: { type: String, trim: true, default: '' },
  creditLimit: { type: Number, default: 0 },

  /**
   * Dispute status with this customer.
   * An invoice sixty days late is either a customer negotiating late payment or a dispute that reached court; the dashboard needs that difference to show what is still in hand. Recorded on the customer, not the invoice, since the dispute is with the account holder; the date records since when.
   */
  issue: {
    state: { type: String, enum: ['none', 'negotiating', 'legal'], default: 'none', index: true },
    note: { type: String, trim: true, default: '' },
    since: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, trim: true, default: '' },
  },
  // Collection status is a human decision, not derived from numbers: a late customer on an agreed schedule is not defaulting.
  status: { type: String, trim: true, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastContactAt: { type: Date },
  nextFollowUpAt: { type: Date },
  notes: { type: String, trim: true, default: '' },

  isActive: { type: Boolean, default: true, index: true },
  // Where the record first came from: operations statements or an existing register. Read when asked later who added it.
  // Snapshot of the collections ledger as written by the accountant.
  // The Aging sheet's debt ages are what accounts approved and collections claims on, not computed from our invoices; ours approximate them (only about 6% of ledger invoices have statements here). They are kept as-is, separate in `ledger`, so neither is read in place of the other.
  ledger: {
    outstanding: { type: Number, default: 0 },      // Total Outstanding
    total60to1y: { type: Number, default: 0 },      // Total 60+ to 1Y
    total30to1y: { type: Number, default: 0 },      // Total 30+ to 1Y
    y1plus: { type: Number, default: 0 },           // 1 Year +
    d120: { type: Number, default: 0 },
    d90: { type: Number, default: 0 },
    d60: { type: Number, default: 0 },
    d60minus: { type: Number, default: 0 },
    d45: { type: Number, default: 0 },
    d30: { type: Number, default: 0 },
    d15: { type: Number, default: 0 },
    // The cash sheet has two columns, not ten: older than fifteen days and newer.
    d15plus: { type: Number, default: 0 },
    d15minus: { type: Number, default: 0 },
    contracts: { type: String, trim: true, default: '' },
    reconciliation: { type: String, trim: true, default: '' },
    reconciliationDate: { type: Date, default: null },
    comments: { type: String, trim: true, default: '' },
    // Source file and when, so the age of a claimed figure is known.
    sourceFile: { type: String, trim: true, default: '' },
    importedAt: { type: Date, default: null },
  },

  source: { type: String, trim: true, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

collectionsPartySchema.pre('save', function preSave(next) {
  this.nameKey = fold(this.name);
  // Other forms are folded like the name, to map the statement to its account.
  if (Array.isArray(this.aliases)) {
    this.aliasKeys = [...new Set(this.aliases.map(fold).filter(Boolean))];
  }
  next();
});
collectionsPartySchema.pre('findOneAndUpdate', function preUpd(next) {
  const u = this.getUpdate() || {};
  const name = (u.$set && u.$set.name) || u.name;
  if (name) { u.$set = u.$set || {}; u.$set.nameKey = fold(name); this.setUpdate(u); }
  next();
});

// One party per name unless they are two accounts.
// The condition was (side + name), right while the name was the identity. With the code, one company can hold two accounts: one company has a tax code 11040226 and a cash code C0011, each with its own balance and term.
// It is now (side + name + code): same-name accounts coexist if their codes differ, and rows with no code keep the old behaviour exactly (empty equals empty, so two code-less customers cannot share a name).
collectionsPartySchema.index({ kind: 1, nameKey: 1, code: 1 }, { unique: true });
collectionsPartySchema.index({ kind: 1, isActive: 1, name: 1 });
// Account code is unique where present; not yet required for rows without one.
collectionsPartySchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string', $gt: '' } } });
collectionsPartySchema.index({ collectionOfficer: 1, kind: 1 });

// One customer across all sections: link to the parent CRM company (services/customerHub)
collectionsPartySchema.add({ crmCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany', default: null, index: true } });
require('../services/customerHub').attach(collectionsPartySchema, 'collections');
module.exports = mongoose.models.CollectionsParty
  || mongoose.model('CollectionsParty', collectionsPartySchema);
module.exports.fold = fold;
