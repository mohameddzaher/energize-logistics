/**
 * financeAuthority — أهلُ المال يملكون في دفاتره ما يملكه مديرُ النظام.
 *
 * ── القرار ─────────────────────────────────────────────────────────────────
 * المحفظةُ ولوحتُها، وصفحةُ التشغيل والتشغيلُ الخاصّ، ومخزنُ النقل الثقيل
 * والنقلُ الخفيف: كلُّ ما يفعله مديرُ النظام فيها (تعديلُ قيدٍ مسجَّلٍ وحذفُه
 * ونقلُه، وإعادةُ فتح يومٍ أُقفل، والكتابةُ في يومٍ مقفل، وحذفُ كشفٍ وفرضُ
 * مرحلته) يفعله **المحاسبُ ومديرُ الحسابات والمديرُ الماليّ** — هم من يُسأل عن
 * الدفتر إن اختلف، ومن لا يملك تصحيحَه لا يصحّ أن يُسأل عنه.
 *
 * وهو قرارٌ على هذه الصفحات وحدَها: لا يجعلهم مديري نظامٍ في غيرها (المستخدمون،
 * الصلاحيّات، تصفيرُ المحافظ كلِّها). فلا يُوسَّع `hasSuperAdminPowers` — تلك
 * تُقرأ في النظام كلِّه — بل يُسأل هنا سؤالٌ أضيق.
 */
const FINANCE_FULL_ROLES = ['cfo', 'accounting_manager', 'accountant'];

const isFinanceFull = (role) => FINANCE_FULL_ROLES.includes(role);

/** مديرُ النظام (أو من مُنح صلاحيّاتِه كاملةً)، أو أحدُ أهل المال. */
const hasFinancePowers = async (role) => {
  if (!role) return false;
  if (role === 'super_admin' || isFinanceFull(role)) return true;
  const { hasSuperAdminPowers } = require('../utils/permissions');
  return hasSuperAdminPowers(role);
};

module.exports = { FINANCE_FULL_ROLES, isFinanceFull, hasFinancePowers };
