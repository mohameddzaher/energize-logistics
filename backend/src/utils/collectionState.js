/**
 * حالةُ التحصيل — ثلاثٌ لا اثنتان: لم تُحصَّل، وجزئيّة، ومحصَّلةٌ بالكامل.
 *
 * ── لماذا في مكانٍ واحد ────────────────────────────────────────────────────
 * الحالةُ تُقرأ في الفلتر فوق الجدول، وفي عمود الحالة، وفي البطاقات، وفي لوحة
 * المديونيّة، وفي كشف الحساب، وفي تحصيل المحفظة. فإن عرّفها كلٌّ بنفسه قالت
 * شاشةٌ «جزئيّة» وقالت الأخرى «لم تُحصَّل» عن الكشف نفسِه.
 *
 * ── الكاش (كشفُ التشغيل) ───────────────────────────────────────────────────
 *   محصَّلٌ بالكامل: له تاريخُ تحصيل، أو قال دفترُ الكاش «Collected» بلا تاريخ.
 *   جزئيّ: لا هذا ولا ذاك، وفيه مقبوضٌ (`collectedAmount > 0`).
 *   لم يُحصَّل: لا تاريخَ ولا مقبوض.
 * فالتاريخُ يُكتب حين يبلغ المقبوضُ القيمةَ لا قبله — راجع recordCollection.
 *
 * ── الضريبيّ (دفترُ الفواتير) ──────────────────────────────────────────────
 * راجع CollectionInvoice.stateOf / PARTIAL / NOT_STARTED — التعريفُ نفسُه على
 * الحالة بدل التاريخ (الحالةُ هي حكمُ الدفتر).
 */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** فرقُ هللةٍ لا يُعدّ باقيًا — المبالغُ تُكتب بكسرين. */
const EPS = 0.005;

const CASH_COLLECTED = Object.freeze({ $or: [{ collectionDate: { $ne: null } }, { cashCollectionStatus: 'collected' }] });
const CASH_OPEN = Object.freeze({ collectionDate: null, cashCollectionStatus: { $ne: 'collected' } });

/**
 * شرطُ حالة التحصيل على كشوف الكاش — يُضاف إلى `$and`.
 * `open` = لم يكتمل (لم يُحصَّل + جزئيّ): ما تعدّه المديونيّة.
 */
function cashStateMatch(state) {
  switch (state) {
    case 'yes': return CASH_COLLECTED;
    case 'no': return { ...CASH_OPEN, collectedAmount: { $not: { $gt: 0 } } };
    case 'partial': return { ...CASH_OPEN, collectedAmount: { $gt: 0 } };
    case 'open': return CASH_OPEN;
    default: return null;
  }
}

/** الشرطُ نفسُه داخل تجميعة — «محصَّلٌ بالكامل». */
const cashCollectedExpr = { $or: [{ $ifNull: ['$collectionDate', false] }, { $eq: ['$cashCollectionStatus', 'collected'] }] };
/** «جزئيّ» داخل تجميعة. */
const cashPartialExpr = { $and: [{ $not: [cashCollectedExpr] }, { $gt: [{ $ifNull: ['$collectedAmount', 0] }, 0] }] };
/** الباقي داخل تجميعة: صفرٌ للمحصَّل، والقيمةُ ناقصَ المقبوض لغيره (ولا ينزل تحت الصفر). */
const cashRemainingExpr = {
  $cond: [cashCollectedExpr, 0, { $max: [0, { $subtract: [{ $ifNull: ['$sellingValue', 0] }, { $ifNull: ['$collectedAmount', 0] }] }] }],
};

const cashIsCollected = (w) => !!(w && (w.collectionDate || w.cashCollectionStatus === 'collected'));
/** 'full' | 'partial' | 'none' */
const cashState = (w) => {
  if (cashIsCollected(w)) return 'full';
  return (Number(w && w.collectedAmount) || 0) > 0 ? 'partial' : 'none';
};
/** ما بقي على الكشف — والقيمةُ قيمةُ البيع، ولا يُطالَب بأقلَّ من صفر. */
const cashRemaining = (w) => (cashIsCollected(w) ? 0 : Math.max(0, r2((Number(w && w.sellingValue) || 0) - (Number(w && w.collectedAmount) || 0))));

/** الدفعةُ كما تُعرَض — بلا ما يخصّ القاعدة. */
const paymentView = (p) => ({
  _id: String(p._id),
  amount: r2(p.amount),
  date: p.date || null,
  byName: p.byName || '',
  note: p.note || '',
  mode: p.mode || 'partial',
  at: p.at || null,
});

const STATE_AR = { none: 'لم تُحصَّل', partial: 'محصَّلة جزئيًّا', full: 'محصَّلة بالكامل' };
const STATE_EN = { none: 'Not collected', partial: 'Partially collected', full: 'Fully collected' };

module.exports = {
  r2, EPS,
  CASH_COLLECTED, CASH_OPEN, cashStateMatch,
  cashCollectedExpr, cashPartialExpr, cashRemainingExpr,
  cashIsCollected, cashState, cashRemaining,
  paymentView, STATE_AR, STATE_EN,
};
