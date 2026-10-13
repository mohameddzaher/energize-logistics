/**
 * سياقُ الطلب لسجلّ المراجعة — هل قُيِّد في هذا الطلب شيء؟
 *
 * `logAudit` تُنادى من داخل المتحكّم بلا `req`. وشبكةُ الأمان (middleware/auditTrail)
 * تحتاج أن تعرف بعد انتهاء الطلب: أكتب المتحكّمُ قيدَه أم لا؟ فيُحمَل علَمٌ مع
 * الطلب في `AsyncLocalStorage` — ترفعه `logAudit` وتقرؤه الشبكة.
 */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

module.exports = {
  run: (fn) => als.run({ audited: false }, fn),
  mark: () => { const s = als.getStore(); if (s) s.audited = true; },
  store: () => als.getStore(),
};
