const mongoose = require('mongoose');

// Contracts management: the contracts department registry, separate from HR employment contracts. Collections: ContractVendor (3PL supplier master), VendorUtilisation (one row per vendor per month; analysis screens compute from it), ContractProspect (outreach log), DeptContract (other departments contracts).
// Vendor names are free text spelled differently across sources, so every collection carries nameKey, the folded join key.

const attachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  title: { type: String, default: '' },       // Contract type, e.g. site contract / commercial register
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

// ---- ContractVendor ---------------------------------------------------------
const contractVendorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true, index: true },
  energizeRep: { type: String, default: '' },       // Outreach rep
  operationsRep: { type: String, default: '' },     // Operations rep
  vendorType: { type: String, default: '' },        // Tax / credit / cash ...
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  headquarters: { type: String, default: '' },
  destinations: { type: String, default: '' },
  coverage: { type: String, default: '' },          // Full / partial (derived or manual)
  fleetSize: { type: Number, default: 0 },
  vehicleTypes: { type: String, default: '' },
  avgMonthlyLoadsPerVehicle: { type: Number, default: 15 },
  monthlyCapacity: { type: Number, default: 0 },    // fleetSize × avgLoads unless overridden
  crNumber: { type: String, default: '' },
  // Contract state — the two signatures + the paper trail.
  vendorSideContract: { type: Boolean, default: false },
  ourSideContract: { type: Boolean, default: false },
  documentsReceived: { type: Boolean, default: false },
  missingDocuments: { type: String, default: '' },  // Which document, e.g. register and IBAN
  contractDate: { type: Date, default: null },
  renewalPolicy: { type: String, default: 'تلقائي ما لم يصدر إشعار بعدم الرغبة' },
  paymentTermDays: { type: Number, default: 30 },
  pricingNotes: { type: String, default: '' },
  operationalStatus: { type: String, default: '' }, // Active / stopped ...
  followUpNotes: { type: String, default: '' },
  notes: { type: String, default: '' },
  // Manual rating by the department manager (1..5) on top of the ranking computed from operations.
  rating: { type: Number, min: 1, max: 5, default: null },
  ratingNotes: { type: String, default: '' },
  attachments: [attachmentSchema],
  // Deep per-vendor profile tables imported from the hand-built Excel profiles
  // (branch/monthly/destination distributions, trip pricing logs, KPIs).
  // Layouts differ per vendor, so they are stored as-is and rendered generically.
  profileTables: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

contractVendorSchema.index({ energizeRep: 1 });
contractVendorSchema.index({ headquarters: 1 });

// ---- VendorUtilisation ------------------------------------------------------
const vendorUtilisationSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractVendor', default: null },
  vendorName: { type: String, required: true },
  nameKey: { type: String, required: true, index: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true },          // 1..12
  orders: { type: Number, default: 0 },
  fleetSize: { type: Number, default: 0 },
  expectedMonthlyCapacity: { type: Number, default: 0 },
  hasContract: { type: Boolean, default: false },
  vendorType: { type: String, default: '' },        // Credit / cash / external ...
  operationsRep: { type: String, default: '' },
  // The no-contract external individuals bucket is stored as one special row per month (isExternal) so shares always add up to 100%.
  isExternal: { type: Boolean, default: false },
}, { timestamps: true });

vendorUtilisationSchema.index({ nameKey: 1, year: 1, month: 1 }, { unique: true });
vendorUtilisationSchema.index({ year: 1, month: 1 });

// ---- ContractProspect -------------------------------------------------------
const contractProspectSchema = new mongoose.Schema({
  companyName: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, index: true },
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  headquarters: { type: String, default: '' },
  destinations: { type: String, default: '' },
  vehicleType: { type: String, default: '' },
  interestStatus: { type: String, default: '' },    // Interested / not interested / following up ...
  isInterested: { type: Boolean, default: null },
  contactDate: { type: Date, default: null },
  assignedTo: { type: String, default: '' },        // Who follows it
  notes: { type: String, default: '' },
  // When it became an actual vendor; stamped on promotion so it leaves the outreach list.
  convertedVendor: { type: mongoose.Schema.Types.ObjectId, ref: 'ContractVendor', default: null },
}, { timestamps: true });

// ContractCustomer: customer register in the contracts section (vendors had one; customers were only DeptContract rows found by name).
// It answers whether a contract is signed and on what terms, and reads shipping volume from its source instead of copying numbers that age.
// Linked by the folded name (`nameKey`) as with vendors.
const contractCustomerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true, index: true },
  sector: { type: String, default: '' },            // Sector: contracting, food ...
  customerType: { type: String, default: '' },      // Tax / cash / credit
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  headquarters: { type: String, default: '' },
  energizeRep: { type: String, default: '' },       // Our rep has
  crNumber: { type: String, default: '' },
  taxNumber: { type: String, default: '' },

  // Contract state: signatures and documents, identical to vendors on purpose so both screens read the same.
  customerSideContract: { type: Boolean, default: false },
  ourSideContract: { type: Boolean, default: false },
  documentsReceived: { type: Boolean, default: false },
  missingDocuments: { type: String, default: '' },
  contractDate: { type: Date, default: null },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  renewalPolicy: { type: String, default: 'تلقائي ما لم يصدر إشعار بعدم الرغبة' },
  paymentTermDays: { type: Number, default: 30 },
  pricingNotes: { type: String, default: '' },
  operationalStatus: { type: String, default: '' }, // Active / stopped ...
  followUpNotes: { type: String, default: '' },
  notes: { type: String, default: '' },
  attachments: [attachmentSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

contractCustomerSchema.index({ name: 1 });

const deptContractSchema = new mongoose.Schema({
  department: { type: String, required: true },     // '3pl' | 'fleet' | 'b2c' | 'other'
  partyType: { type: String, enum: ['vendor', 'customer'], required: true },
  partyName: { type: String, required: true, trim: true },
  contactPerson: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  subject: { type: String, default: '' },           // Contract subject / service
  contractDate: { type: Date, default: null },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  renewalPolicy: { type: String, default: '' },
  paymentTermDays: { type: Number, default: null },
  value: { type: Number, default: null },           // Value, if any
  status: { type: String, enum: ['draft', 'active', 'expired', 'terminated'], default: 'active' },
  notes: { type: String, default: '' },
  attachments: [attachmentSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

deptContractSchema.index({ department: 1, status: 1 });

// One customer across all sections: link to the parent CRM company (services/customerHub)
contractCustomerSchema.add({ crmCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'CrmCompany', default: null, index: true } });
// Copy of the master's customer code (utils/customerCode).
contractCustomerSchema.add({ customerCode: require('../utils/customerCode').codeField() });
require('../services/customerHub').attach(contractCustomerSchema, 'contracts');
module.exports = {
  ContractVendor: mongoose.models.ContractVendor || mongoose.model('ContractVendor', contractVendorSchema),
  VendorUtilisation: mongoose.models.VendorUtilisation || mongoose.model('VendorUtilisation', vendorUtilisationSchema),
  ContractProspect: mongoose.models.ContractProspect || mongoose.model('ContractProspect', contractProspectSchema),
  ContractCustomer: mongoose.models.ContractCustomer || mongoose.model('ContractCustomer', contractCustomerSchema),
  DeptContract: mongoose.models.DeptContract || mongoose.model('DeptContract', deptContractSchema),
};
