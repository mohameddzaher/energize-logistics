/**
 * ما يمنع خروجَ موظّف — قاعدةٌ واحدةٌ لإنهاء الخدمة وللحذف معًا.
 *
 * ── ما وقع ─────────────────────────────────────────────────────────────────
 * أُضيف في الموارد البشريّة سجلٌّ باسم شركةٍ لا باسم موظّف، ليُسجَّل عليه جهازٌ
 * سُلِّم لأحد أفرادها. ثمّ حُذف السجلُّ لأنّه لا يخصّ الموارد البشريّة — فاختفى
 * الموظّف وبقيت عهدتُه مسجَّلةً، تظهر في سجلّ تقنية المعلومات باسمٍ محذوفٍ لا
 * يقرؤه أحد.
 *
 * ── ولماذا القاعدةُ واحدةٌ للفعلين ─────────────────────────────────────────
 * إنهاءُ الخدمة كان محروسًا بالعهدة، والحذفُ بلا حارسٍ البتّة — وهو الأشدّ:
 * الإنهاءُ يُبقي السجلَّ فيبقى الأثرُ مقروءًا، والحذفُ يمحوه فتصير العهدةُ بلا
 * صاحب.
 *
 * وحارسان مكتوبان في موضعين يفترقان: أُضيف تفويضُ المركبات إلى أحدهما ونُسي
 * في الآخر، فيُمنع من إنهاء الخدمة ويُسمح له بالحذف. فالسؤالُ يُجاب مرّةً
 * ويقرؤه الاثنان.
 */

/**
 * ما يمنع خروجَ هذا الموظّف اليوم.
 * @returns {Promise<{blocked:boolean, assets:number, authorizations:number, reasons:string[]}>}
 */
async function employeeExitBlockers(employeeId) {
  const Asset = require('../models/Asset');
  const VehicleAuthorization = require('../models/VehicleAuthorization');

  const [assets, authorizations] = await Promise.all([
    Asset.countDocuments({ employee: employeeId, status: 'assigned' }),
    VehicleAuthorization.countDocuments({ employee: employeeId, status: 'active' }),
  ]);

  const reasons = [];
  if (assets) reasons.push(`${assets} عهدة لم تُسلَّم`);
  if (authorizations) reasons.push(`${authorizations} تفويض مركبة ما زال ساريًا`);
  return { blocked: reasons.length > 0, assets, authorizations, reasons };
}

/**
 * ── وردُّ العهدة إلى المستودع ───────────────────────────────────────────────
 * يُستدعى بعد أن يُقرَّر الحذفُ فعلًا. العهدةُ لا تُحذف — هي أصلٌ للشركة، وسجلُّها
 * يُقرأ بعد سنة. تعود إلى المستودع بحالة `in_stock` ويُقيَّد في ملاحظاتها لماذا
 * عادت، فلا تبقى «مع فلانٍ» وفلانٌ لم يعد موجودًا.
 */
async function returnEmployeeAssetsToStore(employeeId, { note } = {}) {
  const Asset = require('../models/Asset');
  const r = await Asset.updateMany(
    { employee: employeeId, status: 'assigned' },
    {
      $set: {
        status: 'in_stock',
        employee: null,
        returnedDate: new Date().toISOString().slice(0, 10),
        ...(note ? { notes: note } : {}),
      },
    },
  );
  return r.modifiedCount || 0;
}

module.exports = { employeeExitBlockers, returnEmployeeAssetsToStore };
