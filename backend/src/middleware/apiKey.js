const crypto = require('crypto');

/**
 * مصادقةٌ بمفتاح — للأنظمة لا للبشر.
 *
 * ── ولماذا لا تُستعمل جلسةُ مستخدم ─────────────────────────────────────────
 * الأتمتة تعمل بلا إنسانٍ يفتح متصفّحًا، وجلسةُ النظام تنتهي وتُجدَّد وتُبطَل
 * بتغيير كلمة سرّ. ووضعُ حساب موظّفٍ في سكربتٍ يعني أن السكربت يملك ما يملكه
 * الموظّف كلَّه — والأتمتة لا تحتاج إلا القراءة.
 *
 * والمقارنة ثابتة الزمن: `!==` تخرج عند أوّل محرفٍ مختلف، وفرقُ الزمن بين
 * محاولةٍ ومحاولة يكشف المفتاح محرفًا محرفًا لمن يقيسه.
 */
function requireApiKey(envVar, label) {
  return (req, res, next) => {
    const expected = process.env[envVar];
    if (!expected) {
      return res.status(503).json({
        message: `${label} غير مفعَّل — لم يُضبَط ${envVar} على الخادم`,
        code: 'API_KEY_NOT_CONFIGURED',
      });
    }
    // الترويسة أوّلًا. ونقبله في نصّ الاستعلام لأن بعض أدوات الأتمتة لا تُرسل
    // ترويسات، لكنّه يُسجَّل في سجلّات الوصول — فالترويسة هي الموصى بها.
    const given = req.headers['x-api-key'] || req.query.key || '';
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(expected));
    const equal = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!equal) {
      return res.status(401).json({ message: 'مفتاح غير صالح', code: 'INVALID_API_KEY' });
    }
    req.apiClient = label;
    return next();
  };
}

module.exports = { requireApiKey };
