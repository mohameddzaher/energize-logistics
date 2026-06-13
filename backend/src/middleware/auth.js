const jwt = require('jsonwebtoken');
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
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

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

module.exports = authenticate;
module.exports.invalidateUserCache = invalidateUserCache;
