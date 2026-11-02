/** /api/client-errors: browser failures reach us. A browser error used to show a generic 'Application error' with no name, location or trace. It records the message, path, trace and who was using the screen. No login required, since the error may occur before it; the rate is limited so the endpoint cannot become a log sink. */
const express = require('express');

const router = express.Router();

// Small in-memory throttle: address to last time and count.
const seen = new Map();
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 20;

router.post('/', express.json({ limit: '64kb' }), (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = seen.get(ip) || { at: now, n: 0 };
    if (now - rec.at > WINDOW_MS) { rec.at = now; rec.n = 0; }
    rec.n += 1;
    seen.set(ip, rec);
    if (rec.n > MAX_PER_WINDOW) return res.status(429).json({ ok: false });
    if (seen.size > 5000) seen.clear();          // Bounded so it cannot grow without limit.

    const b = req.body || {};
    const line = [
      'CLIENT_ERROR',
      `path=${String(b.path || '').slice(0, 200)}`,
      `name=${String(b.name || '').slice(0, 80)}`,
      `msg=${String(b.message || '').slice(0, 300)}`,
      `digest=${String(b.digest || '').slice(0, 40)}`,
      `user=${req.user?._id || 'anon'}`,
    ].join(' | ');
    console.error(line);
    if (b.stack) console.error(String(b.stack).slice(0, 2000));
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });                       // Reporting must never fail.
  }
});

module.exports = router;
