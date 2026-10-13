/**
 * كتابةٌ في قسم النقل الثقيل تُسمَع في القسم كلِّه.
 *
 * القسمُ ثلاثةُ متحكّمات (المركبات والصيانة، سجلُّ الأصول، المخزن) ولكلٍّ
 * ذاكرتُه المؤقّتة وحدثُه الحيّ. فكانت الكتابةُ في أحدها تمسح ذاكرتَه وحدَها:
 * كفرٌ يُنقَل في سجلّ الأصول وتبقى لوحةُ القسم وقائمةُ المركبات على ما كانت
 * دقيقةً، وصيانةٌ تُسجَّل ويبقى ملخّصُ الأصول قديمًا. ومَن فعل الفعلَ يراه «لم
 * يُسمَع» — وهو سُمِع، لكنّ الشاشةَ المجاورة تقرأ من ذاكرةٍ لم يمسحها أحد.
 *
 * فالمسحُ هنا للمشتقّ كلِّه، والإعلانُ بالحدثين معًا — وكلُّ شاشةٍ في القسم
 * تستمع لأحدهما. وتبقى ذاكرةُ القياس عن بُعد (المسافاتُ والرحلاتُ والمسار من
 * Wialon): لا تغيّرها كتابةٌ في النظام، وإعادةُ جلبها نداءٌ خارجيٌّ ثقيل.
 */
const cache = require('./ttlCache');

const DERIVED = ['ls2assets:', 'ls2store:', 'ls2:dash', 'ls2:vehicles', 'ls2:whereabouts', 'ls2:rep', 'ls2:drvperf'];

/** يمسح ما يُشتقّ من سجلّات القسم — في هذا العامل وفي الآخر (راجع ttlCache). */
function clearLs2Derived() {
  for (const p of DERIVED) { try { cache.clear(p); } catch (_) { /* */ } }
}

/** يمسح ثمّ يُعلن — بهذا الترتيب (راجع announce-before-invalidate). */
function touchLs2(payload = {}) {
  clearLs2Derived();
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('ls2:updated', { at: Date.now(), ...payload });
    emitToAll('ls2:store', {});
  } catch (_) { /* انقطاعُ الوصلة لا يُفشل الحفظ */ }
}

module.exports = { clearLs2Derived, touchLs2 };
