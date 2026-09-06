const jwt = require('jsonwebtoken');

// توكنات وصولٍ أُبطلت بالخروج، ووقت انتهائها. تُنسى وحدها متى انتهى عمرها،
// فلا يبقى منها شيء بعد ربع ساعة من آخر خروج.
const revoked = new Map();
const isRevoked = (t) => {
  const exp = revoked.get(t);
  if (!exp) return false;
  if (exp <= Date.now()) { revoked.delete(t); return false; }
  return true;
};
const revokeAccessToken = (t, ttlMs = 16 * 60 * 1000) => { if (t) revoked.set(t, Date.now() + ttlMs); };
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of revoked) if (exp <= now) revoked.delete(t);
}, 60000).unref?.();
const User = require('../models/User');

// The cluster has high per-query latency (~90ms RTT), and this middleware runs
// on EVERY authed request — re-fetching the user each time added ~90ms to every
// API call, which is most of why pages felt slow. We cache the (lean) user for
// a short TTL so back-to-back requests in a page load reuse one lookup. The
// access token itself is short-lived (15m) and is what actually authenticates;
// this cache only backs the isActive/isLocked checks, so the worst-case
// staleness for a deactivated/locked account is USER_CACHE_TTL.
const USER_CACHE_TTL = 30 * 1000;
const userCache = new Map(); // userId -> { user, expires }

const invalidateUserCache = (userId) => {
  if (userId) userCache.delete(String(userId));
};

const authenticate = async (req, res, next) => {
  try {
    // Browsers authenticate with the httpOnly cookie; the mobile app sends the
    // same access token as `Authorization: Bearer <token>` instead (native
    // apps have no cookie jar worth trusting). Cookie wins when both exist.
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = req.cookies?.accessToken || bearer;

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // ── توكن الوصول لجلسةٍ خرجت لا يُقبَل ─────────────────────────────────────
    // الخروج كان يُبطل توكن التجديد ويمسح الكوكي، لكنّ توكن الوصول يبقى موقَّعًا
    // وصالحًا ربعَ ساعة. مَن نسخه قبل الخروج يظلّ داخلًا بعده — و«خروج» لا
    // يُخرِج ليس خروجًا. القائمة قصيرة العمر بطول عمر التوكن نفسه، فلا تنمو.
    if (isRevoked(token)) {
      return res.status(401).json({ message: 'Session ended', code: 'SESSION_ENDED' });
    }

    const cacheKey = String(decoded.userId);
    const cached = userCache.get(cacheKey);
    let user;
    if (cached && cached.expires > Date.now()) {
      user = cached.user;
    } else {
      user = await User.findById(decoded.userId).lean();
      if (user) userCache.set(cacheKey, { user, expires: Date.now() + USER_CACHE_TTL });
    }

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (!user.isActive) {
      invalidateUserCache(cacheKey);
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    if (user.isLocked) {
      invalidateUserCache(cacheKey);
      return res.status(403).json({ message: 'Account is locked' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

/**
 * مَن صاحبُ هذا الطلب — أو `null` بلا ردّ.
 *
 * ── ولماذا نسخةٌ لا تردّ ────────────────────────────────────────────────────
 * `authenticate` حارس: يرفض ويردّ. وحارسُ الصفحات (`pageGate`) يُركَّب على
 * `/api/` كلِّها — وفيها مساراتٌ عامّةٌ عمدًا (تسجيلُ الدخول، خطّافُ منصّة
 * التشغيل، واجهةُ الأسطول العامّة). فلو استعمل الحارسَ لردَّ ٤٠١ على أبوابٍ
 * مفتوحةٍ بقصد.
 *
 * فهذه تقرأ التوكن إن وُجد وتصمت إن لم يوجد، وتترك القبولَ والرفضَ لحارس
 * المسار نفسِه. وتستعمل ذاكرةَ المستخدم نفسَها، فلا استعلامَ إضافيّ.
 */
const resolveUser = async (req) => {
  if (req.user) return req.user;
  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = req.cookies?.accessToken || bearer;
    if (!token || isRevoked(token)) return null;
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const cacheKey = String(decoded.userId);
    const cached = userCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.user;
    const user = await User.findById(decoded.userId).lean();
    if (user) userCache.set(cacheKey, { user, expires: Date.now() + USER_CACHE_TTL });
    return user || null;
  } catch (_) { return null; }
};

module.exports = authenticate;
module.exports.invalidateUserCache = invalidateUserCache;
module.exports.revokeAccessToken = revokeAccessToken;
module.exports.resolveUser = resolveUser;
