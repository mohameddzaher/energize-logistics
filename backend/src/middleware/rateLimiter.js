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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generalLimiter, authLimiter };
