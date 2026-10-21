/**
 * تصحيحُ رقم هويّة الموظّف في الموارد البشريّة يصل كلَّ ما يعرفه به.
 *
 * ── لماذا ───────────────────────────────────────────────────────────────────
 * الموظّفُ يُعرَف خارج الموارد البشريّة برقم هويّته لا بمعرّفه:
 *   · ورقةُ التفويض على المركبة   `VehicleMaster.authorizedPerson.iqamaNumber`
 *   · القائدُ الفعليّ               `VehicleMaster.actualDriver.idNumber`
 *   · بطاقةُ السائق                 `DriverCard.idNumber`
 *   · صفُّه في النقل الخفيف        `LightTransportEmployee.idNumber`
 * فإن صُحِّح الرقمُ في ملفّه وحدَه انقطع الربط في صمت: يختفي تفويضُه من ملفّه
 * ومن إخلاء طرفه، وتبقى المركبةُ مقيَّدةً برقمٍ لا يطابق أحدًا.
 *
 * فالرقمُ القديمُ يُستبدَل بالجديد حيث وُجد — والكتابةُ في الورقة تمرّ بخطّاف
 * النموذج فيتبعها سجلُّ الإسناد (utils/vehicleAuthorization).
 */
const S = (v) => String(v == null ? '' : v).trim();

async function pushIdChange(emp, beforeIds, nowIds) {
  const gone = beforeIds.map(S).filter((x) => x && !nowIds.map(S).includes(x));
  const next = S(emp.idType === 'national_id' ? (emp.nationalId || emp.iqamaNumber) : (emp.iqamaNumber || emp.nationalId));
  if (!gone.length || !next) return { changed: 0 };
  const { VehicleMaster } = require('../models/VehicleMaster');
  const DriverCard = require('../models/DriverCard');
  let changed = 0;

  const a = await VehicleMaster.updateMany({ 'authorizedPerson.iqamaNumber': { $in: gone } }, { $set: { 'authorizedPerson.iqamaNumber': next } });
  const d = await VehicleMaster.updateMany({ 'actualDriver.idNumber': { $in: gone } }, { $set: { 'actualDriver.idNumber': next } });
  changed += (a.modifiedCount || 0) + (d.modifiedCount || 0);

  // البطاقةُ فريدةٌ برقم الهويّة: لا يُكتب الجديدُ فوق بطاقةٍ قائمةٍ به.
  if (!(await DriverCard.exists({ idNumber: next }))) {
    const c = await DriverCard.updateMany({ idNumber: { $in: gone } }, { $set: { idNumber: next, employee: emp._id } });
    changed += c.modifiedCount || 0;
  }
  try {
    const { LightTransportEmployee } = require('../models/LightTransport');
    if (!(await LightTransportEmployee.exists({ idNumber: next }))) {
      const l = await LightTransportEmployee.updateMany({ employee: emp._id, idNumber: { $in: gone } }, { $set: { idNumber: next } });
      changed += l.modifiedCount || 0;
    }
  } catch (_) { /* */ }

  if (changed) {
    try {
      const cache = require('./ttlCache');
      for (const k of ['vreg:', 'lt:', 'hrm:', 'hr:employees:']) cache.clear(k);
      const { emitToAll } = require('../websocket/socketManager');
      emitToAll('vreg:updated', {}); emitToAll('lt:updated', {}); emitToAll('hr:employee', { id: String(emp._id) });
    } catch (_) { /* */ }
  }
  return { changed };
}

module.exports = { pushIdChange };
