/**
 * إعلانُ تغييرٍ في سجلّ المركبات — بابٌ واحدٌ لكلّ كتابةٍ تمسّ `VehicleMaster`.
 *
 * ── لماذا بابٌ واحد ─────────────────────────────────────────────────────────
 * صاحبُ الشركة (٢٠٢٦/١٠/٢٢): «أيُّ تعديلٍ في سجلّ المركبات يجب أن ينعكس في
 * الصفحات الأخرى وفي كلّ مكانٍ مرتبطٍ بالمركبة». والمركبةُ يقرؤها أكثرُ من قسم:
 * سجلُّ المركبات ولوحتُه، والنقلُ الخفيف (مركباتُه وتفاويضُه)، والأسطول (هويّةُ
 * الشاحنات ومستنداتُها — utils/fleetIdentity)، والنقلُ الثقيل (هويّةُ الوحدة —
 * services/ls2VehicleLink)، وملفُّ الموظّف (تبويبُ المركبات)، والمركباتُ القديمة
 * (طبقةُ السجلّ فوقها — vehicleController.registryIndex)، والتقارير.
 *
 * وكان كلُّ بابِ كتابةٍ يمسح قائمتَه هو من الذاكرة — عشرُ قوائمَ مختلفة في عشرة
 * ملفّات — فيُعدَّل التفويضُ من بابٍ يمسح مخزنَ الأسطول، ومن بابٍ آخرَ لا يمسحه،
 * فتبقى شاشةُ الأسطول على القديم دقيقةً كاملةً ولا يُعرف لماذا.
 *
 * فالقائمةُ هنا وحدَها، والترتيبُ ثابت: **تُمسَح الذاكرةُ أوّلًا ثمّ يُرسَل الحدث**
 * — وإلّا جلب المستمعُ الأسرعُ ما قبل التعديل (راجع announce-before-invalidate).
 */
const cache = require('./ttlCache');

/** كلُّ مخزنٍ يحمل شيئًا من بيانات المركبة. */
const VEHICLE_CACHES = [
  'vreg:',                 // سجلُّ المركبات ولوحتُه وفلاترُه وانتهاءاتُه
  'lt:',                   // مركباتُ النقل الخفيف وتنبيهاتُ مستنداتها
  'b2c:',                  // لوحةُ B2C (التفويضُ يُقرأ من الورقة — utils/b2cBoard)
  'veh:', 'vehicles:list', // المركباتُ القديمة وطبقةُ السجلّ فوقها
  'fleet:',                // هويّةُ شاحنات الأسطول ومستنداتُها
  'hrm:', 'hr:employees:', 'dash:hr:', 'dash:vehicles:', // ملفُّ الموظّف وماستر الموارد البشريّة
  'reports:doc:', 'reports:opts:vehicle:',               // التقاريرُ تحمل حالةَ اليوم
];

function clearVehicleCaches(extra = []) {
  for (const k of [...VEHICLE_CACHES, ...extra]) { try { cache.clear(k); } catch (_) { /* */ } }
  // هويّةُ وحدات النقل الثقيل تُقرأ من السجلّ عند العرض — تُمسَح مشتقّاتُه معها.
  try { require('./ls2Touch').clearLs2Derived(); } catch (_) { /* */ }
}

/**
 * يمسح ثمّ يُعلن: `vreg:updated` لقسم المركبات، و`lt:updated` للنقل الخفيف،
 * و`ls2:updated` للنقل الثقيل — وما يُمرَّر في `events` بعدها (مثل `hr:employee`).
 * و`vreg:` في اسم الحدث يوقظ الماليّةَ والنظرةَ التنفيذيّة (websocket/socketManager).
 */
function announceVehicles(payload = {}, { events = [], extraCaches = [] } = {}) {
  clearVehicleCaches(extraCaches);
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('vreg:updated', payload);
    emitToAll('lt:updated', { from: 'vehicles', ...payload });
    emitToAll('ls2:updated', { at: Date.now(), from: 'vehicles' });
    for (const e of events) {
      if (Array.isArray(e)) emitToAll(e[0], e[1] || {});
      else emitToAll(e, {});
    }
  } catch (_) { /* انقطاعُ الوصلة لا يُفشل الحفظ */ }
}

module.exports = { VEHICLE_CACHES, clearVehicleCaches, announceVehicles };
