/**
 * hrEngagement — نوعُ ارتباط الموظّف، والأرشيف. قاعدةٌ واحدةٌ تقرؤها كلُّ شاشة.
 *
 * ── على الكفالة / فريلانسر / متدرّب (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ─────────────
 * يُقرأ من «رقم السجل التجاري» (`registerNumber`) وحدَه:
 *   · رقمُ سجلٍّ تجاريٍّ من سجلّاتنا (أرقامٌ: 7025667531 · 7038387267 …) ← على الكفالة
 *   · «فري لانسر»                                                       ← فريلانسر
 *   · «تدريب» / متدرّب                                                   ← متدرّب (لا هذا ولا ذاك)
 *   · فارغ                                                               ← غير محدّد
 * كان «النوع» (`employmentType`) يُكتب وحدَه فيختلف عن السجلّ (٧٠ فريلانسر هناك
 * و٩٠ هنا). والسجلُّ هو ما يُسأل عنه، فهو الأصل.
 *
 * والفريلانسرُ والمتدرّبُ لا عقدَ لهما — لا يُقال عن أحدهما «بلا عقد».
 *
 * ── الأرشيف ──────────────────────────────────────────────────────────────
 * مَن أُنهيت خدمتُه ثمّ أُخرج من النظام (`systemStatus` = «خارج النظام»)، أو
 * فريلانسرٌ أُنهيت خدمتُه (لا خروجَ من نظامٍ ليس عليه أصلًا). المؤرشَفُ لا يظهر
 * في أيّ شاشةٍ ولا رقمٍ — إلّا صفحةَ الأرشيف وكارتَها.
 *
 * ولا يُخزَّن «مؤرشَف»: يُشتقّ في الاستعلام نفسِه من الحالة والخروج والسجلّ،
 * فلا يتأخّر ولا يختلف عن مصدره لحظة.
 */
const SYSTEM_OUT = 'خارج النظام';
const SYSTEM_IN = 'داخل النظام';
const FREELANCE_RX = /فري\s*لانس|فريلانس|freelanc/i;
const TRAINEE_RX = /تدريب|متدرب|trainee/i;
const CR_RX = /^\s*\d{6,}\s*$/;

/** 'sponsored' | 'freelance' | 'trainee' | '' */
function engagementOf(e) {
  const r = String(e?.registerNumber ?? '').trim();
  if (!r) return '';
  if (FREELANCE_RX.test(r)) return 'freelance';
  if (TRAINEE_RX.test(r)) return 'trainee';
  if (CR_RX.test(r)) return 'sponsored';
  return '';
}
/** مَن لا يُطلَب له عقد. */
const contractRequired = (e) => !['freelance', 'trainee'].includes(engagementOf(e));

const isArchived = (e) => e?.employmentStatus === 'terminated'
  && (String(e?.systemStatus || '').trim() === SYSTEM_OUT || engagementOf(e) === 'freelance');

// الشرطُ نفسُه استعلامًا (find و$match معًا).
const ARCHIVED = {
  employmentStatus: 'terminated',
  $or: [{ systemStatus: SYSTEM_OUT }, { registerNumber: { $regex: FREELANCE_RX.source, $options: 'i' } }],
};
const NOT_ARCHIVED = { $nor: [ARCHIVED] };

/** يضمّ «غيرَ المؤرشَف» إلى فلترٍ قائم دون أن يطأ `$or`/`$nor` فيه. */
const withoutArchived = (filter = {}) => ({ ...filter, $and: [...(filter.$and || []), NOT_ARCHIVED] });

// شروطُ النوع استعلامًا.
const ENGAGEMENT_MATCH = {
  sponsored: { registerNumber: { $regex: CR_RX.source } },
  freelance: { registerNumber: { $regex: FREELANCE_RX.source, $options: 'i' } },
  trainee: { registerNumber: { $regex: TRAINEE_RX.source, $options: 'i' } },
};

module.exports = {
  SYSTEM_OUT, SYSTEM_IN, engagementOf, contractRequired, isArchived,
  ARCHIVED, NOT_ARCHIVED, withoutArchived, ENGAGEMENT_MATCH,
};
