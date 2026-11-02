const crypto = require('crypto');

/**
 * Key-based authentication for systems, not people. A user session expires and is revoked on password change, and an employee account in a script would grant everything the employee has while automation needs read only.
 * The comparison is constant-time: `!==` exits at the first differing character and timing would leak the key.
 */
function requireApiKey(envVar, label) {
  const guard = (req, res, next) => {
    const expected = process.env[envVar];
    if (!expected) {
      return res.status(503).json({
        message: `${label} is not enabled — ${envVar} is not set on the server`,
        code: 'API_KEY_NOT_CONFIGURED',
      });
    }
    // Header first. The query string is also accepted because some automation tools cannot send headers, but it is logged in access logs, so the header is the recommended way.
    const given = req.headers['x-api-key'] || req.query.key || '';
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(expected));
    const equal = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!equal) {
      return res.status(401).json({ message: 'Invalid or missing API key — send it in the x-api-key header', code: 'INVALID_API_KEY' });
    }
    req.apiClient = label;
    return next();
  };
  // The guard describes itself; the docs generator reads this. See `services/apiDocs`.
  guard.__apiKey = envVar;
  guard.__apiLabel = label;
  return guard;
}

module.exports = { requireApiKey };
