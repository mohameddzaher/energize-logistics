/**
 * نوعُ ارتباط الموظّف — على الكفالة أم عملٌ حرّ.
 *
 * ── والفريلانسر لا عقدَ له ────────────────────────────────────────────────
 * مَن ليس على كفالتنا فلا عقدَ بيننا وبينه، فبياناتُ العقد في حقّه ليست
 * «ناقصة» بل **غيرُ مطلوبة**. والفرقُ ليس تجميلًا: عمودُ «مطلوب» هو قائمةُ
 * عملِ فريق الموارد البشريّة، فوضعُ سبعةٍ وستّين اسمًا فيه يُشغلهم بجمع ورقٍ
 * لا وجودَ له.
 *
 * ويُقلَب في أيّ وقت: مَن نقلناه إلى كفالتنا تعود بياناتُ عقده مطلوبةً كغيره
 * — من صفحة العقود أو من ملفّه، والقاعدةُ واحدةٌ في الموضعين.
 */
const SPONSORED = 'sponsored';
const FREELANCER = 'freelancer';

// حقولُ العقد التي لا معنى لها بلا كفالة.
const CONTRACT_FIELDS = [
  'contractStatusText', 'qiwaContractNumber', 'contractOccupation',
  'contractStartDate', 'contractEndDate', 'annualLeaveDays', 'probationMonths',
];

const isFreelancerType = (v) => String(v || '').trim() === FREELANCER;

/**
 * يبني ما يُكتب على الموظّف حين يتغيّر نوعُه.
 *
 * يُعيد `$set` جاهزًا: النوعَ نفسَه، ومرآتَه المنطقيّة، وحالاتِ حقول العقد.
 * ولا يمسّ **قيمَ** العقد — مَن كان له عقدٌ ثمّ صار عملًا حرًّا يبقى تاريخُه
 * مكتوبًا؛ الذي يتغيّر هو أنّه لم يعد مطلوبًا.
 */
function applyEmploymentType(type) {
  const t = String(type || '').trim();
  const free = isFreelancerType(t);
  const set = { employmentType: t, isFreelancer: free };
  for (const f of CONTRACT_FIELDS) {
    // «غير مطلوب» للعمل الحرّ، وتُرفَع العلامةُ عند العودة إلى الكفالة فتُقرأ
    // الحالةُ من القيمة كما لبقيّة الناس.
    set[`fieldStatus.${f}Status`] = free ? 'not_required' : '';
  }
  return set;
}

module.exports = { SPONSORED, FREELANCER, CONTRACT_FIELDS, isFreelancerType, applyEmploymentType };
