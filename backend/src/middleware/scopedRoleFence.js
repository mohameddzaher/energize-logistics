/**
 * سياجُ الأدوار المحصورة — الحسابُ الخارجيُّ لا يصل إلّا ما كُتب له.
 *
 * يُركَّب على `/api/` كلِّها قبل حارس الصفحات وحرّاس الأقسام. لا يمسّ غيرَ
 * الأدوار المحصورة (config/scopedRoles)، ولا يردّ على باب عامّ: بلا توكن يمضي
 * الطلبُ إلى حارس المسار نفسِه كما كان.
 *
 * ── لماذا قائمةُ سماح ─────────────────────────────────────────────────────────
 * في النظام نقاطٌ كثيرةٌ تكتفي بأن يكون الطالبُ مسجَّلًا. ومنعُها واحدةً واحدةً
 * يعني أنّ أوّلَ نقطةٍ تُضاف بعد اليوم مفتوحةٌ للشريك حتى يتذكّرها أحد. فالقاعدةُ
 * معكوسة: ما لم يُكتب في `api` مغلق.
 *
 * والمقارنةُ على المسار بعد فكّ ترميزه، ويُرفَض ما فيه `..`: مسارٌ يبدأ ببادئةٍ
 * مسموحةٍ ثمّ يصعد منها لا يُقرأ مسموحًا.
 */
const { resolveUser } = require('./auth');
const { scopeOf } = require('../config/scopedRoles');

const within = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

const scopedRoleFence = async (req, res, next) => {
  try {
    const user = await resolveUser(req);
    const scope = user && scopeOf(user.role);
    if (!scope) return next();
    let path = (req.originalUrl || req.url || '').split('?')[0];
    try { path = decodeURIComponent(path); } catch (_) { /* يبقى كما هو */ }
    const ok = !/(^|\/)\.\.?(\/|$)/.test(path) && scope.api.some((p) => within(path, p));
    if (ok) return next();
    return res.status(403).json({
      code: 'SCOPE_FORBIDDEN',
      message: 'هذا الحساب مخصّص لصفحة واحدة / This account is limited to one page',
    });
  } catch (e) {
    // السياجُ يحرس حسابًا خارجيًّا، فعطبُه يُغلق ولا يفتح — لكن على المحصور وحدَه:
    // لا نعرف هنا إن كان الطالبُ محصورًا، فيُترك لحرّاس المسار.
    return next();
  }
};

module.exports = scopedRoleFence;
module.exports.within = within;
