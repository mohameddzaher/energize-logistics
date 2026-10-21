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

/**
 * ── وبياناتُ الشخص كذلك: الموارد البشريّة تغلب ───────────────────────────────
 * الاسمُ والجوالُ والجنسيّةُ نُسخت قديمًا على صفوفٍ في أقسامٍ أخرى، وافترقت عن
 * الملفّ: أربعةٌ وخمسون اسمًا في النقل الخفيف، وأحدَ عشرَ في بطاقات السائقين،
 * وستّةٌ وأربعون على أوراق التفويض، وثمانيةٌ وستّون قائدًا فعليًّا. والقاعدة
 * (صاحبُ الشركة، ٢٠٢٦/١٠/٢١): بياناتُ الشخص واحدة — اسمُ الموارد البشريّة يظهر
 * في كلّ مكان. فكلُّ حفظٍ يمسّها هنا يكتبها في نسخها:
 *
 *   · `LightTransportEmployee` — الاسم والجوال والجنسيّة (وما يخصّ القسمَ لا يُمسّ:
 *     الوظيفةُ هناك قائمةُ القسم لا مسمّى الموارد البشريّة، والمشروعُ يملكه القسم)
 *     ومعه لقطتا الاسم: راكبُ المركبة (`VehicleMaster.b2cRider.name`) وأوامرُ
 *     التشغيل السارية (`LightTransportOrder.employeeName`).
 *   · `DriverCard.name`
 *   · `VehicleMaster.authorizedPerson` — الاسم والجوال
 *   · `VehicleMaster.actualDriver.name`
 *
 * والربطُ برقم الهويّة (العمودان) أو بالمعرّف حيث يُحفظ. والفارغُ في الملفّ لا يمحو
 * ما في النسخة: «لا أعرف جوالَه» ليست «جوالُه فارغ». والمشروعُ والقسمُ وحالةُ
 * التوظيف لا نسخَ لها — تُقرأ من الملفّ — فيكفي أن تُمسَح الذاكرةُ ويُعلَن.
 *
 * والكتابةُ في المركبات بلا `timestamps`: ليست تعديلًا يدويًّا يحميه الاستيرادُ
 * التالي، ولا تغييرًا في التفويض (`skipAuthSync`) — الحاملُ هو هو.
 */
const PERSON_FIELDS = ['firstName', 'lastName', 'arabicName', 'phone', 'nationality', 'project', 'department', 'employmentStatus'];
const COPIED_FIELDS = ['firstName', 'lastName', 'arabicName', 'phone', 'nationality'];

function announcePerson(emp) {
  try {
    const cache = require('./ttlCache');
    for (const k of ['vreg:', 'lt:', 'hrm:', 'hr:employees:', 'dash:hr:', 'dash:vehicles:', 'b2c:', 'reports:doc:']) cache.clear(k);
  } catch (_) { /* */ }
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('hr:employee', { id: String(emp._id) }); emitToAll('lt:updated', { from: 'hr' }); emitToAll('vreg:updated', {});
  } catch (_) { /* */ }
}

/**
 * يكتب بياناتِ الشخص من ملفّه في نسخها. `opts.emit=false` للسكربتات.
 * @returns {{ lt, ltRiders, ltOrders, cards, authorized, actual }} عددُ ما تغيّر في كلّ نسخة
 */
async function pushPersonChange(emp, { emit = true, fields = PERSON_FIELDS } = {}) {
  const out = { lt: 0, ltRiders: 0, ltOrders: 0, cards: 0, authorized: 0, actual: 0 };
  if (!emp || !emp._id) return out;
  const P = require('./personRef');
  const ids = P.idsOf(emp);
  const name = P.canonicalName(emp);
  const phone = S(emp.phone);
  const nat = S(emp.nationality);
  const copies = fields.some((f) => COPIED_FIELDS.includes(f));

  if (copies && (ids.length || emp._id)) {
    try {
      const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
      const rows = await LightTransportEmployee.find({ $or: [{ employee: emp._id }, ...(ids.length ? [{ idNumber: { $in: ids } }] : [])] })
        .select('_id name phone nationalityAr').lean();
      const ops = [];
      const renamed = [];
      for (const r of rows) {
        const $set = {};
        if (name && S(r.name) !== name) { $set.name = name; renamed.push(r._id); }
        if (phone && S(r.phone) !== phone) $set.phone = phone;
        if (nat && S(r.nationalityAr) !== nat) $set.nationalityAr = nat;
        if (Object.keys($set).length) ops.push({ updateOne: { filter: { _id: r._id }, update: { $set } } });
      }
      if (ops.length) out.lt = (await LightTransportEmployee.bulkWrite(ops, { ordered: false })).modifiedCount || ops.length;
      if (name && rows.length) {
        const ltIds = rows.map((r) => r._id);
        const { VehicleMaster } = require('../models/VehicleMaster');
        out.ltRiders = (await VehicleMaster.updateMany({ 'b2cRider.lt': { $in: ltIds }, 'b2cRider.name': { $ne: name } },
          { $set: { 'b2cRider.name': name } }, { timestamps: false, skipAuthSync: true })).modifiedCount || 0;
        out.ltOrders = (await LightTransportOrder.updateMany({ ltEmployee: { $in: ltIds }, status: { $in: ['active', 'hold'] }, employeeName: { $ne: name } },
          { $set: { employeeName: name } })).modifiedCount || 0;
      }
    } catch (e) { console.error('person → light transport:', e.message); }

    if (name) {
      try {
        const DriverCard = require('../models/DriverCard');
        out.cards = (await DriverCard.updateMany({ $or: [{ employee: emp._id }, ...(ids.length ? [{ idNumber: { $in: ids } }] : [])], name: { $ne: name } },
          { $set: { name } })).modifiedCount || 0;
      } catch (e) { console.error('person → driver card:', e.message); }
    }

    if (ids.length) {
      try {
        const { VehicleMaster } = require('../models/VehicleMaster');
        const opt = { timestamps: false, skipAuthSync: true };
        if (name) {
          out.authorized += (await VehicleMaster.updateMany({ 'authorizedPerson.iqamaNumber': { $in: ids }, 'authorizedPerson.name': { $ne: name } },
            { $set: { 'authorizedPerson.name': name } }, opt)).modifiedCount || 0;
          out.actual = (await VehicleMaster.updateMany({ 'actualDriver.idNumber': { $in: ids }, 'actualDriver.name': { $ne: name } },
            { $set: { 'actualDriver.name': name } }, opt)).modifiedCount || 0;
        }
        if (phone) {
          out.authorized += (await VehicleMaster.updateMany({ 'authorizedPerson.iqamaNumber': { $in: ids }, 'authorizedPerson.phone': { $ne: phone } },
            { $set: { 'authorizedPerson.phone': phone } }, opt)).modifiedCount || 0;
        }
      } catch (e) { console.error('person → vehicles:', e.message); }
    }
  }
  if (emit) announcePerson(emp);
  return out;
}

/** أيُّ حقول الشخص تغيّرت بين لقطتين؟ */
const personSnapshot = (doc) => Object.fromEntries(PERSON_FIELDS.map((k) => [k, S(doc?.[k])]));
const changedPersonFields = (before, now) => PERSON_FIELDS.filter((k) => S(before?.[k]) !== S(now?.[k]));

module.exports = { pushIdChange, pushPersonChange, PERSON_FIELDS, COPIED_FIELDS, personSnapshot, changedPersonFields, announcePerson };
