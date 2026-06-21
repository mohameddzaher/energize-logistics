const mongoose = require('mongoose');

// A line item on a purchase request / order.
const lineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// A request to buy something — goes through an approval step before becoming a PO.
const purchaseRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    department: { type: String, trim: true },
    items: { type: [lineSchema], default: [] },
    totalEstimate: { type: Number, default: 0 },
    justification: { type: String, trim: true },
    neededBy: { type: Date },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    suggestedVendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },

    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected', 'ordered'], default: 'draft' },
    approval: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
      note: { type: String, trim: true },
    },
    // Set once converted to a purchase order.
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

purchaseRequestSchema.index({ status: 1, createdAt: -1 });
purchaseRequestSchema.index({ requester: 1 });

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema);
