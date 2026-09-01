const mongoose = require('mongoose');

const dailyWalletSchema = new mongoose.Schema(
  {
    // ── المحفظةُ للفرع لا للموظّف ─────────────────────────────────────────────
    // كانت لكلّ موظّفٍ محفظتُه: يُختار الفرعُ ثمّ يُختار الموظّف. والنقدُ في
    // الواقع نقدُ الفرع — يعمل عليه أكثرُ من موظّفٍ في اليوم الواحد، ويُسلَّم
    // بينهم، ويُسأل عنه الفرعُ لا الشخص. فكان الرصيدُ الواحدُ مقسومًا على مَن
    // فتح شاشتَه، ولا يُقرأ إلّا بجمعه يدويًّا.
    //
    // فصار المفتاحُ الفرعَ واليوم. و`user` باقٍ للتاريخ وحدَه: يوميّاتٌ قديمةٌ
    // كُتبت باسم أصحابها قبل الدمج، ولا يُكتب بعد اليوم.
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD format for easy querying
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    totalCollections: { type: Number, default: 0 },
    totalExpenses: { type: Number, default: 0 },
    totalPurchases: { type: Number, default: 0 },
    isClosed: { type: Boolean, default: false },
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Cash reconciliation
    actualCash: { type: Number },
    cashDifference: { type: Number },
    differenceReason: { type: String, trim: true },
    differenceNotes: { type: String, trim: true },
    // Auto-close tracking
    autoClosedNote: { type: String, trim: true },
  },
  { timestamps: true }
);

// محفظةٌ واحدةٌ لكلّ فرعٍ في اليوم — لا لكلّ موظّف.
dailyWalletSchema.index({ branch: 1, date: 1 }, { unique: true });
dailyWalletSchema.index({ user: 1, date: 1 });
dailyWalletSchema.index({ date: -1 });
dailyWalletSchema.index({ isClosed: 1 });

module.exports = mongoose.model('DailyWallet', dailyWalletSchema);
