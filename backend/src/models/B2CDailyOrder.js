const mongoose = require('mongoose');

const b2cDailyOrderSchema = new mongoose.Schema(
  {
    rep: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CRep', required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'B2CProject', index: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },
    // Date is stored as a YYYY-MM-DD string AND a Date object for fast range queries
    date: { type: Date, required: true, index: true },
    dateKey: { type: String, required: true, index: true }, // 'YYYY-MM-DD'
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    day: { type: Number, required: true },   // 1-31
    orders: { type: Number, default: null }, // null = not entered yet, 0 = worked but no orders
    worked: { type: Boolean, default: true }, // false means rep was off
    source: { type: String, enum: ['manual', 'excel'], default: 'manual' },
    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
    // Trace info — only set on Excel uploads. Lets the user inspect which row in which
    // sheet contributed the value when numbers look unexpected.
    sourceSheet: { type: String, trim: true },
    sourceRow: { type: Number },
  },
  { timestamps: true }
);

// One row per (rep, day)
b2cDailyOrderSchema.index({ rep: 1, dateKey: 1 }, { unique: true });
b2cDailyOrderSchema.index({ project: 1, dateKey: 1 });
b2cDailyOrderSchema.index({ branch: 1, dateKey: 1 });
b2cDailyOrderSchema.index({ year: 1, month: 1 });

module.exports = mongoose.model('B2CDailyOrder', b2cDailyOrderSchema);
