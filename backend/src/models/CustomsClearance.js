const mongoose = require('mongoose');

/**
 * Clearance cycle stages.
 * The cycle is not a line: after the transport order it branches, either port to yard (then unloading and storage, then a second transport to the customer) or port directly to the customer (no unloading or storage). Car transactions have no container return.
 * This list is everything that can occur, and `pipelineOf` below says which stages this transaction needs and which are closed for it; the percentage is computed from that, so a transaction is not penalised for a stage not on its path.
 */
const STAGES = [
  'papers_received',        // Receive papers
  'declaration_paid',       // Pay the customs declaration
  'do_requested',           // Request the delivery-order invoice
  'do_invoice_paid',        // Pay the delivery-order invoice
  'do_linked',              // Link the delivery order
  'port_fees_paid',         // Pay port fees
  'unloading_fees_paid',    // Pay unloading fees
  'transport_order',        // Transport order
  'transport_to_yard',      // Transport from port to yard
  'transport_to_customer',  // Transport from port to customer
  'unloaded_stored',        // Unloading and storage (yard route only)
  'yard_to_customer',       // Transport from yard to customer (yard route only)
  'containers_returned',    // Return containers (not for car transactions)
  'invoiced',               // Issue invoice; marked by issuing it, not by hand
];
// Key from before branching: "transport containers to customer or yard". Still accepted in `stage` because old transactions sit on it, and read with its new meaning in `pipelineOf`.
const LEGACY_STAGES = ['containers_transported'];
// Old linear order, used to read a transaction that has only its current stage and no marks.
const LINEAR_V1 = [
  'papers_received', 'declaration_paid', 'do_requested', 'do_linked', 'port_fees_paid',
  'unloading_fees_paid', 'transport_order', 'containers_transported', 'unloaded_stored',
  'containers_returned', 'invoiced',
];
// Stages that are transport; each has its own vehicle details (see containers.moves).
const TRANSPORT_LEGS = ['transport_to_yard', 'transport_to_customer', 'yard_to_customer'];
// The two port stages: one is chosen and can be switched with a click.
const PORT_LEGS = ['transport_to_yard', 'transport_to_customer'];
// From the first transport, stages are marked per unit (container or car); see pipelineOf.
const UNIT_STAGES = ['transport_to_yard', 'transport_to_customer', 'unloaded_stored', 'yard_to_customer', 'containers_returned'];
const CARGO_TYPES = ['containers', 'vehicles'];
const VEHICLE_KINDS = ['energize', 'external'];

const customsClearanceSchema = new mongoose.Schema(
  {
    refNumber: { type: String, unique: true, index: true },

    branch: { type: String, enum: ['jeddah', 'dammam'], default: 'jeddah', index: true },
    stage: { type: String, enum: [...STAGES, ...LEGACY_STAGES], default: 'papers_received', index: true },
    /**
     * Transaction kind: containers or cars.
     * Chosen at creation. The cycle is the same except container return: a car is delivered and nothing goes back to the agent, so that stage is closed from day one. `containerCount` is the unit count in both cases.
     */
    cargoType: { type: String, enum: CARGO_TYPES, default: 'containers', index: true },
    // Which route was taken after the transport order; written when one of the two port stages is marked.
    transportRoute: { type: String, enum: ['', 'yard', 'customer'], default: '' },
    // 2 = its stages were marked with the new list; lower values are read with the old rule.
    // No default on purpose: a default would be written onto old records when read.
    pipelineVersion: { type: Number },
    // Who marked which stage and when, to read team activity on the department dashboard.
    stageLog: [{
      key: { type: String, default: '' },
      done: { type: Boolean, default: true },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      byName: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    // Each stage is marked on its own.
    // Done stages used to be derived from the current one: choosing the eighth made the seven before it done though none ran. The cycle does not always follow its order (fees can be paid before papers arrive; a stage may be skipped). So completion is recorded explicitly and `stage` stays "where it is now" for reports and filters.
    stagesDone: { type: [String], default: [], index: true },
    cancelled: { type: Boolean, default: false },

    // People
    assignedTo: { type: String, trim: true },       // Clearance agent / follower (free text, reps are not always users)
    customerName: { type: String, trim: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    // Both parties by id, not only by text.
    // The name stays stored as written (`customerName`, `shippingAgent`) because exports and reports read it; the profile id is added to group transactions and open the profile, so two spellings do not split one party.
    customerParty: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', index: true },
    agentParty: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', index: true }, // optional link
    // Carrier that moved the container from the port: a register like customer and agent; the name stays text for data entered before the register.
    carrierParty: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', index: true },
    carrierName: { type: String, trim: true, default: '' },
    shippingAgent: { type: String, trim: true },
    shippingAgentEmail: { type: String, trim: true, lowercase: true },

    // Transaction data (needed to run the transaction on Fasah)
    blNumber: { type: String, trim: true },         // Bill of lading number
    invoiceNumber: { type: String, trim: true },    // Invoice number
    invoiceDate: { type: Date },                    // Invoice date
    port: { type: String, trim: true },             // Port name
    invoiceType: { type: String, enum: ['C&F', 'CIF', 'FOB', ''], default: '' },
    containerCount: { type: Number, default: 0 },   // Container count
    totalWeight: { type: Number, default: 0 },      // Gross weight
    invoiceValue: { type: Number, default: 0 },     // Invoice value
    currency: { type: String, trim: true },         // Currency
    exporterCompany: { type: String, trim: true },  // Exporting company name
    countryOfOrigin: { type: String, trim: true },  // Country of origin
    hsCode: { type: String, trim: true },           // Customs HS code
    saberNumber: { type: String, trim: true },      // SABER certificate number (if any)

    // Required documents checklist for transactions
    documents: {
      bl: { type: Boolean, default: false },               // Bill of lading
      commercialInvoice: { type: Boolean, default: false }, // Commercial invoice
      certificateOfOrigin: { type: Boolean, default: false }, // Certificate of origin
      packingList: { type: Boolean, default: false },       // Packing list
      saber: { type: Boolean, default: false },             // SABER certificate (if any)
    },

    // Agent papers checklist
    agentPapers: {
      blStamped: { type: Boolean, default: false },          // Bill of lading with clearance stamp and importer number
      customerAuthorization: { type: Boolean, default: false }, // Customer authorization to the company
      companyAuthorization: { type: Boolean, default: false },  // Company authorization to the clearance representative
    },

    // Master-spreadsheet fields (clearance master). All additive and optional.

    // Identity / period
    legacySerial: { type: Number },                 // Serial (row number in the sheet)
    periodMonth: { type: Number, min: 1, max: 12 }, // Month
    periodYear: { type: Number },                   // Year
    city: { type: String, trim: true },             // City (raw Arabic, as written)

    // Declaration & scheduling
    declarationNumber: { type: String, trim: true },  // Declaration number
    declarationDate: { type: String, trim: true },    // Declaration date (YYYY-MM-DD)
    papersReceivedDate: { type: String, trim: true }, // Papers received date (YYYY-MM-DD)
    unloadingAppointment: { type: String, trim: true }, // Unloading appointment
    unloadingLocation: { type: String, trim: true },    // Unloading place
    doNumber: { type: String, trim: true },             // Delivery order number (delivery-order column in the sheet)
    exitPermitNumber: { type: String, trim: true },     // Exit permit number

    // Last date to return containers to the agent (master column).
    // The riskiest date in a transaction: passing it starts the demurrage meter, which becomes money. Stored on its own rather than in stageDates so overdue and about-to-be-overdue are measured against it.
    returnDeadline: { type: String, trim: true, default: '' }, // YYYY-MM-DD
    // Most master rows put the grace-day count (usually 35) in this column, not a date. The number is neither forced into a date field nor dropped: it is stored here and the deadline derived once the unloading date is known.
    returnFreeDays: { type: Number, default: 0 },
    // Demurrage liability date: the day demurrage starts being charged to us.
    demurrageStartDate: { type: String, trim: true, default: '' }, // YYYY-MM-DD
    // Free days before the floor date on a vehicles transaction (null = 15). Containers are always 3.
    demurrageDays: { type: Number, default: null },

    // Filled from the customer contract.
    // Which contract and destination, and what was written into revenue. If the container count or customer changes the fill is redone for what remains at the contract value, without overwriting what the employee edited.
    contractPricing: {
      contract: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsContract', default: null },
      contractTitle: { type: String, trim: true, default: '' },
      routeFrom: { type: String, trim: true, default: '' },
      routeTo: { type: String, trim: true, default: '' },
      applied: {
        clearanceFee: { type: Number, default: null },
        transportSelling: { type: Number, default: null },
        transportToYardSelling: { type: Number, default: null },
        yardToCustomerSelling: { type: Number, default: null },
      },
      appliedAt: { type: Date, default: null },
    },

    /**
     * A transaction not yet due.
     * A shipment is known about a week before arrival: the customer notifies, the agent is booked, papers prepared. That used to live in a side notebook or memory, so shipments arrived with no appointment booked.
     * It is recorded as a full transaction with its expected date but kept apart from current ones: work lists, dashboard figures and collection claims are about transactions that happened, and a not-yet-real row would corrupt every count. It has its own list and alert, and converts to a current transaction with one click on arrival.
     */
    upcoming: { type: Boolean, default: false, index: true },
    expectedDate: { type: String, trim: true, default: '' }, // YYYY-MM-DD
    // When it became a current transaction, and who converted it.
    activatedAt: { type: Date, default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    activatedByName: { type: String, trim: true, default: '' },

    /**
     * Payment stages: a repeating list, not eight fixed fields.
     * `stageDates`/`stageDone` were eight keys in the schema, one stage each with one date and no attachment, which made impossible: a ninth stage (transport invoice) without a release; the payment paper itself (only "paid 3/8" with no receipt); and a repeating stage (fees paid in two installments, returns happening twice for two containers, so the second overwrote the first).
     * Now each entry is a stage with date and attachment, and the same stage can be added many times. The pick list is managed from department settings (`customs_payment_stage`), and the name is captured in `label` so past entries do not change if a stage is renamed.
     * `stageDates`/`stageDone` remain because legacy import rows hold them and deleting them deletes the date; migrated once by scripts/migrateCustomsStages.js and then read-only.
     */
    paymentStages: [
      {
        key: { type: String, trim: true, default: '' },     // Stage key from the list
        label: { type: String, trim: true, default: '' },   // Name snapshot at the time of adding
        date: { type: String, default: '' },                // YYYY-MM-DD
        amount: { type: Number, default: null },            // Amount, if recorded
        note: { type: String, trim: true, default: '' },
        // The attachment is written here and in `attachments`: here to read it at its stage, there to find it with the rest of the transaction papers.
        fileUrl: { type: String, default: '' },
        fileName: { type: String, trim: true, default: '' },
        mimeType: { type: String, trim: true, default: '' },
        size: { type: Number, default: 0 },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        addedByName: { type: String, default: '' },
        addedAt: { type: Date, default: Date.now },

        /**
         * Entry is a payment request to Finance.
         * When a clearance employee attaches an invoice to a payment stage, he is not dating a past event but saying "this must be paid". That used to be a phone call or WhatsApp message with a hand-placed mark, so who asked, who paid and when were unknown and the accountant saw nothing.
         * The entry is now a request with a status: pending until Finance decides: paid (with proof), returned for correction (with reason), or rejected. The green mark is set when paid, not by hand.
         */
        payStatus: {
          type: String,
          enum: ['pending', 'paid', 'returned', 'rejected'],
          default: 'pending',
          index: true,
        },
        decisionNote: { type: String, trim: true, default: '' },
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        decidedByName: { type: String, trim: true, default: '' },
        decidedAt: { type: Date, default: null },
        // Proof of payment: zero or more files, optional (a bank transfer may not be photographed).
        proofFiles: [{
          fileUrl: { type: String, trim: true, default: '' },
          fileName: { type: String, trim: true, default: '' },
          mimeType: { type: String, trim: true, default: '' },
          size: { type: Number, default: 0 },
        }],
      },
    ],

    /**
     * Closing the transaction.
     * An explicit action, not an inferred state. It cannot close before the transport invoice has a date and attachment (see `completeClearance`): a closed transaction leaves the follow-up lists, and closing it without a transport invoice would leave it with unclaimed money.
     */
    /**
     * The customer invoice is written at closing.
     * Payment stages above are what we pay (requests answered by Finance). This is what we bill: at closing the clearance employee gives the selling price per item (transport invoice, customs fees, appointment booking ...) with its attachment, e.g. "we paid transport 1800 and bill 2200".
     * Invoice rule (utils/customsInvoice): these lines, the prices billed to the customer, summed x 1.15. Payment stages (what we pay) are not part of it.
     * The total is not stored: it is derived on read from the items, so it never goes stale after an item edit.
     */
    saleItems: [{
      key: { type: String, trim: true, default: '' },
      label: { type: String, trim: true, default: '' },
      amount: { type: Number, default: 0 },
      note: { type: String, trim: true, default: '' },
      fileUrl: { type: String, default: '' },
      fileName: { type: String, trim: true, default: '' },
      mimeType: { type: String, trim: true, default: '' },
      size: { type: Number, default: 0 },
      addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      addedByName: { type: String, default: '' },
      addedAt: { type: Date, default: Date.now },
    }],
    /**
     * Billing request.
     * Clearance does not issue the invoice, it requests it. It writes the sale items above and sends them, so the request is pending with Finance (clearance finance, separate from payment stages). Finance invoices it in its own system and marks it billed here, optionally with the final invoice; only then is the transaction counted as billed (`saleInvoiceNumber`). It can also return it for correction or reject it.
     * A closed transaction whose request is not yet billed is "closed, not billed".
     */
    invoiceRequest: {
      status: { type: String, enum: ['', 'pending', 'invoiced', 'returned', 'rejected'], default: '', index: true },
      requestedAt: { type: Date, default: null },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      requestedByName: { type: String, trim: true, default: '' },
      note: { type: String, trim: true, default: '' },
      decidedAt: { type: Date, default: null },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      decidedByName: { type: String, trim: true, default: '' },
      decisionNote: { type: String, trim: true, default: '' },
      // The final invoice as issued by Finance.
      fileUrl: { type: String, default: '' },
      fileName: { type: String, trim: true, default: '' },
      mimeType: { type: String, trim: true, default: '' },
      size: { type: Number, default: 0 },
    },
    // Invoice number, written when Finance marks it billed; it is how Finance identifies it.
    saleInvoiceNumber: { type: String, trim: true, default: '', index: true },
    saleInvoiceAt: { type: Date, default: null },
    // Tax rate at closing, captured so an old invoice does not change when the rate does.
    saleVatRate: { type: Number, default: 0.15 },

    isCompleted: { type: Boolean, default: false, index: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedByName: { type: String, trim: true, default: '' },

    // Payment / milestone dates (YYYY-MM-DD strings, '' when unknown). Read-only; see `paymentStages` above.
    stageDates: {
      doInvoiceEmailed: { type: String, default: '' },   // Delivery-order invoice milestone
      doInvoicePaid: { type: String, default: '' },      // Delivery-order invoice payment
      doLinkEmailed: { type: String, default: '' },      // Delivery-order link milestone
      dutyPaid: { type: String, default: '' },           // Customs fees payment
      portFeesPaid: { type: String, default: '' },       // Ports payment
      unloadingFeesPaid: { type: String, default: '' },  // Unloading payment
      containersReturned: { type: String, default: '' }, // Return
      returnInvoiceDate: { type: String, default: '' },  // Return invoice
    },

    // The sheet often records these milestones as "done" with no date; the done/not-done signal is kept alongside stageDates so nothing is lost.
    stageDone: {
      doInvoiceEmailed: { type: Boolean, default: false },
      doInvoicePaid: { type: Boolean, default: false },
      doLinkEmailed: { type: Boolean, default: false },
      dutyPaid: { type: Boolean, default: false },
      portFeesPaid: { type: Boolean, default: false },
      unloadingFeesPaid: { type: Boolean, default: false },
      containersReturned: { type: Boolean, default: false },
      returnInvoiceDate: { type: Boolean, default: false },
    },

    // Costs, all SAR
    costs: {
      deliveryOrder: { type: Number, default: 0 },      // Delivery order value
      customsDuty: { type: Number, default: 0 },        // Customs fees
      portFees: { type: Number, default: 0 },           // Port charges
      unloadingFees: { type: Number, default: 0 },      // Unloading charges
      // Transport has three parts.
      // `transport` was "transport price from supplier" and `transportToYard` "transport to yard"; they become the first two parts under new names (old values unchanged), and the third is new. All three are filled from payment stages when paid.
      transport: { type: Number, default: 0 },               // Transport from port to customer
      transportToYard: { type: Number, default: 0 },         // Transport from port to yard
      transportYardToCustomer: { type: Number, default: 0 }, // Transport from yard to customer
      labourExpenses: { type: Number, default: 0 },          // Labor costs
      examFees: { type: Number, default: 0 },                // Customs examination (كشف)
      appointmentBooking: { type: Number, default: 0 }, // Appointment booking
      yardFees: { type: Number, default: 0 },           // Yard fees
      demurrage: { type: Number, default: 0 },          // Demurrage
      inspection: { type: Number, default: 0 },         // Inspection fees
      extension: { type: Number, default: 0 },          // Extension
      consolidator: { type: Number, default: 0 },       // Consolidation
      commissions: { type: Number, default: 0 },        // Commissions
      extraFees: { type: Number, default: 0 },          // Extra fees
      storage: { type: Number, default: 0 },            // Storage
      exitPermit: { type: Number, default: 0 },         // Exit permit
      total: { type: Number, default: 0 },              // Total costs (computed)
    },

    // Revenue (SAR).
    // In clearance, fees are passed through, not sold: what is paid to ports and customs is recovered from the customer as-is (total costs above) and profit is what is added on top. So these fields are margin items, not "sales": each enters profit, and invoice = costs + margin, as the master computes it:
    // invoice total = total costs + clearance fees + net storage + net transport to yard + security inspection + net transport
    revenue: {
      clearanceFee: { type: Number, default: 0 },        // Clearance fees
      transportSelling: { type: Number, default: 0 },    // Transport selling price (gross, not part of margin)
      transportNet: { type: Number, default: 0 },        // Net transport = selling price - transport cost
      transportToYardNet: { type: Number, default: 0 },  // Net transport to yard (with tax)
      // Customer price for transport from port to yard. Null on old transactions, where the net stays as written; once the price is set, the net is its difference from cost like its neighbours. See recomputeTotals.
      transportToYardSelling: { type: Number, default: null },
      yardToCustomerSelling: { type: Number, default: 0 },  // Transport price from yard to customer
      yardToCustomerNet: { type: Number, default: 0 },      // Its net (computed)
      yardTransportNet: { type: Number, default: 0 },    // Yard transport net (helper column, outside margin)
      // Yard price (what the yard actually charges). Null on legacy rows: their typed yardNet stays.
      yardPrice: { type: Number, default: null },
      yardNet: { type: Number, default: 0 },             // yard net = yardPrice − costs.yardFees (when the price is set)
      storageNet: { type: Number, default: 0 },          // Net storage
      transportDailies: { type: Number, default: 0 },    // Transport per-diems charged to the customer
      securityScan: { type: Number, default: 0 },        // Security inspection
      labour: { type: Number, default: 0 },              // Labor
      totalInvoiced: { type: Number, default: 0 },       // Invoice total (computed)
      profit: { type: Number, default: 0 },              // Profit total (computed)
    },

    // Our billing (as opposed to the supplier invoice captured above)
    billing: {
      invoiceStatus: { type: String, default: '' },  // Invoice status, free text (paid / not billed ...)
      ourInvoiceNumber: { type: String, default: '' }, // Our invoice number
      invoicedAt: { type: String, default: '' },       // YYYY-MM-DD
    },

    // Container-level detail (Sheet2 grain)
    containers: [
      {
        containerNumber: { type: String, trim: true }, // Container number (or car chassis number)
        exitPermit: { type: Number, default: 0 },      // Exit permit
        declaration: { type: String, trim: true },     // Declaration
        notes: { type: String, trim: true },
        // Which route this unit took and which of its stages are done; each unit has its own stages from the first transport. Written only through `PATCH /:id/stage`.
        route: { type: String, enum: ['', 'yard', 'customer'], default: '' },
        stagesDone: { type: [String], default: [] },
        // Date this container was returned to the agent; each container has its own.
        returnDate: { type: String, trim: true, default: '' }, // YYYY-MM-DD
        // Return details.
        // The date alone does not answer what is asked when the agent claims a penalty: where it was returned, with which receipt, in which vehicle. So each container carries its return details.
        returnDepot: { type: String, trim: true, default: '' },    // Return place (yard / terminal)
        returnReceipt: { type: String, trim: true, default: '' },  // Return receipt number (EIR)
        returnVehicleKind: { type: String, enum: ['', 'energize', 'external'], default: '' },
        returnRef: { type: String, trim: true, default: '' },      // Clearance statement number or external vehicle invoice
        returnNotes: { type: String, trim: true, default: '' },
        /** Transport details per transport stage: by company vehicle, recorded as the clearance statement number (`reportNumber` in the operations workflow), or by an external vehicle, recorded as its invoice number. */
        moves: [{
          _id: false,
          leg: { type: String, enum: TRANSPORT_LEGS },
          vehicleKind: { type: String, enum: [...VEHICLE_KINDS, ''], default: '' },
          ref: { type: String, trim: true, default: '' },
        }],
      },
    ],

    /**
     * Transport invoice: a transaction is billed without it and finished with it.
     * Closing and billing used to be one action that could not pass before the transport invoice, which the carrier delays by weeks, leaving a finished transaction unbilled to the customer. They are now split: the invoice goes to Finance once work is complete, and the transaction is finished when the transport invoice arrives and is attached. The gap in between is counted and shown red on the dashboard.
     */
    transportInvoice: {
      fileUrl: { type: String, default: '' },
      fileName: { type: String, trim: true, default: '' },
      mimeType: { type: String, trim: true, default: '' },
      size: { type: Number, default: 0 },
      date: { type: String, trim: true, default: '' },
      // Moved by company vehicles, so no carrier invoice is awaited; stated explicitly.
      notRequired: { type: Boolean, default: false },
      note: { type: String, trim: true, default: '' },
      receivedAt: { type: Date, default: null },
      receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      receivedByName: { type: String, trim: true, default: '' },
    },
    // Derived and stored on every save (see hasTransportInvoice) so the database can filter on it.
    transportInvoiceReceived: { type: Boolean, default: false, index: true },

    // Transaction attachments.
    // Clearance papers are the transaction: bill of lading, declaration, delivery-order invoice, payment receipt, exit permit. They used to travel by email and WhatsApp and could not be found later. Stored with the record, and each file is tagged with the stage it was produced in (stage) so it reads at its place in the cycle.
    attachments: [
      {
        title: { type: String, trim: true, default: '' },
        stage: { type: String, default: '' },   // One of STAGES, or '' for general
        fileUrl: { type: String, required: true },
        fileName: { type: String, trim: true, default: '' },
        mimeType: { type: String, trim: true, default: '' },
        size: { type: Number, default: 0 },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedByName: { type: String, default: '' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    notes: { type: String },

    // A note is an appended line, not an overwritten field.
    // `notes` was a single field, so today's note erased yesterday's with no author or time. Each note now has its line with author and time, and the latest shows in the table column. `notes` keeps what was written before.
    notesLog: [
      {
        text: { type: String, trim: true, required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byName: { type: String, default: '' },
        at: { type: Date, default: Date.now },
      },
    ],
    // Follow-up emails sent to the customer from this transaction (controllers/customsMailController).
    emailLog: [
      {
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byName: { type: String, default: '' },
        to: { type: [String], default: [] },
        cc: { type: [String], default: [] },
        subject: { type: String, default: '' },
        unit: { type: String, default: '' },   // container number when the email was about one container
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  // `pipeline` (stages as this transaction needs them, with percentage) goes out with every response.
  // `revenue.profit` goes out in no response and no live broadcast: profit is for management and finance, while a transaction is sent to everyone who opens its screen and updates are broadcast to all. Whoever may see the figure gets it in a separate field (see getClearance), not buried in the document.
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        if (ret.revenue && typeof ret.revenue === 'object') delete ret.revenue.profit;
        return ret;
      },
    },
  }
);

/** Has the transport invoice arrived? Three entry paths: its own field, a "transport invoice" entry in payment stages with an attachment, or its item in the customer invoice with an attachment. */
/**
 * A transport invoice is in when any one of the four transport lines of the invoice request (port→customer, port→yard,
 * yard→customer, transport invoice) carries both an amount and its file (owner, 2026-11-12); or it was marked not required.
 */
function hasTransportInvoice(c) {
  if (!c) return false;
  const t = c.transportInvoice || {};
  if (t.notRequired) return true;
  const full = (x) => x && TRANSPORT_STAGE_KEYS.includes(x.key) && x.fileUrl && Number(x.amount) > 0;
  // Only the invoice request's sale lines count, not general payment stages.
  return (c.saleItems || []).some(full);
}

/** Why this stage is closed for this transaction, or '' if it is on its path. */
function lockReason(key, route, cargoType) {
  if (key === 'containers_returned' && cargoType === 'vehicles') return 'معاملةُ سيّاراتٍ — لا إرجاعَ حاوياتٍ فيها';
  if (key === 'transport_to_customer' && route === 'yard') return 'اختير النقلُ من الميناء إلى الساحة';
  if (key === 'transport_to_yard' && route === 'customer') return 'اختير النقلُ من الميناء إلى العميل';
  if (key === 'unloaded_stored' || key === 'yard_to_customer') {
    if (route === 'customer') return 'النقلُ إلى العميل مباشرةً — لا تفريغَ ولا تخزين';
    if (route !== 'yard') return 'تُتاح بعد اختيار «النقل من الميناء إلى الساحة»';
  }
  return '';
}

/**
 * Marked stages and the route taken, with one rule for new and old records.
 * Transactions marked before branching carry "transport containers" as a single key and lack "pay delivery-order invoice" entirely. They are read by what follows: whoever unloaded and stored went through the yard, whoever linked the order paid its invoice. This is written to the database only on the first new mark (see setStage); reading does not modify.
 */
function readStages(c) {
  const done = new Set((c && c.stagesDone) || []);
  let route = (c && c.transportRoute) || '';
  if (c && !(c.pipelineVersion >= 2)) {
    // Older still: a stage with no marks.
    // Imported from the master (or entered before stages were marked one by one), a record carries only its stage and an empty `stagesDone`. The master's stage is the last one the transaction reached ("billed", "containers returned"), so it and everything before it are done. Otherwise a transaction that reached billing would sit at "receive papers" at zero percent.
    if (!done.size && c.stage && c.stage !== 'papers_received') {
      const at = LINEAR_V1.indexOf(c.stage);
      for (let i = 0; i <= at; i += 1) done.add(LINEAR_V1[i]);
    }
    if (done.has('containers_transported') && !route) {
      route = done.has('unloaded_stored') ? 'yard' : 'customer';
      done.add(route === 'yard' ? 'transport_to_yard' : 'transport_to_customer');
      if (route === 'yard' && (done.has('containers_returned') || done.has('invoiced'))) done.add('yard_to_customer');
    }
    if (done.has('do_linked') || (c.stageDone && c.stageDone.doInvoicePaid)) done.add('do_invoice_paid');
  }
  done.delete('containers_transported');
  if (!route) {
    if (done.has('transport_to_yard')) route = 'yard';
    else if (done.has('transport_to_customer')) route = 'customer';
  }
  // The issued invoice is the stage itself, not a second mark that gets forgotten.
  if (c && c.saleInvoiceNumber) done.add('invoiced');
  return { done, route };
}

/** Transaction stages as it needs them: each is done or closed, with the percentage. The percentage covers only what is needed; until the route is chosen the two port stages count as one slot (one will be done and the other closed). */
function pipelineOf(c) {
  const { done, route, units } = readUnits(c);
  const cargoType = (c && c.cargoType) || 'containers';
  const step = (key, r, has) => {
    const reason = lockReason(key, r, cargoType);
    return {
      key, done: !reason && has(key), locked: !!reason, ...(reason ? { reason } : {}),
      // The other route is not locked: clicking it switches the choice (see setStage).
      ...(reason && PORT_LEGS.includes(key) ? { switchable: true } : {}),
    };
  };
  const tally = (steps, r) => {
    const open = steps.filter((s) => !s.locked);
    const total = Math.max(1, open.length - (r ? 0 : 1));
    const n = open.filter((s) => s.done).length;
    const next = open.find((s) => !s.done);
    return { done: n, total, percent: Math.min(100, Math.round((n / total) * 100)), next: next ? next.key : '' };
  };

  // Transaction with no units: all stages on the transaction.
  if (!units) {
    const steps = STAGES.map((key) => step(key, route, (k) => done.has(k)));
    return { route, cargoType, perUnit: false, steps, units: [], ...tally(steps, route) };
  }

  // From the first transport, each container has its own stages.
  // Three containers on one bill of lading do not always move together: one to the customer today, two to the yard, one returned before its sibling. So transport and later stages are marked per unit, and the transaction stage is their aggregate: done when every unit that needs it has done it, with how many of how many.
  const unitViews = units.map((u, index) => {
    const steps = UNIT_STAGES.map((key) => step(key, u.route, (k) => u.done.has(k)));
    return { index, route: u.route, steps, ...tally(steps, u.route) };
  });
  const steps = STAGES.map((key) => {
    if (!UNIT_STAGES.includes(key)) return { key, done: done.has(key), locked: false };
    const per = unitViews.map((v) => v.steps.find((x) => x.key === key));
    const open = per.filter((x) => !x.locked);
    const n = open.filter((x) => x.done).length;
    if (!open.length) {
      const reasons = [...new Set(per.map((x) => x.reason))];
      return {
        key, perUnit: true, done: false, locked: true, unitsDone: 0, unitsOf: 0,
        reason: reasons.length === 1 ? reasons[0] : 'لا تَلزم أيًّا من وحدات المعاملة',
        ...(PORT_LEGS.includes(key) ? { switchable: true } : {}),
      };
    }
    return { key, perUnit: true, done: n === open.length, locked: false, unitsDone: n, unitsOf: open.length };
  });
  // Percentage: transaction stages by weight, unit stages by the average of what each unit completed.
  const base = steps.filter((x) => !x.perUnit);
  const baseDone = base.filter((x) => x.done).length;
  const span = Math.max(...unitViews.map((v) => v.total));
  const frac = unitViews.reduce((a, v) => a + v.done / v.total, 0) / unitViews.length;
  const total = base.length + span;
  const order = STAGES.find((key) => {
    const x = steps.find((y) => y.key === key);
    return x.perUnit ? unitViews.some((v) => v.next === key) : !x.done;
  });
  const routes = [...new Set(unitViews.map((v) => v.route))];
  return {
    route: routes.length === 1 ? routes[0] : '', mixedRoutes: routes.length > 1,
    cargoType, perUnit: true, steps, units: unitViews,
    done: baseDone + Math.floor(span * frac + 1e-9), total,
    percent: Math.min(100, Math.round(((baseDone + span * frac) / total) * 100)),
    next: order || '',
  };
}

/**
 * Transaction units and each one's stages.
 * Marks made before stages became per-unit (`pipelineVersion` below 3) are on the whole transaction and read onto all its units: "containers transported" then meant all of them. This is written to the database only on the first per-unit mark (setStage). A transaction with no unit count keeps its stages on itself (`units: null`).
 */
function readUnits(c) {
  const { done, route } = readStages(c);
  const rows = [...((c && c.containers) || [])];
  const want = Math.max(0, Math.min(300, Math.round(Number(c && c.containerCount) || 0)));
  while (rows.length < want) rows.push({});
  if (!rows.length) return { done, route, units: null };
  const own = c.pipelineVersion === 3;
  const units = rows.map((r) => {
    const mine = new Set(((r && r.stagesDone) || []).filter((k) => UNIT_STAGES.includes(k)));
    let ur = (r && r.route) || '';
    if (!own) {
      for (const k of UNIT_STAGES) if (done.has(k)) mine.add(k);
      if (!ur) ur = route;
    }
    if (!ur) ur = mine.has('transport_to_yard') ? 'yard' : mine.has('transport_to_customer') ? 'customer' : '';
    return { route: ur, done: mine };
  });
  if (own) for (const k of UNIT_STAGES) done.delete(k);
  return { done, route, units };
}

customsClearanceSchema.virtual('pipeline').get(function pipelineVirtual() { return pipelineOf(this); });

/** Unit rows (containers or cars) matching the transaction count: empty slots are added up to the count and extra empty ones are removed from the end. A row with anything written is never deleted by shrinking the count; the count is corrected to it instead. */
function syncUnits(rows, count) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({ ...(r && r.toObject ? r.toObject() : r) }));
  const want = Math.max(0, Math.min(300, Math.round(Number(count) || 0)));
  const filled = (r) => !!(r && (String(r.containerNumber || '').trim() || String(r.returnDate || '').trim()
    || String(r.returnDepot || '').trim() || String(r.returnReceipt || '').trim() || String(r.returnRef || '').trim()
    || String(r.notes || '').trim() || String(r.declaration || '').trim() || Number(r.exitPermit) > 0
    || r.route || (r.stagesDone || []).length || (r.moves || []).some((m) => m && (m.ref || m.vehicleKind))));
  while (list.length > want && !filled(list[list.length - 1])) list.pop();
  while (list.length < want) list.push({ containerNumber: '', returnDate: '', moves: [] });
  return list;
}

customsClearanceSchema.index({ createdAt: -1 });
customsClearanceSchema.index({ blNumber: 1 });
customsClearanceSchema.index({ periodYear: 1, periodMonth: 1 });
customsClearanceSchema.index({ customerName: 1 });
customsClearanceSchema.index({ 'billing.invoiceStatus': 1 });

// Cost items that make up costs.total, the only items passed through to the customer. Matches the master formula: total costs = sum of these fields.
const COST_KEYS = [
  'returnInvoice', 'deliveryOrder', 'customsDuty', 'portFees', 'unloadingFees',
  'inspection', 'transport', 'transportToYard', 'appointmentBooking', 'storage',
  'yardFees', 'exitPermit', 'demurrage', 'extension', 'consolidator', 'commissions',
  'extraFees', 'transportYardToCustomer', 'labourExpenses', 'examFees',
];

// Margin items that make up revenue.profit. `transportSelling` is not one: it is the gross, and its net (transportNet) is what enters profit, so adding both counts transport twice. Likewise yardTransportNet is a helper column outside the profit formula.
const MARGIN_KEYS = [
  'clearanceFee', 'labour', 'yardNet', 'storageNet',
  'transportToYardNet', 'securityScan', 'transportNet', 'yardToCustomerNet', 'transportDailies',
];

// Derived nets (price − cost) — never accepted from the client.
const DERIVED_REVENUE = ['transportNet', 'yardToCustomerNet', 'yardNet', 'transportToYardNet'];

/**
 * Payment stage to cost item.
 * When Finance marks a stage of these as paid, the sum paid for it is written into its cost item, so the number is not retyped by hand. A stage in this list is not added without an amount. Correspondence milestones are not part of it.
 */
const STAGE_COST = {
  doInvoicePaid: 'deliveryOrder',
  dutyPaid: 'customsDuty',
  portFeesPaid: 'portFees',
  unloadingFeesPaid: 'unloadingFees',
  extension: 'extension',
  transportPortToCustomer: 'transport',
  transportPortToYard: 'transportToYard',
  transportYardToCustomer: 'transportYardToCustomer',
  appointmentBooking: 'appointmentBooking',
  inspection: 'inspection',
  exitPermit: 'exitPermit',
  consolidator: 'consolidator',
  commissions: 'commissions',
  labourExpenses: 'labourExpenses',
  examFees: 'examFees',
};

// The three transport-invoice parts; any of them with an attachment stands in for the old "transport invoice" when finishing a transaction (see hasTransportInvoice).
const TRANSPORT_STAGE_KEYS = ['transportInvoice', 'transportPortToCustomer', 'transportPortToYard', 'transportYardToCustomer'];

/** Writes the sum paid from its stages into the cost item. Leaves an item that never had a paid amount untouched: old transactions have hand-written costs and stages without amounts, so zeroing them would erase what was written. Returns the list of items that changed. */
// Stages that carry no money (emails, retired steps). Any other stage key without
// its own cost line — e.g. one added later from section settings — lands in extraFees.
const NON_COST_STAGES = new Set(['doInvoiceEmailed', 'doLinkEmailed', 'containersReturned', 'returnInvoiceDate', 'transportInvoice']);
const costFieldOf = (key) => STAGE_COST[key] || (key && !NON_COST_STAGES.has(key) ? 'extraFees' : null);

function applyPaidCosts(doc, onlyKeys, force = false) {
  if (!doc) return [];
  if (!doc.costs) doc.costs = {};
  const stageKeys = [...new Set([...Object.keys(STAGE_COST), ...(doc.paymentStages || []).map((p) => p && p.key).filter(Boolean)])];
  const fields = new Set((onlyKeys || stageKeys).map(costFieldOf).filter(Boolean));
  const changed = [];
  for (const field of fields) {
    const rows = (doc.paymentStages || []).filter((p) => p && costFieldOf(p.key) === field && p.payStatus === 'paid'
      && p.amount !== null && p.amount !== undefined && p.amount !== '' && Number.isFinite(Number(p.amount)));
    // A field no paid stage ever wrote keeps its typed value; `force` (a payment undone/deleted) follows what is left.
    if (!rows.length && !force) continue;
    const sum = r2(rows.reduce((a, p) => a + Number(p.amount), 0));
    if (n(doc.costs[field]) !== sum) { doc.costs[field] = sum; changed.push(field); }
  }
  return changed;
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Re-derives the computed figures on any object or document: costs.total = sum of cost items; revenue.profit = sum of margin items; revenue.totalInvoiced = costs + margin.
 * The invoice is computed, not entered (its master column is a formula); non-numeric items count as zero, not NaN. Used by pre("save") and the controller and importer update paths so derived figures never drift.
 */
function recomputeTotals(doc) {
  if (!doc) return doc;
  if (!doc.costs) doc.costs = {};
  if (!doc.revenue) doc.revenue = {};
  // Every cost line with paid stage amounts is their sum on every save, so several payments of one item always add up and no other writer (import, edit) can leave it stale.
  if (Array.isArray(doc.paymentStages) && doc.paymentStages.length) applyPaidCosts(doc);
  // Net transport is a difference, not a field to fill.
  // It used to be two hand-typed numbers (transport selling price and net transport), but the second is the first minus what we pay the carrier (`costs.transport`); writing both allows them to disagree, and profit built on a mistyped number. Rule: charging the customer 2000 and paying the carrier 1500 gives transport profit 500, computed where the other derived figures are.
  doc.revenue.transportNet = r2(n(doc.revenue.transportSelling) - n(doc.costs.transport));
  // The other two parts follow the same rule: customer price minus what we pay.
  doc.revenue.yardToCustomerNet = r2(n(doc.revenue.yardToCustomerSelling) - n(doc.costs.transportYardToCustomer));
  // An empty price counts as 0, so clearing it moves the net too (legacy rows got their price backfilled).
  doc.revenue.transportToYardNet = r2(n(doc.revenue.transportToYardSelling) - n(doc.costs.transportToYard));
  doc.revenue.yardNet = r2(n(doc.revenue.yardPrice) - n(doc.costs.yardFees));
  let total = 0;
  for (const k of COST_KEYS) total += n(doc.costs[k]);
  total = r2(total);
  let profit = 0;
  for (const k of MARGIN_KEYS) profit += n(doc.revenue[k]);
  profit = r2(profit);
  doc.costs.total = total;
  doc.revenue.profit = profit;
  doc.revenue.totalInvoiced = r2(total + profit);
  return doc;
}

customsClearanceSchema.pre('save', function (next) {
  recomputeTotals(this);
  require('../services/customsDeadlines').applyDerivedDates(this);
  this.transportInvoiceReceived = hasTransportInvoice(this);
  if (this.isNew) {
    this.pipelineVersion = 2;
    // A transaction is created with its unit count so its slots exist from day one.
    const rows = syncUnits(this.containers, this.containerCount);
    if (rows.length !== (this.containers || []).length) this.containers = rows;
  }
  next();
});

/**
 * Month and year are filled for every transaction, not only master imports.
 * They were master-sheet columns that nothing in the system filled, yet analytics, the financial report and the year/month filters read them, so transactions created after the import were missing from them. An empty value is filled from the first known date: papers received, then declaration, then creation (Riyadh time). Hand-written values are left alone.
 */
function periodFrom(doc) {
  const s = String(doc.papersReceivedDate || doc.declarationDate || '').slice(0, 10);
  let d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : null;
  if (!d || isNaN(d)) d = new Date((doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now()) + 3 * 3600000);
  return { periodYear: d.getUTCFullYear(), periodMonth: d.getUTCMonth() + 1 };
}
customsClearanceSchema.pre('save', function (next) {
  if (!this.periodYear || !this.periodMonth) {
    const p = periodFrom(this);
    if (!this.periodYear) this.periodYear = p.periodYear;
    if (!this.periodMonth) this.periodMonth = p.periodMonth;
  }
  next();
});
customsClearanceSchema.statics.periodFrom = periodFrom;

// Auto reference number: CC-00001, CC-00002, ...
customsClearanceSchema.pre('save', async function (next) {
  if (this.isNew && !this.refNumber) {
    try {
      const last = await this.constructor.findOne({}).sort({ createdAt: -1 }).select('refNumber').lean();
      let n = 1;
      if (last && last.refNumber) {
        const m = String(last.refNumber).match(/(\d+)$/);
        if (m) n = parseInt(m[1], 10) + 1;
      }
      // The latest-created row is not always the highest number: skip any number already taken.
      // eslint-disable-next-line no-await-in-loop
      while (await this.constructor.exists({ refNumber: 'CC-' + String(n).padStart(5, '0') })) n += 1;
      this.refNumber = 'CC-' + String(n).padStart(5, '0');
    } catch (e) {
      this.refNumber = 'CC-' + Date.now();
    }
  }
  next();
});

customsClearanceSchema.statics.STAGES = STAGES;

// Every write clears the whole department cache, not only the list.
// It used to clear just `customs:list`, leaving the department dashboard (`customs:dash:`) and analytics (`customs:analytics:`) on pre-write numbers for half a minute to a minute, while the screen refreshes on the event and reads the stale cache. The hook runs before the event is broadcast.
const bustCustomsList = () => { try { require('../utils/ttlCache').clear('customs:'); } catch (e) { /* noop */ } };
customsClearanceSchema.post('save', bustCustomsList);
customsClearanceSchema.post(/^find.*[UD]/, bustCustomsList); // findOneAndUpdate / findOneAndDelete / findByIdAndUpdate|Delete
// Linked operations statements follow every save.
// A statement number in a transport field, or a changed bill of lading or container, or a deleted transaction, re-links what is affected in the background (a queue the save does not wait for). See services/customsOpsLink.
const relinkOps = (doc) => { try { if (doc && doc._id) require('../services/customsOpsLink').queueClearance(doc._id); } catch (e) { /* noop */ } };
customsClearanceSchema.post('save', relinkOps);
customsClearanceSchema.post(/^find.*[UD]/, relinkOps);

module.exports = mongoose.model('CustomsClearance', customsClearanceSchema);
module.exports.STAGES = STAGES;
module.exports.LEGACY_STAGES = LEGACY_STAGES;
module.exports.TRANSPORT_LEGS = TRANSPORT_LEGS;
module.exports.CARGO_TYPES = CARGO_TYPES;
module.exports.VEHICLE_KINDS = VEHICLE_KINDS;
module.exports.pipelineOf = pipelineOf;
module.exports.readStages = readStages;
module.exports.readUnits = readUnits;
module.exports.UNIT_STAGES = UNIT_STAGES;
module.exports.PORT_LEGS = PORT_LEGS;
module.exports.lockReason = lockReason;
module.exports.hasTransportInvoice = hasTransportInvoice;
module.exports.syncUnits = syncUnits;
module.exports.COST_KEYS = COST_KEYS;
module.exports.MARGIN_KEYS = MARGIN_KEYS;
module.exports.recomputeTotals = recomputeTotals;
module.exports.STAGE_COST = STAGE_COST;
module.exports.TRANSPORT_STAGE_KEYS = TRANSPORT_STAGE_KEYS;
module.exports.DERIVED_REVENUE = DERIVED_REVENUE;
module.exports.applyPaidCosts = applyPaidCosts;
module.exports.costFieldOf = costFieldOf;

// For sources that give a net but no price (the master sheet): price = net + cost, so recomputeTotals keeps the net.
module.exports.seedPricesFromNets = function seedPricesFromNets(doc) {
  if (!doc || !doc.revenue) return doc;
  const blank = (v) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v));
  for (const [price, net, cost] of [['yardPrice', 'yardNet', 'yardFees'], ['transportToYardSelling', 'transportToYardNet', 'transportToYard']]) {
    const c = n(doc.costs && doc.costs[cost]);
    if (blank(doc.revenue[price]) && (n(doc.revenue[net]) || c)) doc.revenue[price] = r2(n(doc.revenue[net]) + c);
  }
  return doc;
};

/**
 * Legacy rows stored a typed net with no price. Give them price = net + cost so the
 * now-always-derived net keeps its value. Idempotent: only rows still missing a price.
 */
module.exports.backfillDerivedPrices = async function backfillDerivedPrices() {
  const coll = mongoose.model('CustomsClearance').collection;
  const pairs = [['yardPrice', 'yardNet', 'yardFees'], ['transportToYardSelling', 'transportToYardNet', 'transportToYard']];
  let total = 0;
  for (const [price, net, cost] of pairs) {
    const r = await coll.updateMany(
      { [`revenue.${price}`]: null, $or: [{ [`revenue.${net}`]: { $nin: [0, null] } }, { [`costs.${cost}`]: { $nin: [0, null] } }] },
      [{ $set: { [`revenue.${price}`]: { $round: [{ $add: [{ $ifNull: [`$revenue.${net}`, 0] }, { $ifNull: [`$costs.${cost}`, 0] }] }, 2] } } }],
    );
    total += r.modifiedCount || 0;
  }
  return total;
};
