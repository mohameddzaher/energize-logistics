const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    balance: { type: Number, default: 0, min: 0 },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    creditTerm: {
      type: Number,
      enum: [15, 30, 45, 60],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue', 'frozen', 'disputed', 'refunded'],
      default: 'pending',
    },
    isFrozen: { type: Boolean, default: false },
    frozenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    frozenAt: { type: Date },
    refundedAt: { type: Date },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

invoiceSchema.pre('save', function (next) {
  this.balance = this.amount - this.paidAmount;
  if (this.balance <= 0 && !this.isFrozen) {
    this.status = 'paid';
    this.balance = 0;
  }
  next();
});

invoiceSchema.index({ customer: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ dueDate: 1 });
// invoiceNumber index already created by unique: true

module.exports = mongoose.model('Invoice', invoiceSchema);
