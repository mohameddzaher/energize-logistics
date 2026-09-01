const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'DailyWallet', required: true },
    // مَن سجّل الحركة. المحفظةُ للفرع، والحركةُ تبقى منسوبةً إلى صاحبها —
    // «نعرف مين الموظّف» يبقى، والرصيدُ يصير واحدًا للفرع.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    type: {
      type: String,
      enum: ['collection', 'expense', 'purchase'],
      required: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    // Collection fields
    collectionSource: { type: String, enum: ['client', 'company'], default: 'client' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    deliveryStatementNumber: { type: String, trim: true },
    description: { type: String, trim: true }, // Used for company collections (بيان)
    // Expense fields (general spending - fuel, supplies, etc.)
    expenseCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory' },
    itemName: { type: String, trim: true },
    // Purchase fields (dispatch sheet related payments)
    purchaseDeliveryStatementNumber: { type: String, trim: true },
    purchaseInvoiceAmount: { type: Number },
    purchaseDriverName: { type: String, trim: true },
    purchaseReceiptNumber: { type: String, trim: true },
    purchaseBranch: { type: String, trim: true },
    // Legacy/shared fields
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    vendorName: { type: String, trim: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
    driverName: { type: String, trim: true },
    // Amount-mismatch reason — when the entered amount differs from the expected
    // value on the dispatch sheet (purchaseValue for purchases, sellingValue for
    // collections), the user must pick why. 'other' requires a free-text note.
    mismatchReason: { type: String, enum: ['daily', 'violation', 'other', null], default: null },
    mismatchNote: { type: String, trim: true },
    // Common
    reference: { type: String, trim: true },
    notes: { type: String, trim: true },
    // Risk flags
    isFlagged: { type: Boolean, default: false },
    flagReason: { type: String, trim: true },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ wallet: 1 });
walletTransactionSchema.index({ user: 1, date: 1 });
walletTransactionSchema.index({ branch: 1, date: 1 });
walletTransactionSchema.index({ type: 1 });
walletTransactionSchema.index({ customer: 1 });
walletTransactionSchema.index({ vendor: 1 });
walletTransactionSchema.index({ driver: 1 });
walletTransactionSchema.index({ isFlagged: 1 });
walletTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
