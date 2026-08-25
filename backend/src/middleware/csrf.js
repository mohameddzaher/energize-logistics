const { isAllowedOrigin } = require('../config/cors');

/**
 * ردّ الطلبات المزوَّرة عبر المواقع (CSRF) على كل ما يغيّر حالة.
 *
 * ── لماذا لا تكفي CORS ─────────────────────────────────────────────────────
 * كوكيز الجلسة هنا `SameSite=None` بالضرورة: الواجهة على نطاق والخادم على نطاقٍ
 * آخر، فبغيرها لا تصل الكوكي أصلًا. ومعناها أن المتصفّح يرسلها مع طلبٍ ينطلق من
 * **أيّ** موقع. وطلبُ استمارةٍ عاديّة (`form-urlencoded`) طلبٌ «بسيط» لا يسبقه
 * فحصٌ مسبق، فيصل المعالِجَ وينفَّذ قبل أن تُستشار CORS أصلًا — CORS تحجب قراءة
 * الردّ لا وقوع الفعل. والفعل هو الضرر.
 *
 * ── ما يفعله هذا ───────────────────────────────────────────────────────────
 * يقرأ `Origin` (أو `Referer` حين يسقط الأوّل) ويقارنه بقائمة أصول الموقع. وما
 * جاء من أصلٍ غريب يُرَدّ قبل أن يبلغ أيّ معالِج.
 *
 * ── ولماذا يُشترَط وجود الأصل هنا خلافًا لـ`isAllowedOrigin` ───────────────
 * تلك تسمح بغياب الأصل لأن الطلب من خادمٍ إلى خادم لا أصلَ له. لكنّ غياب الأصل
 * في طلبٍ **يحمل كوكي جلسة** يعني متصفّحًا يُخفيه — وهو ما يفعله المهاجم. فإن
 * لم تكن هناك كوكي جلسة (تطبيقٌ يحمل توكنه في الترويسة، أو أداةٌ خادميّة) فلا
 * خطر أصلًا: المتصفّح لا يستطيع إرسال ترويسة `Authorization` من موقعٍ غريب.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// مسارات تُنادى من أنظمة خارجية بلا متصفّح، وتحمي نفسها بسرٍّ مشترك.
const EXEMPT = [/^\/api\/ops\/webhook/, /^\/api\/health/];

function csrfGuard(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const path = req.originalUrl.split('?')[0];
  if (EXEMPT.some((rx) => rx.test(path))) return next();

  // بلا كوكي جلسة لا سبيل للمتصفّح أن يزوّر شيئًا باسم أحد.
  const hasSessionCookie = !!(req.cookies?.accessToken || req.cookies?.refreshToken);
  if (!hasSessionCookie) return next();

  const origin = req.headers.origin
    || (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch (e) { return ''; } })() : '');

  if (origin && isAllowedOrigin(origin)) return next();

  return res.status(403).json({
    message: 'طلبٌ من مصدر غير معروف',
    code: 'CSRF_ORIGIN_REJECTED',
  });
}

module.exports = csrfGuard;
