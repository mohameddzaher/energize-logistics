const mongoose = require('mongoose');
const { paymentSchema } = require('./collectionPaymentSchema');

const operationsWorkflowSchema = new mongoose.Schema(
  {
    // PRIMARY FIELD: report number
    reportNumber: { type: String, unique: true },

    // ══════════════════════════════════════════════════════════
    // GROUP 1: Application Columns (Moderator) — 14 fields
    // ══════════════════════════════════════════════════════════
    reportDate: { type: Date },                              // Report date
    fromLocation: { type: String, trim: true },              // From
    toLocation: { type: String, trim: true },                // To
    branch: { type: String, trim: true },                    // Branch
    carOwner: { type: String, trim: true },                  // Vehicle owner
    carNumber: { type: String, trim: true },                 // Vehicle number
    ownerType: { type: String, trim: true },                 // Owner type
    executionStatus: { type: String, trim: true },           // Execution status
    applicationStatus: { type: String, trim: true },         // Application status
    paymentMethod: { type: String, trim: true },             // Payment method
    username: { type: String, trim: true },                  // User name
    taxIndicator: { type: String, trim: true },              // Taxable / non-taxable
    purchaseValue: { type: Number, default: 0 },             // Purchase value
    sellingValue: { type: Number, default: 0 },

    // Where `sellingValue` comes from.
    // The operations platform writes it on every sync, so a hand correction is overwritten within minutes. For cash reports the collections ledger is the reference; when a value is written from the ledger it is flagged here and sync stops overwriting it. Other fields sync as usual and readers keep reading `sellingValue`, so no conditions spread across screens.
    // `manual` = typed by a user who owns the column in the workflow (and written to the platform as `selling_price`); sync leaves it alone because the platform sometimes resets `selling_price = purchase_price`.
    sellingValueSource: { type: String, enum: ['', 'platform', 'collections_book', 'manual'], default: '' },              // Selling value

    // Additional Application fields (from Excel import)
    loadingTime: { type: String, trim: true },                // Loading time
    driverRentalType: { type: String, trim: true },           // Driver rental type
    reference: { type: String, trim: true },                  // Reference number
    userPhone: { type: String, trim: true },                  // User phone
    driverName: { type: String, trim: true },                 // Driver name
    driverPhone: { type: String, trim: true },                // Driver phone
    carName: { type: String, trim: true },                    // Vehicle name
    plateNumber: { type: String, trim: true },                // Plate number
    truckType: { type: String, trim: true },                  // Truck type
    truckSize: { type: String, trim: true },                  // Truck size
    loadType: { type: String, trim: true },                   // Cargo type
    quantity: { type: String, trim: true },                   // Quantity
    goodsValue: { type: Number, default: 0 },                 // Goods value
    representativeName: { type: String, trim: true },         // Rep name
    country: { type: String, trim: true },                    // Country name
    // Legacy fields (kept for backwards compatibility)
    ownerName: { type: String, trim: true },
    ownerPhone: { type: String, trim: true },
    region: { type: String, trim: true },
    product: { type: String, trim: true },
    invoiceRef: { type: String, trim: true },
    driverCost: { type: Number, default: 0 },
    loadNumber: { type: String, trim: true },
    volume: { type: String, trim: true },

    // ══════════════════════════════════════════════════════════
    // GROUP 2: Operations Column (Operations Manager) — 1 field
    // ══════════════════════════════════════════════════════════
    operationsReview: { type: String, trim: true },          // Operations review

    // ══════════════════════════════════════════════════════════
    // GROUP 3: Manual Moderator Columns (Moderator) — 7 fields
    // ══════════════════════════════════════════════════════════
    paymentDate: { type: Date },                             // Payment date
    // Data owner: the last person who wrote or edited the payment date on this report. Different from the report creator and from whoever logged the purchase in daily custody, so a number in this column can be traced without opening the edit log.
    paymentDateBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paymentDateByName: { type: String, trim: true, default: '' },
    paymentDateAt: { type: Date, default: null },
    payingBranch: { type: String, trim: true },              // Paying branch

    // What was paid to the supplier and how the customer is invoiced.
    // `paymentAmount` is the real purchase price, filled automatically from wallet purchases (report number + amount) and still hand-editable.
    // `paymentType` separates the two paths: cash customers are collected immediately with no invoice, tax customers are invoiced then collected. The platform's payment method column is not relied on; this is the reference.
    paymentAmount: { type: Number, default: 0 },             // Payment amount
    paymentType: {                                           // Payment type
      type: String,
      enum: ['', 'cash', 'tax'],
      default: '',
    },
    // Selected subtype within the family: deferred-invoice (tax), deferred-cash, cash-3PL and cash-HT (cash).
    // `paymentType` stays the family all rules read; this is what the column shows when present. Empty = a report based on tax/cash as before. See PAYMENT_SUBTYPES in utils/paymentType.
    paymentSubtype: {                                        // Payment type (detail)
      type: String,
      enum: ['', 'deferred_cash', 'deferred_invoice', 'cash_3pl', 'cash_ht'],
      default: '',
    },

    // Who wrote the type.
    // "manual": an employee chose it on this report, so it is never auto-changed when the customer's type changes; without this field a deliberate choice cannot be told from a derived value.
    // "unified": set to the customer's type from the payment types page, an explicit decision sync does not override (see isUnified in utils/paymentType). See utils/paymentType.
    paymentTypeSource: {
      type: String,
      enum: ['', 'manual', 'auto', 'unified'],
      default: '',
    },
    finalReportDestination: { type: String, trim: true },    // Final report destination
    documentNumber: { type: String, trim: true },            // Voucher number
    sendingDate: { type: Date },                             // Send date

    // Two deliveries, not one: they are different events on different days by different teams.
    // `branchDeliveryDate`: report delivered to the branch (operations). `deliveryDate`: invoice delivered to the CUSTOMER (collections); the agreed credit term counts from this date, not from issue or branch arrival.
    // Merging them made the credit term start too early and showed invoices late or on time wrongly.
    branchDeliveryDate: { type: Date },                      // Delivery date to branch
    deliveryDate: { type: Date },                            // Delivery date to customer
    accountingReview: { type: String, trim: true },          // Accounts review

    // ══════════════════════════════════════════════════════════
    // GROUP 4: Collections Columns (Admin/Employee) — 7 fields
    // ══════════════════════════════════════════════════════════
    invoiceNumber: { type: String, trim: true },             // Invoice number
    netInvoice: { type: Number, default: 0 },                // Net invoice
    tax: { type: Number, default: 0 },                       // Tax
    totalInvoice: { type: Number, default: 0 },              // Invoice total
    invoiceDate: { type: Date },                             // Invoice date
    invoiceNotes: { type: String, trim: true },              // Invoice notes
    // What collections actually collected, typed by hand at collection. Not derived from the payment amount, which is what was paid to the supplier, while this is what was received from the customer.
    collectedAmount: { type: Number, default: 0 },           // Collection amount
    collectionDate: { type: Date },

    // Collection status in the cash ledger.
    // The Shipment Report sheet has a status column not derivable from a date: some reports are marked Collected with no collection date. The ledger knows they were collected but not when, and a screen reading only the date showed them as uncollected.
    // The status is stored as the ledger says it and no date is invented; the screen shows collected without a date.
    cashCollectionStatus: { type: String, enum: ['', 'collected'], default: '' },                          // Collection date

    // Collection written by the wallet.
    // A rep logged a collection in the wallet with this report's number and the report is cash: the date and amount above come from it and follow edits or deletion of that entry. The flag separates this from a collection the department typed by hand, which the wallet never overwrites or clears.
    // `false` (not absent) means the department wrote it by hand (logged, edited or cleared), so the wallet leaves it. See utils/walletCollection.
    collectedByWallet: { type: Boolean },

    // Collection payments, each with amount, date and author.
    // A partial collection is written as a payment here and added to `collectedAmount`; the report is collected (`collectionDate`) once the sum reaches its value. Whatever was in `collectedAmount` before payments (from the sheet or wallet) is a base that stays. See collectionsDeptController.recordCollection.
    collectionPayments: { type: [paymentSchema], default: undefined },

    // How the money arrived.
    // A cash report is collected in several ways: the branch receives it, cash on delivery, or the collector goes to the customer. The difference tells where the money is now and who answers for it.
    // Values are managed in collections settings (`collections_detail`), not a hardcoded list, so a new one needs no release.
    collectionDetail: { type: String, trim: true, default: '' },

    // ══════════════════════════════════════════════════════════
    // WORKFLOW / STAGE
    // ══════════════════════════════════════════════════════════
    stage: {
      type: String,
      enum: ['draft', 'submitted_to_ops', 'ops_completed', 'submitted_to_collections', 'completed'],
      default: 'draft',
    },

    // ══════════════════════════════════════════════════════════
    // ROW LOCKING
    // ══════════════════════════════════════════════════════════
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lockedByName: { type: String, default: '' },
    lockedAt: { type: Date, default: null },

    // TRACKING
    // Creator is optional.
    // A report mirrored from the operations platform has no creator here. The field used to be required, so sync stamped the first super admin on it, and tens of thousands of reports falsely read as created by that person. Once the false stamp was removed every save on those rows failed validation, so the requirement itself was dropped. Reports created here keep their creator; otherwise read `externalSource`.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Provenance for rows auto-synced from the external UPL operations platform.
    // `externalId` (UPL shipment id) dedups so re-syncs update in place; the
    // UPL-derived columns are refreshed each run while manually-entered columns
    // (operations/accounting/invoice review, etc.) are left untouched.
    externalSource: { type: String, trim: true },
    // The shipment created on our system that owns this row (services/shipmentOrderWorkflowLink).
    shipmentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipmentOrder', default: undefined },
    // Same for a load created in Fleet Management.
    fleetShipment: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    externalId: { type: String, trim: true },
    lastSyncedAt: { type: Date },
    // Platform stamp, not ours.
    // `lastSyncedAt` is when we read; this is when it changed there. The periodic poll compares against it and writes only what changed. Stored as received text, a comparison value and not a date to compute with. See jobs/opsPoll.
    externalUpdatedAt: { type: String, trim: true },
    // Fingerprint of what the last full sync wrote; the row is skipped when nothing relevant changed (services/opsWorkflowSyncService).
    syncSig: { type: String },

    // The customs transaction this report serves.
    // A readable copy rather than a bare reference: the table and collections screens show the transaction number, waybill and containers without a second query. Written only by services/customsOpsLink, from the transaction's transport fields, from the voucher number matching waybill/container, or from a manual link. `via: 'unlinked'` means a user unlinked it by hand, so weak evidence does not relink it.
    customsLink: {
      type: new mongoose.Schema({
        clearance: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsClearance', default: null },
        refNumber: { type: String, default: '' },
        blNumber: { type: String, default: '' },
        customerName: { type: String, default: '' },
        containers: { type: [String], default: [] },
        via: { type: String, enum: ['move', 'bl', 'container', 'manual', 'unlinked'], default: 'move' },
        at: { type: Date, default: null },
        byName: { type: String, default: '' },
      }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true }
);

// The invoice pages rely on these: cash by payment type, tax by invoice number, which groups several reports under one row.
operationsWorkflowSchema.index({ paymentType: 1, paymentDate: -1 });
// The collections dashboard reads the four subtypes (collectionsReceivablesController.subtypeCards).
operationsWorkflowSchema.index({ paymentSubtype: 1, paymentType: 1 });
// Uncollected cash reports are queried on every screen open.
// The debt aging page asks which cash reports are not yet collected. The only existing index was on type and payment date, while the query is on type, collection date and status, so it scanned thousands of reports for several seconds on each search.
operationsWorkflowSchema.index({ paymentType: 1, collectionDate: 1, cashCollectionStatus: 1 });
// Name search starts from the name: collections pages group reports by owner.
operationsWorkflowSchema.index({ username: 1, paymentType: 1 });
// Wallet-written collections are queried on every match; they are few among tens of thousands.
operationsWorkflowSchema.index({ collectedByWallet: 1 }, { partialFilterExpression: { collectedByWallet: true } });
operationsWorkflowSchema.index({ invoiceNumber: 1, invoiceDate: -1 });
// Exact search by voucher number (primeRelatedSearch) must not scan.
operationsWorkflowSchema.index({ documentNumber: 1 });
// Reports of a customs transaction; few among tens of thousands, so the index is partial.
operationsWorkflowSchema.index({ 'customsLink.clearance': 1 }, { partialFilterExpression: { 'customsLink.clearance': { $type: 'objectId' } } });

operationsWorkflowSchema.index(
  { externalSource: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $exists: true } } }
);

// Auto-generate report number before save
operationsWorkflowSchema.pre('save', async function (next) {
  if (!this.reportNumber) {
    const last = await mongoose.model('OperationsWorkflow')
      .findOne({ reportNumber: /^RPT-/ })
      .sort({ reportNumber: -1 })
      .select('reportNumber')
      .lean();
    const lastNum = last ? parseInt(last.reportNumber.replace('RPT-', ''), 10) : 0;
    this.reportNumber = `RPT-${String(lastNum + 1).padStart(5, '0')}`;
  }
  next();
});

// Indexes
// The moving-shipments poll (jobs/opsPoll) runs every few seconds asking for platform reports whose status is in transit. It scanned all reports to return about a thousand, the heaviest query in the database (measured with $queryStats). This index answers it fully on its own without fetching rows: status, source and the fields read from them.
operationsWorkflowSchema.index({ applicationStatus: 1, externalSource: 1, externalId: 1, externalUpdatedAt: 1 });
operationsWorkflowSchema.index({ stage: 1 });
operationsWorkflowSchema.index({ fleetShipment: 1, updatedAt: -1 }, { unique: true, partialFilterExpression: { fleetShipment: { $type: 'objectId' } } });
operationsWorkflowSchema.index({ shipmentOrder: 1, updatedAt: -1 }, { unique: true, partialFilterExpression: { shipmentOrder: { $type: 'objectId' } } });
operationsWorkflowSchema.index({ branch: 1 });
operationsWorkflowSchema.index({ carOwner: 1 });
operationsWorkflowSchema.index({ createdAt: -1 });
operationsWorkflowSchema.index({ lockedBy: 1 });

module.exports = mongoose.model('OperationsWorkflow', operationsWorkflowSchema);
