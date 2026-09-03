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
      // ── و«فاتورة ضريبيّة» ليست حركةَ مال ──────────────────────────────
      // تُقيَّد ليُعرَف أنّ الموظّف استلم فاتورةً أو كشفًا بيده، لا لأنّ مالًا
      // دخل أو خرج. فهي **خارج** رصيد المحفظة تمامًا: تُقرأ ولا تُحسَب.
      enum: ['collection', 'expense', 'purchase', 'tax_invoice'],
      required: true,
    },
    // ── والصفرُ مسموحٌ لقيد الاستلام وحدَه ────────────────────────────────
    // حركةُ مالٍ بصفرٍ لا معنى لها، فالحدُّ الأدنى يبقى على الثلاثة الأصليّة.
    // أمّا «فاتورة ضريبيّة» فقيدُ استلامٍ لا حركةُ مال، وأكثرُ ما يُستلَم يصل
    // بلا قيمةٍ معروفةٍ بعد — فاشتراطُ مبلغٍ عليه يمنع تسجيلَ الواقع.
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
    // ── الطرفُ من سجلّ التحصيل ────────────────────────────────────────────
    // كان يشير إلى `Customer` ومعه `invoice` — وكلاهما من ورك فلو «العملاء
    // والمالية» الذي زال. والتحصيلُ يُقيَّد على الطرف الذي يعرفه قسمُ التحصيل،
    // والمستحقُّ يُقرأ من كشوف التشغيل لا من فاتورةٍ تُنسَخ هنا.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectionsParty' },
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
    // ── رقمُ السند — يصل الكشفَ ولا يقف هنا ─────────────────────────────────
    // «رقم السند» عمودٌ في سير عمل التشغيل يُكتب بيدٍ بعد أن يُدفع. ومَن يدفع
    // هو من يمسك السندَ في يده لحظتَها، فيكتبه هنا مرّةً ويصل هناك — بدل أن
    // يُكتب في العهدة ويُنسى في الكشف. (`purchaseReceiptNumber` شيءٌ آخر:
    // إيصالُ المورّد، ولا يخرج من العهدة.)
    documentNumber: { type: String, trim: true, default: '' },
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
    // ما استُلم في قيد «فاتورة ضريبيّة»: رقمُ فاتورةٍ أو رقمُ كشف — وتُقرأ
    // تفاصيلُه من سير عمل التشغيل عند العرض، فلا تُنسَخ هنا وتشيخ.
    receivedDocType: { type: String, enum: ['', 'invoice', 'report'], default: '' },
    receivedDocNumber: { type: String, trim: true, default: '' },
    // ── الكشوفُ المستلَمة، جمعًا ───────────────────────────────────────────
    // الاستلامُ يقع على حزمةٍ من الكشوف لا على واحد: يأتي المندوبُ ومعه سبعةٌ
    // فيسجّلها دفعةً. وإجبارُه على قيدٍ لكلّ كشفٍ يجعله يكرّر التاريخَ والفرعَ
    // سبعَ مرّات ويترك الباقيَ حين يملّ.
    //
    // و`receivedDocNumber` باقٍ للقيود التي كُتبت قبل هذا، ويُقرأ معها.
    receivedReportNumbers: [{ type: String, trim: true }],
    // ── ورقمُ السند مع كشفه، لا في قائمةٍ موازية ────────────────────────────
    // لكلّ كشفٍ سندُه. وحفظُ الأرقام في قائمةٍ والسنداتِ في قائمةٍ أخرى يجعلهما
    // مرتبطتين بالترتيب وحدَه — وأوّلُ حذفٍ من إحداهما يزحزح الأخرى فيُنسَب
    // سندُ كشفٍ إلى غيره. فيُحفظ الزوجُ معًا.
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
