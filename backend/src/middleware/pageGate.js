/**
 * حارسُ الصفحات — صلاحيّةُ الصفحة تحرس البيانات لا الشاشةَ وحدَها.
 *
 * ── ما كان ──────────────────────────────────────────────────────────────────
 * كانت صلاحيّةُ الصفحة تُخفي الرابطَ وتمنع فتحَ المسار، وتقول الشاشةُ صراحةً إنّ
 * الحارسَ على البيانات هو القسمُ وحدَه. وذلك عيبٌ مُعلَنٌ لا مُصلَح: مَن يعرف
 * نقطةَ الـ API ينادِيها من خارج الشاشة، فالإعدادُ يبدو حارسًا وليس بحارس.
 *
 * ── وما صار ─────────────────────────────────────────────────────────────────
 * الخريطةُ في `config/pageApis` تُجيب: أيُّ صفحاتٍ تنادي هذه النقطة؟ فإن كانت
 * كلُّها مغلقةً على هذا الدور رُدَّت النقطةُ ٤٠٣ — بلا حاجةٍ إلى تصديق ما يقوله
 * المتصفّح عن نفسه، وهو ما لا يُوثَق به. راجع رأسَ ذلك الملفّ لقاعدة القرار.
 *
 * ── وثلاثةُ ضماناتٍ ألّا يُغلَق بابٌ بالخطأ ───────────────────────────────────
 *   • نقطةٌ لا تعرفها الخريطةُ تمرّ كما كانت — لا نمنع ما لم نره.
 *   • صفحةٌ لم يُقرأ نداؤها ساكنًا تُوسَّع إلى قسمها، فالشكُّ يوسِّع.
 *   • وخطأٌ في الحارس نفسِه يمرّ (fail-open): عطبٌ فيه لا يوقف الشركة.
 *
 * وهو يضيّق **داخل** ما منحه القسم؛ حارسُ القسم قبله كما هو.
 */
const { decide } = require('../config/pageApis');
const { resolveUser } = require('./auth');
const { effectivePages } = require('../utils/permissions');
const { FULL_ACCESS_ROLES } = require('../config/constants');
const { getPage } = require('../config/pages');

const pageGate = async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    // بلا مستخدم: حارسُ المسار نفسِه يقرّر — قد يكون بابًا عامًّا بقصد.
    if (!user) return next();
    if (FULL_ACCESS_ROLES.includes(user.role)) return next();

    // `req.path` هنا نسبيٌّ إلى موضع التركيب، و`originalUrl` يحمل الاستعلام.
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (!path.startsWith('/api/')) return next();

    const pages = await effectivePages(user.role);
    const verdict = decide(path, (key) => pages[key] !== false);
    if (!verdict || verdict.ok) return next();

    // ── والرفضُ يقول أيَّ صفحةٍ يُطلَب فتحُها ──────────────────────────────
    // «غير مصرّح» وحدَها تُقرأ عطلًا، فتُعاد المحاولةُ مرّاتٍ ثمّ يُتَّصل بالدعم.
    // واسمُ الصفحة يجعل الطلبَ محدَّدًا: «افتحوا لي صفحة كذا».
    const names = verdict.pages.map((k) => getPage(k)?.ar || k);
    return res.status(403).json({
      code: 'PAGE_FORBIDDEN',
      message: `هذه البيانات تخصّ صفحةً خارج صلاحيّاتك: ${names.join('، ')}`,
      pages: verdict.pages,
    });
  } catch (e) {
    // الحارسُ يضيّق، وعطبُه لا يجوز أن يوقف العمل.
    return next();
  }
};

module.exports = pageGate;
