const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// The limiter is mounted with app.use('/api/', ...), so inside it Express has
// stripped the mount path — req.path is '/health', NOT '/api/health'. Match on
// the tail so health-checks and token-refresh are never throttled (a 429 on
// refresh would log active users out under load).
const isExempt = (req) => {
  const p = req.path || '';
  return p === '/health' || p === '/api/health' || p.endsWith('/auth/refresh');
};

// Key by the authenticated user when we can read their token, so a whole office
// behind ONE NAT IP doesn't share a single budget (each user gets their own).
// Anonymous traffic (login page) still keys by IP.
const keyOf = (req) => {
  try {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const token = req.cookies?.accessToken || bearer;
    if (token) {
      const d = jwt.decode(token);
      if (d && d.userId) return `u:${d.userId}`;
    }
  } catch (e) { /* fall through to IP */ }
  return ipKeyGenerator(req.ip); // IPv6-safe IP key
};

// 6000 / 15 min per user ≈ 6.7 req/s sustained per person — generous for heavy
// dashboard use, while still stopping a runaway client. Per-user keying means
// this is NOT shared across the office.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  message: { message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyOf,
  skip: isExempt,
});

// ── حدّ الدخول ───────────────────────────────────────────────────────────────
//
// كان ثلاثين محاولةً لكل ربع ساعة **لكل عنوان IP**، والدخولُ الناجح يُحسب فيها.
// والمكتب كلّه يخرج إلى الإنترنت من عنوانٍ واحد — فصباحُ الأحد بخمسين موظفًا
// يستهلك الحدّ عند الحادي والثلاثين، ويقرأ الباقون «حاولت كثيرًا» وهم لم
// يحاولوا مرّة. قفلُ شركةٍ كاملة بسبب نجاحها في الدخول.
//
// القاعدة الآن: **الناجح لا يُحسب**. الحدّ للفشل وحده — وهو ما يُحمى منه أصلًا.
// وطبقتان لأن التهديدين مختلفان:
//
//   • على الحساب الواحد: عشر محاولات فاشلة تكفي لإيقاف تخمين كلمة سرّ بعينها،
//     وتُقاس بالبريد لا بالعنوان حتى لا يُنقَذ المهاجم بتبديل شبكته.
//   • على العنوان الواحد: مئةُ فشلٍ تكفي لإيقاف مَن يجرّب حسابات كثيرة من مكان
//     واحد، وتبقى بعيدةً جدًّا عن مكتبٍ يعمل فيه الناس.
//
// وما لا يوقفه هذان (هجومٌ موزَّع على شبكاتٍ كثيرة) يوقفه قفلُ الحساب نفسه
// (User.isLocked) — لا رفعُ هذه الأرقام حتى تُعطِّل العمل.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many failed login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

/** حدٌّ على الحساب نفسه — يلاحق البريد أينما ذهب المهاجم. */
const accountAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many failed login attempts for this account, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    // بلا بريدٍ في الطلب لا حساب يُحمى، فيُترك للحدّ الآخر بدل أن يشترك كلّ
    // مَن أرسل طلبًا ناقصًا في مفتاحٍ واحد فيقفل بعضُهم بعضًا.
    return email ? `a:${email}` : ipKeyGenerator(req.ip);
  },
});

module.exports = { generalLimiter, authLimiter, accountAuthLimiter };
