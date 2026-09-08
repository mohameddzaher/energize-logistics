/**
 * /api/client-errors — ما ينكسر عند المستخدم يصل إلينا.
 *
 * ── لماذا ────────────────────────────────────────────────────────────────
 * كان خطأُ المتصفّح يُعرَض «Application error: a client-side exception» ثمّ
 * ينتهي — لا اسمَ ولا موضعَ ولا أثر. فيُبلِّغ المستخدمُ أنّ «صفحةً وقعت» ولا
 * سبيلَ لمعرفة أيُّها ولا لماذا، ويُبحَث بالحدس.
 *
 * فيُسجَّل هنا: الرسالةُ والمسارُ والأثرُ ومَن كان يستعمل الشاشة. ولا يُطلَب
 * تسجيلُ دخولٍ — الخطأُ قد يقع قبله — ولكن يُقيَّد المعدّل حتى لا يصير البابُ
 * مصرفًا للسجلّات.
 */
const express = require('express');

const router = express.Router();

// ذاكرةٌ صغيرةٌ للتقييد: عنوان → آخرُ وقتٍ وعدد.
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
    if (seen.size > 5000) seen.clear();          // لا تنمو بلا حدّ

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
    res.json({ ok: true });                       // التبليغُ لا يفشل أبدًا
  }
});

module.exports = router;
