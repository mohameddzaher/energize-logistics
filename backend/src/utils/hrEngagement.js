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

/**
 * ── «حالة العمل» ثلاث: يعمل · شركة شقيقة · لا يعمل (صاحبُ الشركة، ٢٠٢٦/١٠/١٩) ──
 *   يعمل         على رأس عمله.
 *   شركة شقيقة   موظّفٌ عاديٌّ على كفالتنا يعمل لدى شركةٍ شقيقة — ليس إنهاءَ خدمة،
 *                ويُعامَل في كلّ قسمٍ كموظّف (`sisterCompany` على ملفٍّ قائم).
 *   لا يعمل      = إنهاءُ الخدمة، وحالتُه إحدى اثنتين:
 *                  انتظار نقل الكفالة · خروج نهائي.
 * ثمّ: خارجَ النظام (أو فريلانسر) ← الأرشيف فورًا؛ داخلَ النظام ← ينتظر «خروج من
 * النظام» ثمّ الأرشيف.
 */
const TERMINATION_KINDS = {
  transfer_pending: { ar: 'انتظار نقل الكفالة', en: 'Awaiting sponsorship transfer' },
  final_exit: { ar: 'خروج نهائي', en: 'Final exit' },
};
const SISTER = 'شركة شقيقة';
const TRANSFER_DAYS = 30;
const WORKING = 'يعمل';
const NOT_WORKING = 'لا يعمل';
/** نصُّ «حالة العمل» كما يُكتب ويُعرَض — مشتقٌّ من الحالة لا يُكتب باليد. */
function workStatusTextOf(e) {
  if (e?.employmentStatus !== 'terminated') return e?.sisterCompany ? SISTER : WORKING;
  const k = TERMINATION_KINDS[e?.terminationKind];
  return k ? `${NOT_WORKING} — ${k.ar}` : NOT_WORKING;
}
/** إنهاءُ خدمته يؤرشفه فورًا — فلا يُسأل عن حالة. */
const archivesOnTermination = (e) => String(e?.systemStatus || '').trim() === SYSTEM_OUT || engagementOf(e) === 'freelance';

module.exports = {
  TERMINATION_KINDS, TRANSFER_DAYS, WORKING, NOT_WORKING, SISTER, workStatusTextOf, archivesOnTermination,
  SYSTEM_OUT, SYSTEM_IN, engagementOf, contractRequired, isArchived,
  ARCHIVED, NOT_ARCHIVED, withoutArchived, ENGAGEMENT_MATCH,
};
