/**
 * vehicleRef — أيُّ مركبةٍ في سجلّ المركبات هذه؟ من أيّ قسمٍ جاء السؤال.
 *
 * المركبةُ سجلٌّ واحد (VehicleMaster)، وكلُّ قسمٍ يحمل إليه مرجعًا لا نسخة
 * (صاحبُ الشركة، ٢٠٢٦/١٠/٢١: «المركبة مرتبطة بحاجتها في أي قسم مهما كانت،
 * وحتى لو أضفت قسمًا جديدًا»). وهذا بابُ الربط الواحد: لوحةٌ عربيّةٌ أو
 * لاتينيّة ← معرّفُ المركبة، بالمفتاح الموحَّد (utils/plateKey canonicalPlateKey).
 *
 * ── قسمٌ جديد (قائمةُ الربط) ─────────────────────────────────────────────────
 *   ١) يخزّن مرجعَ المركبة (`vehicle`/`vehicleMaster: ObjectId`) ويحلّه من هنا عند
 *      الإنشاء (`resolve`)، ومرجعَ الشخص (`employee: ObjectId`) من utils/personRef.
 *   ٢) يعرض الهويّةَ والمستنداتِ من السجلّ نفسِه، والاسمَ من ملفّ الموارد البشريّة
 *      (`personRef.displayName`) — لا من نسخةٍ عنده.
 *   ٣) إن احتاج لقطةً (لوحةً أو اسمًا) للتاريخ أو البحث، فليُضِفها إلى
 *      `pushVehicleChange` هنا أو `employeeIdentitySync.pushPersonChange` كي تتبع المصدر.
 *   ٤) يسمع `vreg:updated` و`hr:employee` فيُعيد الجلب.
 */
const { canonicalPlateKey } = require('./plateKey');

/** معرّفُ المركبة في السجلّ للّوحة، أو null. يُرجع المستندَ إن طُلبت حقول. */
async function resolve(plate, select = '_id') {
  const key = canonicalPlateKey(plate);
  if (!key) return null;
  const { VehicleMaster } = require('../models/VehicleMaster');
  return VehicleMaster.findOne({ canonKey: key }).select(select).lean();
}

/** حلٌّ دفعةً واحدة: Map من المفتاح الموحَّد إلى المركبة. */
async function resolveMany(plates, select = '_id plateNumber canonKey') {
  const keys = [...new Set((plates || []).map(canonicalPlateKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const { VehicleMaster } = require('../models/VehicleMaster');
  const rows = await VehicleMaster.find({ canonKey: { $in: keys } }).select(select).lean();
  return new Map(rows.map((r) => [r.canonKey, r]));
}

/**
 * ── وتغييرُ اللوحة أو نوع التسجيل في السجلّ يصل نسخَه ──────────────────────────
 * صُحِّحت لوحةٌ في السجلّ فبقيت القديمةُ في صفّ النقل الخفيف وأمر التشغيل الساري
 * والحادث ولقطة ملفّ الموظّف — فيُبحث عنها بالجديدة فلا تُوجَد. تُنادى من خطّافات
 * models/VehicleMaster بعد كلّ كتابةٍ تمسّ `plateNumber` أو `registrationTypeAr`.
 *
 * ونوعُ المركبة في صفّ النقل الخفيف قائمةُ القسم («دراجة نارية» · «فان» · «كيا»)
 * لا نوعُ التسجيل («دراجة آلية» · «نقل عام» · «خاص») — فلا يُكتب فوقه إلّا إن كان
 * نسخةً حرفيّةً من القديم. أمّا أمرُ التشغيل فيحمل نوعَ التسجيل نفسَه.
 *
 * @param before  { plateNumber, registrationTypeAr } قبل الكتابة
 */
async function pushVehicleChange(id, before = {}, { emit = true } = {}) {
  const S = (v) => String(v == null ? '' : v).trim();
  const out = { lt: 0, orders: 0, claims: 0, employees: [] };
  const { VehicleMaster } = require('../models/VehicleMaster');
  const vm = await VehicleMaster.findById(id).select('plateNumber plateKey registrationTypeAr authorizedPerson').lean();
  if (!vm) return out;
  const plate = S(vm.plateNumber);
  const type = S(vm.registrationTypeAr);
  const plateChanged = before.plateNumber !== undefined && S(before.plateNumber) !== plate;
  const typeChanged = before.registrationTypeAr !== undefined && S(before.registrationTypeAr) !== type;
  if (!plateChanged && !typeChanged) return out;
  const { LightTransportEmployee, LightTransportOrder } = require('../models/LightTransport');
  const LIVE = { $in: ['active', 'hold'] };

  if (plateChanged && plate) {
    out.lt += (await LightTransportEmployee.updateMany({ vehicle: vm._id, vehiclePlate: { $ne: plate } }, { $set: { vehiclePlate: plate } })).modifiedCount || 0;
    out.orders += (await LightTransportOrder.updateMany({ vehicle: vm._id, status: LIVE, vehiclePlate: { $ne: plate } }, { $set: { vehiclePlate: plate } })).modifiedCount || 0;
    // الحوادث: المربوطةُ بالمرجع، وغيرُ المربوطة التي تحمل مفتاحَ اللوحة القديمة.
    const { registryPlateKey } = require('./plateKey');
    const oldKey = registryPlateKey(before.plateNumber);
    const VehicleClaim = require('../models/VehicleClaim');
    const r = await VehicleClaim.updateMany(
      { $or: [{ vehicle: vm._id }, ...(oldKey ? [{ vehicle: null, vehiclePlateKey: oldKey }] : [])] },
      { $set: { vehicle: vm._id, vehiclePlate: plate, vehiclePlateKey: vm.plateKey || registryPlateKey(plate) || '' } },
    );
    out.claims = r.modifiedCount || 0;
    if (out.claims && vm.plateKey) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: vm.plateKey, isActive: true });
      await VehicleMaster.updateMany({ plateKey: vm.plateKey }, { $set: { accidentCount: n } }, { timestamps: false });
    }
    // ولقطةُ اللوحة على ملفّ الموظّف: صاحبُ الورقة، ومَن تحمل لقطتُه اللوحةَ القديمة.
    try {
      const VA = require('./vehicleAuthorization');
      const Employee = require('../models/Employee');
      const { orderlessPlateKey } = require('./plateKey');
      const seen = new Set();
      const holder = await VA.employeeByIdNumber(vm.authorizedPerson?.iqamaNumber);
      const cands = holder ? [holder] : [];
      const oldOrderless = orderlessPlateKey(before.plateNumber);
      const digits = (oldOrderless || '').split('|')[0];
      if (digits) {
        const rows = await Employee.find({ vehiclePlate: new RegExp(digits.split('').join('\\D*')) })
          .select('_id vehiclePlate iqamaNumber nationalId').lean();
        cands.push(...rows.filter((e) => VA.plateKeysOf(e.vehiclePlate).includes(oldOrderless)));
      }
      for (const e of cands) {
        if (seen.has(String(e._id))) continue;
        seen.add(String(e._id));
        if (await VA.refreshPlateSnapshot(e)) out.employees.push(String(e._id)); // eslint-disable-line no-await-in-loop
      }
    } catch (e) { console.error('[vehicle-ref] plate snapshot:', e.message); }
  }

  if (typeChanged && type) {
    const was = S(before.registrationTypeAr);
    out.orders += (await LightTransportOrder.updateMany({ vehicle: vm._id, status: LIVE, vehicleTypeAr: was }, { $set: { vehicleTypeAr: type } })).modifiedCount || 0;
    if (was) out.lt += (await LightTransportEmployee.updateMany({ vehicle: vm._id, vehicleTypeAr: was }, { $set: { vehicleTypeAr: type } })).modifiedCount || 0;
  }

  if (emit) {
    // الباب المشترك: يمسح كلَّ ما يحمل المركبةَ ثمّ يُعلن (utils/vehicleAnnounce).
    require('./vehicleAnnounce').announceVehicles({ vehicle: String(vm._id) }, {
      events: out.employees.map((e) => ['hr:employee', { id: e }]),
    });
  }
  return out;
}

module.exports = { resolve, resolveMany, canonicalPlateKey, pushVehicleChange };
