/**
 * مَن يرى عهدةَ الفروع، ومَن يختار الفرعَ الذي يراه.
 *
 * ── لماذا في ملفٍّ واحد ────────────────────────────────────────────────────
 * كانت هذه القوائمُ مكتوبةً بيدٍ في ثلاثة مواضع: رابطُ العهدة في القائمة،
 * ورابطُ لوحتها، وشرطُ ظهور محدِّد الفرع داخل الصفحة. وأُضيف المحاسبُ في
 * الخادم ونُسي في الثلاثة — ففُتحت له النقاطُ ولم تُفتح له الشاشة: لا يجد
 * الرابطَ في القائمة، ومن يصل بالعنوان يُقال له «لا فرعَ لحسابك».
 *
 * قائمةٌ تُكتب ثلاثَ مرّات تُصحَّح مرّةً وتُنسى مرّتين.
 */


/** مَن يفتح صفحةَ العهدة اليوميّة (مرآةُ `walletReadRoles` في الخادم). */
export const WALLET_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'operations_staff', 'moderator',
  'finance_manager', 'accountant',
  'collections_manager', 'collections_staff',
];

/** ومَن يفتح لوحتَها — نظرةُ الفروع كلِّها (مرآةُ `overviewRoles`). */
export const WALLET_DASHBOARD_ROLES = [
  'super_admin', 'admin', 'it_manager', 'it_specialist',
  'operations_manager', 'moderator',
  'finance_manager', 'accountant',
];

/**
 * ── ومَن يُقفَل على فرعه ────────────────────────────────────────────────────
 * موظّفُ العمليات وحدَه: عهدتُه عهدةُ فرعه، ولا شأنَ له بغيره. وما عداه يختار
 * الفرعَ الذي ينظر فيه.
 *
 * وكُتب الشرطُ عكسًا عن قصد — «مَن يُقفَل» لا «مَن يختار». القائمةُ الموجبةُ
 * تُنسى كلَّما دخل دورٌ جديد، فيقف صاحبُه أمام صفحةٍ تقول له «لا فرعَ لحسابك»
 * وهو لا يملك فرعًا ولا يُفترَض أن يملك. والقائمةُ السالبةُ تُصيب الجديدَ من
 * أوّل يوم.
 */
export const BRANCH_LOCKED_ROLES = ['operations_staff'];

export const canPickWalletBranch = (role?: string | null) =>
  !!role && !BRANCH_LOCKED_ROLES.includes(role);
