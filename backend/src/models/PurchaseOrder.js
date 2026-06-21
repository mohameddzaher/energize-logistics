const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// A formal order issued to a vendor. Totals carry Saudi VAT.
const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, trim: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    purchaseRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest' },
    items: { type: [lineSchema], default: [] },

    subtotal: { type: Number, default: 0 },
    vatRate: { type: Number, default: 15 },
    vatAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    currency: { type: String, default: 'SAR' },

    status: { type: String, enum: ['draft', 'sent', 'partially_received', 'received', 'billed', 'cancelled'], default: 'draft' },
    expectedDate: { type: Date },
    receivedDate: { type: Date },

    notes: { type: String, trim: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ vendor: 1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
