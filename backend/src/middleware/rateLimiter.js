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

// Login rate limit: failures only, successful logins are not counted. The old limit (30 per 15 minutes per IP) locked a whole office that shares one IP on a busy morning.
// Per account: ten failed attempts, keyed by email not IP so switching network does not help. Per IP: a hundred failures, far above what an office produces.
// Distributed attacks are stopped by account lockout (User.isLocked), not by raising these numbers.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many failed login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

/** Limit on the account itself; follows the email wherever the attacker goes. */
const accountAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many failed login attempts for this account, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    // With no email in the request there is no account to protect; leave it to the IP limit so incomplete requests do not all share one key and lock each other out.
    return email ? `a:${email}` : ipKeyGenerator(req.ip);
  },
});

module.exports = { generalLimiter, authLimiter, accountAuthLimiter };
