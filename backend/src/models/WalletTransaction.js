const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'DailyWallet', required: true },
    // Who recorded the transaction. The wallet is per branch and the entry stays attributed to its author, while the balance is one per branch.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    type: {
      type: String,
      // A tax-invoice entry is not a money movement. It records that the employee received an invoice or statement, so it sits outside the wallet balance entirely: read, never counted.
      enum: ['collection', 'expense', 'purchase', 'tax_invoice'],
      required: true,
    },
    // Zero is allowed only for the receipt entry. A zero money movement is meaningless so the minimum stays for the original three types, but a tax-invoice receipt often arrives with no known value yet.
    amount: {
      type: Number,
      required: true,
      min: [0, 'المبلغ لا يكون سالبًا'],
      validate: {
        validator(v) { return this.type === 'tax_invoice' ? v >= 0 : v >= 0.01; },
        message: 'المبلغ يجب أن يكون أكبر من صفر',
      },
    },
    // Collection fields
    collectionSource: { type: String, enum: ['client', 'company'], default: 'client' },
    // Party from the collections register. It used to point at `Customer` and `invoice` from the removed customers-and-finance workflow. Collection is recorded against the party known to the collections section and amounts due are read from operations statements, not a copied invoice.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty' },
    deliveryStatementNumber: { type: String, trim: true },
    description: { type: String, trim: true }, // Used for company collections (statement).
    // Expense fields (general spending - fuel, supplies, etc.)
    expenseCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory' },
    itemName: { type: String, trim: true },
    // Purchase fields (dispatch sheet related payments)
    purchaseDeliveryStatementNumber: { type: String, trim: true },
    purchaseInvoiceAmount: { type: Number },
    purchaseDriverName: { type: String, trim: true },
    // Voucher number as shown on screen. Stored here and carried to the voucher-number column of the operations workflow: one field filled once, not two identical questions.
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
    // Common fields. What was received in a tax-invoice entry: an invoice or statement number; details are read from the operations workflow at display time rather than copied and left to go stale.
    receivedDocType: { type: String, enum: ['', 'invoice', 'report'], default: '' },
    receivedDocNumber: { type: String, trim: true, default: '' },
    // Received statements, plural. Receipt covers a bundle of statements (a rep may bring seven), so one entry per statement would force repeating date and branch. `receivedDocNumber` stays for entries written earlier.
    receivedReportNumbers: [{ type: String, trim: true }],
    // The voucher number is stored with its statement, not in a parallel list; two lists linked by position misattribute a voucher after any deletion, so the pair is stored together.
    receivedReports: [{
      _id: false,
      reportNumber: { type: String, trim: true },
      documentNumber: { type: String, trim: true, default: '' },
    }],
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
