/**
 * شبكةُ أمان سجلّ المراجعة — كلُّ كتابةٍ ناجحةٍ في قسمٍ تُقيَّد، ولو نسيها متحكّمُها.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * القيدُ كان يُكتب حيث تذكّر صاحبُ المتحكّم أن يكتبه. فقسمٌ كاملٌ (النقل الثقيل:
 * الصيانة والإصلاحات وتسجيل الخدمة والإعدادات) لم يكن يقيّد شيئًا، وسُئل السجلُّ
 * «ماذا فعل فلانٌ في القسم هذا الشهر؟» فأجاب بسطرٍ واحدٍ عمّن عمل فيه يوميًّا.
 * وسجلٌّ ناقصٌ لا يُعرَف نقصُه أسوأُ من لا سجلّ: يُقرأ غيابُ الفعل دليلًا على
 * أنّه لم يقع.
 *
 * ── والحلُّ في مكانٍ واحد ──────────────────────────────────────────────────
 * بعد كلّ طلبِ كتابةٍ (POST/PUT/PATCH/DELETE) نجح في قسمٍ معروف: إن لم يكتب
 * متحكّمُه قيدًا (راجع utils/auditContext) كُتب هنا قيدٌ عامّ — مَن، وفي أيّ قسم،
 * وأيُّ مسار، وما أرسل. المتحكّمُ الذي يقيّد بتفصيله يبقى قيدُه هو المقروء؛
 * وهذه تضمن ألّا يمرّ فعلٌ بلا أثر، اليومَ وفي كلّ مسارٍ يُضاف غدًا.
 *
 * ولا تُقيَّد القراءةُ ولا ما ليس فعلًا: البحثُ والتصديرُ والمعاينةُ وتعليمُ
 * الإشعار مقروءًا تُرسَل بـPOST وليست تغييرًا.
 */
const ctx = require('../utils/auditContext');
const logAudit = require('../utils/auditLogger');
const { SECTIONS } = require('../config/sections');

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// أطولُ بادئةٍ تطابق تحسم — كما في بقيّة حرّاس الأقسام.
const PREFIXES = SECTIONS.flatMap((s) => (s.apiPrefixes || []).map((p) => [p, s.key]))
  .sort((a, b) => b[0].length - a[0].length);
const sectionOfPath = (path) => { const hit = PREFIXES.find(([p]) => path === p || path.startsWith(`${p}/`)); return hit ? hit[1] : null; };
// ما يُرسَل بفعلِ كتابةٍ وليس تغييرًا.
const NOT_A_CHANGE = /\/(search|export|exports|preview|query|filters?|check|validate|verify|lookup|refresh|ping|read|seen|mark-read|webhook|reports?)(\/|$)/i;
const SECRET = /pass|token|secret|otp|pin/i;
const HEAVY = /dataurl|file|image|photo|base64|attachment/i;

/** ما أُرسل — مختصَرًا: بلا أسرارٍ ولا ملفّات، وكلُّ قيمةٍ بطولٍ يُقرأ. */
function summarise(body, depth = 0) {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') return body.length > 120 ? `${body.slice(0, 120)}…` : body;
  if (typeof body !== 'object') return body;
  if (depth > 2) return Array.isArray(body) ? `[${body.length}]` : '{…}';
  if (Array.isArray(body)) return body.length > 12 ? `[${body.length} عنصرًا]` : body.map((x) => summarise(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(body).slice(0, 40)) {
    if (SECRET.test(k)) continue;
    if (HEAVY.test(k)) { out[k] = '(ملفّ)'; continue; }
    out[k] = summarise(v, depth + 1);
  }
  return out;
}

const VERB = { POST: 'api_create', PUT: 'api_update', PATCH: 'api_update', DELETE: 'api_delete' };

module.exports = function auditTrail(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  return ctx.run(() => {
    const store = ctx.store();
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.user) return;
      const path = (req.originalUrl || '').split('?')[0];
      const section = sectionOfPath(path);
      if (!section || NOT_A_CHANGE.test(path)) return;
      // بعضُ المتحكّمات تردّ ثمّ تقيّد (الجوابُ قبل الذيول) — فيُمهَل القيدُ لحظةً.
      setTimeout(() => {
        if (store.audited) return;
        const route = `${req.baseUrl || ''}${(req.route && req.route.path) || ''}` || path;
        logAudit({
          user: req.user, action: VERB[req.method], entity: `Api:${section}`,
          entityId: req.params && (req.params.id || req.params.repairId || req.params.movementId),
          changes: { details: `${req.method} ${route}`, path, sent: summarise(req.body) },
          ipAddress: req.ip,
        });
      }, 1500).unref();
    });
    next();
  });
};
module.exports.sectionOfPath = sectionOfPath;
module.exports.summarise = summarise;
