/**
 * بطاقةُ السائق سجلٌّ واحد — في قسم المركبات — ولقطتُها على ملفّ الموظّف تتبعه.
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────────
 * بطاقةٌ جُدِّدت في المركبات حتّى ٢٠٢٧ بقيت في الموارد البشريّة على ٢٠٢٦ فظهرت
 * «منتهية» — لأنّ المزامنة كانت في مسارٍ واحدٍ (تعديل البطاقة) وبشرطٍ واحد (أن
 * تكون البطاقةُ مربوطةً بالموظّف بمعرّفه). وأغلبُ البطاقات مربوطةٌ برقم الهويّة
 * لا بالمعرّف، والإنشاءُ والحذف لا يمرّان بها أصلًا، والتعديلُ من الموارد
 * البشريّة لا يصل المركبات. فكان الرقمان يفترقان في كلّ اتّجاه.
 *
 * فالمزامنةُ هنا في الاتّجاهين، وتُنادى من كلّ مسارٍ يكتب:
 *   • المركبات ← الموارد البشريّة: `pushCardToEmployee` بعد إنشاء البطاقة أو
 *     تعديلها أو تجديدها، و`clearEmployeeCard` بعد حذفها.
 *   • الموارد البشريّة ← المركبات: `pushEmployeeToCard` بعد تعديل حقول البطاقة
 *     من الماستر أو من ملفّ الموظّف أو تجديدها — فتُكتب في السجلّ نفسه ثمّ
 *     تعود منه، فلا يبقى على الملفّ إلّا ما في السجلّ.
 *
 * والربطُ بالمعرّف إن وُجد، وإلّا برقم الهويّة في عمودَي الهويّة معًا (المقيم
 * في `iqamaNumber` والسعوديّ في `nationalId`) — ويُثبَّت المعرّفُ حين يُعرف.
 */
const CARD_FIELDS_ON_EMPLOYEE = ['driverCardNumber', 'driverCardType', 'driverCardExpiry'];

const clean = (v) => String(v ?? '').trim();

function emitAll() {
  try {
    const { emitToAll } = require('../websocket/socketManager');
    emitToAll('hr:master', {}); emitToAll('hr:employee', {}); emitToAll('vreg:updated', {});
  } catch (_) { /* */ }
  try {
    const cache = require('./ttlCache');
    cache.clear('hrm:'); cache.clear('hr:employees:'); cache.clear('dash:hr:'); cache.clear('vreg:');
  } catch (_) { /* */ }
}

async function employeeOfCard(card) {
  const Employee = require('../models/Employee');
  if (card.employee) {
    const e = await Employee.findById(card.employee);
    if (e) return e;
  }
  const id = clean(card.idNumber);
  if (!id) return null;
  return Employee.findOne({ isHrRecord: { $ne: false }, $or: [{ iqamaNumber: id }, { nationalId: id }] });
}

/** المركبات ← الموارد البشريّة. */
async function pushCardToEmployee(card, { emit = true } = {}) {
  if (!card) return null;
  const emp = await employeeOfCard(card);
  if (!emp) return null;
  const DriverCard = require('../models/DriverCard');
  if (!card.employee) await DriverCard.updateOne({ _id: card._id }, { $set: { employee: emp._id } });
  // سجلٌّ بلا رقمٍ ولا تاريخٍ (سائقٌ مُدرَجٌ لم تُصدَر بطاقتُه بعد) لا يُكتب منه شيء:
  // لا جديدَ فيه، وكتابتُه تمحو ما في الملفّ من قرارٍ مثل «غير مطلوب».
  if (!clean(card.cardNumber) && !clean(card.expiryDate)) return null;
  const set = {
    driverCardNumber: clean(card.cardNumber),
    driverCardType: clean(card.cardType),
    driverCardExpiry: clean(card.expiryDate),
  };
  const same = CARD_FIELDS_ON_EMPLOYEE.every((k) => clean(emp[k] instanceof Date ? emp[k].toISOString().slice(0, 10) : emp[k]) === set[k]);
  // بطاقةٌ موجودةٌ في السجلّ ليست «غير مطلوبة» ولا «مطلوبة» — هي متوفّرة.
  // والعلاماتُ تُحفظ لكلّ خانةٍ باسمها (`driverCardExpiryStatus`…) — راجع
  // hrFields.statusKeyOf. و«غير مطلوب» كانت تُكتب أحيانًا في خانة الرقم نفسِها.
  const STATUS_KEYS = ['driverCardNumberStatus', 'driverCardExpiryStatus', 'driverCardStatusStatus'];
  const fs = emp.fieldStatus || new Map();
  const get = (k) => (typeof fs.get === 'function' ? fs.get(k) : fs[k]);
  const hasCard = !!clean(card.cardNumber);
  const staleStatus = hasCard && STATUS_KEYS.some((k) => get(k));
  // المفرداتُ القائمة في الملفّ: «يوجد» / «لايوجد».
  if (hasCard) set.driverCardStatus = 'يوجد';
  const sameStatus = !hasCard || clean(emp.driverCardStatus) === 'يوجد';
  if (same && sameStatus && !staleStatus) return null;
  const update = { $set: set };
  if (staleStatus) update.$unset = Object.fromEntries(STATUS_KEYS.map((k) => [`fieldStatus.${k}`, 1]));
  const Employee = require('../models/Employee');
  await Employee.updateOne({ _id: emp._id }, update);
  if (emit) emitAll();
  return { employee: emp._id, set };
}

/** حُذفت البطاقةُ من السجلّ فتُمسح لقطتُها من الملفّ. */
async function clearEmployeeCard(card, { emit = true } = {}) {
  if (!card) return null;
  const emp = await employeeOfCard(card);
  if (!emp) return null;
  const Employee = require('../models/Employee');
  await Employee.updateOne({ _id: emp._id }, { $set: { driverCardNumber: '', driverCardType: '', driverCardExpiry: '' } });
  if (emit) emitAll();
  return { employee: emp._id };
}

/**
 * الموارد البشريّة ← المركبات. `emp` بعد الحفظ. تُكتب البطاقة في السجلّ (أو
 * تُنشأ إن كُتب لها رقمٌ ولا سجلَّ لها) ثمّ تعود لقطتُها منه.
 */
async function pushEmployeeToCard(emp, { userId = null, emit = true } = {}) {
  if (!emp) return null;
  const DriverCard = require('../models/DriverCard');
  const idNumber = clean(emp.idType === 'national_id' ? (emp.nationalId || emp.iqamaNumber) : (emp.iqamaNumber || emp.nationalId));
  let card = await DriverCard.findOne({ employee: emp._id });
  if (!card && idNumber) card = await DriverCard.findOne({ idNumber });
  const toStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : clean(v));
  const want = {
    cardNumber: toStr(emp.driverCardNumber),
    cardType: toStr(emp.driverCardType),
    expiryDate: toStr(emp.driverCardExpiry),
  };
  // «مطلوب» / «غير مطلوب» / «لايوجد» كلماتٌ إداريّة تُكتب في الخانات أحيانًا —
  // ليست تاريخًا ولا رقمَ بطاقة، فلا تُنشئ بطاقةً ولا تُكتب في السجلّ.
  if (want.expiryDate && !/^\d{4}-\d{2}-\d{2}/.test(want.expiryDate)) want.expiryDate = '';
  if (want.cardNumber && !/\d/.test(want.cardNumber)) want.cardNumber = '';
  if (!card) {
    if (!want.cardNumber || !idNumber) return null;
    card = await DriverCard.create({
      idNumber, employee: emp._id, name: emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      ...want, createdBy: userId || undefined,
    });
  } else {
    // الفارغُ لا يمحو السجلّ: خانةٌ مُسحت في الموارد البشريّة (أو كُتبت فيها
    // كلمة) لا تحذف رقمَ بطاقةٍ قائمةٍ في المركبات — الحذفُ من هناك.
    const real = Object.fromEntries(Object.entries(want).filter(([, v]) => v));
    const changed = Object.keys(real).some((k) => clean(card[k]) !== real[k]);
    if (!changed && String(card.employee || '') === String(emp._id)) return null;
    card.set({ ...real, employee: emp._id, lastModifiedBy: userId || card.lastModifiedBy });
    await card.save();
  }
  // ثمّ تعود لقطةُ الملفّ من السجلّ — فيبقى الطرفان على قيمةٍ واحدة.
  await pushCardToEmployee(card, { emit: false });
  if (emit) emitAll();
  return { card: card._id };
}

module.exports = { pushCardToEmployee, clearEmployeeCard, pushEmployeeToCard, CARD_FIELDS_ON_EMPLOYEE };
