const mongoose = require('mongoose');

// A vendor invoice (accounts payable). Creating one posts a journal entry
// (Dr Expense + VAT, Cr Accounts Payable); paying it posts Dr A/P, Cr Cash.
const vendorBillSchema = new mongoose.Schema(
  {
    billNumber: { type: String, trim: true },
    vendorInvoiceNumber: { type: String, trim: true }, // the number on the vendor's own invoice
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },

    subtotal: { type: Number, default: 0 },
    vatAmount: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'SAR' },

    billDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    category: { type: String, trim: true },

    status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    paidAt: { type: Date },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

vendorBillSchema.index({ status: 1, dueDate: 1 });
vendorBillSchema.index({ vendor: 1 });

module.exports = mongoose.model('VendorBill', vendorBillSchema);
