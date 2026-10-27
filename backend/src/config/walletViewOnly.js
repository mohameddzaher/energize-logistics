/**
 * ── قسمُ التحصيل يرى المحفظة ولا يلمسها (صاحبُ الشركة، ٢٠٢٦/١٠/٢٧) ─────────
 * «افتح لموظف التحصيل ومدير التحصيل المحفظة — يشوفوا الفروع بس، ميعملوش أي
 * أكشن: لا صادر ولا مشتريات ولا تحصيل… يشوفوا والفلاتر والإكسبورت وبس».
 *
 * المحفظةُ صفحتان في قسم العمليّات، وفتحُ القسم لهما يفتح العمليّاتِ كلَّها. فهذه
 * قاعدةٌ ضيّقةٌ مكتوبة: الدوران يقرآن صفحتي المحفظة وحدَهما (`effectivePages`)،
 * ويمرّ نداؤهما **القارئُ** (GET) على `/api/wallet` من حارسَي القسم والصفحة —
 * وكلُّ نداءٍ كاتبٍ منهما يُردّ عند البوّابة قبل أن يصل مسارَه، مهما مُنحا
 * غيرَ ذلك في المصفوفة. والإخفاءُ في الشاشة (الويب والتطبيق) تابعٌ لا حارس.
 */
const WALLET_VIEW_ONLY_ROLES = ['collections_manager', 'collections_staff'];
const WALLET_VIEW_PAGES = ['/system/wallet', '/system/wallet-dashboard'];
const READ = new Set(['GET', 'HEAD', 'OPTIONS']);

const isWalletViewOnly = (role) => WALLET_VIEW_ONLY_ROLES.includes(String(role || ''));

/** حارسُ `/api/wallet` لدوري التحصيل بدل حارس القسم: القراءةُ تمرّ، والكتابةُ تُردّ. */
function walletViewOnlyGate(req, res, next) {
  if (!READ.has(req.method)) {
    return res.status(403).json({ message: 'المحفظة لقسم التحصيل عرضٌ فقط — لا تسجيل ولا تعديل', code: 'WALLET_VIEW_ONLY' });
  }
  req.sectionAccess = 'view';
  return next();
}

module.exports = { WALLET_VIEW_ONLY_ROLES, WALLET_VIEW_PAGES, isWalletViewOnly, walletViewOnlyGate };
