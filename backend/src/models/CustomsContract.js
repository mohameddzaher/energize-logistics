/**
 * Customs contracts: our contract with a customer, shipping agent or carrier.
 * Stored here, not in the contracts section (which covers 3PL road vendors), so it reads on the party file. Attachments use utils/fileStore.
 */
const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  fileUrl: { type: String, required: true },
  fileName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  title: { type: String, default: '' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

const customsContractSchema = new mongoose.Schema({
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomsParty', required: true, index: true },
  // Party role is copied here so contracts filter without reading each party.
  partyKind: { type: String, enum: ['customer', 'agent', 'carrier'], required: true, index: true },
  partyName: { type: String, trim: true, default: '' },

  title: { type: String, trim: true, required: true },     // Example: annual customs contract.
  contractNumber: { type: String, trim: true, default: '' },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null, index: true },
  // Value is read together with its unit: a bare number is ambiguous (per container, per month or whole contract).
  value: { type: Number, default: null },
  valueBasis: { type: String, enum: ['', 'total', 'per_container', 'per_month', 'per_shipment'], default: '' },
  paymentTermDays: { type: Number, default: 0 },
  autoRenew: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'active', 'expired', 'terminated'], default: 'active', index: true },
  scope: { type: String, trim: true, default: '' },        // What the contract covers.
  /**
   * Contract prices, used to prefill revenue and billing on each transaction for this customer (utils/customsContractPricing); still editable there.
   * Clearance fees are per container, multiplied by the transaction's container count.
   * Transport is priced per destination (port to customer) or port to yard and yard to customer.
   * null means not agreed: nothing is prefilled, never read as zero.
   */
  pricing: {
    clearanceFeePerContainer: { type: Number, default: null },
    portToYard: { type: Number, default: null },
    yardToCustomer: { type: Number, default: null },
    routes: [{
      from: { type: String, trim: true, default: '' },
      to: { type: String, trim: true, default: '' },
      price: { type: Number, default: null },
    }],
  },
  notes: { type: String, trim: true, default: '' },
  attachments: [attachmentSchema],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

customsContractSchema.index({ partyKind: 1, status: 1 });

module.exports = mongoose.models.CustomsContract || mongoose.model('CustomsContract', customsContractSchema);
