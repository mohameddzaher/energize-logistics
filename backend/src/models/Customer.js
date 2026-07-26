const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    customerNumber: { type: String, unique: true, sparse: true, trim: true },
    companyName: { type: String, required: true, trim: true, unique: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    creditTerm: {
      type: Number,
      enum: [15, 30, 45, 60],
      required: true,
      default: 30,
    },
    creditLimit: { type: Number, required: true, default: 0 },
    currentOutstanding: { type: Number, default: 0 },
    office: { type: String, trim: true },
    assignedCollector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    salesManager: { type: String, trim: true },
    grade: {
      type: String,
      enum: ['A', 'B', 'C', 'D'],
      default: 'A',
    },
    clientStatus: {
      type: String,
      enum: [
        'good_client',
        'late_payment',
        'stopped_by_us',
        'stopped_by_client',
        'under_review',
        'legal_action',
        'write_off',
        'payment_plan',
        'new_client',
        'vip_client',
      ],
      default: 'new_client',
    },
    isStopped: { type: Boolean, default: false },
    stoppedAt: { type: Date },
    stoppedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastPaymentDate: { type: Date },
    lastPaymentAmount: { type: Number },
    riskScore: { type: Number, default: 0, min: 0, max: 100 },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
    },
    isActive: { type: Boolean, default: true },
    notes: { type: String },
  },
  { timestamps: true }
);

customerSchema.index({ assignedCollector: 1 });
customerSchema.index({ isActive: 1, createdAt: -1 }); // the customers page's default query
customerSchema.index({ riskLevel: 1 });
customerSchema.index({ office: 1 });
customerSchema.index({ grade: 1 });
customerSchema.index({ clientStatus: 1 });

module.exports = mongoose.model('Customer', customerSchema);
