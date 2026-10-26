/**
 * ── البحثُ بما يخصّ أصحابَ الشحنة لا بما كُتب في صفّها ────────────────────
 *
 * صاحبُ الشركة (٢٠٢٦/١٠/٢٦): «سيرش برقم إقامة السائق أو رقم أي حاجة تخص السائق
 * أو الشحنة أو أي حد فيها». والشحنةُ (طلبُ شحن أو كشفُ تشغيل) لا تحمل إقامةَ
 * سائقها ولا هيكلَ شاحنتها — تحمل اسمَه وهاتفَه ولوحتَها لقطةً. والإقامةُ في
 * سجلّات أصحابها: سائقو طلبات الشحن، وسائقو الأسطول، وملفُّ الموظّف؛ والهيكلُ
 * والرقمُ التسلسليُّ في سجلّ المركبات.
 *
 * فيُترجَم الرقمُ أوّلًا إلى أصحابه — اسمٌ وهاتفٌ ولوحة — ثمّ تُطابَق الشحناتُ
 * بها. هذا ما يجعل «2345678901» يُخرج كلَّ شحنات السائق الذي هذه إقامتُه.
 *
 * يُستدعى للأرقام وحدها (ستُّ خاناتٍ فأكثر): الاسمُ يُبحث في الشحنة مباشرةً،
 * والرقمُ القصير يصيد في كلّ سجلّ.
 */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** آخرُ تسع خانات — «+966 50…» و«050…» هاتفٌ واحد. */
const phoneTail = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
};

/**
 * @param {string} bare أرقامٌ فقط.
 * @returns {Promise<{ names: string[], phones: string[], plates: string[] }>}
 */
async function relatedByNumber(bare) {
  const out = { names: new Set(), phones: new Set(), plates: new Set() };
  if (!bare || bare.length < 6) return { names: [], phones: [], plates: [] };
  const rx = new RegExp(esc(bare));
  const tail = phoneTail(bare);
  const tailRx = tail ? new RegExp(`${esc(tail)}$`) : null;
  const add = (name, phone) => {
    if (String(name || '').trim()) out.names.add(String(name).trim());
    const t = phoneTail(phone);
    if (t) out.phones.add(t);
  };

  const safe = (p) => p.catch(() => []);
  const ShipmentOrderDriver = require('../models/ShipmentOrderDriver');
  const { FleetDriver } = require('../models/FleetModels');
  const Employee = require('../models/Employee');
  const { VehicleMaster } = require('../models/VehicleMaster');

  const [soDrivers, fleetDrivers, employees, vehicles] = await Promise.all([
    safe(ShipmentOrderDriver.find({ $or: [
      { residenceNumber: rx }, { driverCardNumber: rx },
      ...(tailRx ? [{ phone: tailRx }] : []),
    ] }).select('name phone').limit(30).lean()),
    safe(FleetDriver.find({ $or: [{ iqama: rx }, ...(tailRx ? [{ phone: tailRx }] : [])] })
      .select('name phone').limit(30).lean()),
    safe(Employee.find({ $or: [
      { iqamaNumber: rx }, { nationalId: rx }, { passportNumber: rx }, { employeeNumber: bare },
      ...(tailRx ? [{ phone: tailRx }] : []),
    ] }).select('firstName lastName phone').limit(30).lean()),
    // الهيكلُ والرقمُ التسلسليّ في سجلّ المركبات → لوحتُها.
    safe(VehicleMaster.find({ $or: [{ chassisNumber: rx }, { serialNumber: rx }] })
      .select('plateNumber').limit(30).lean()),
  ]);

  soDrivers.forEach((d) => add(d.name, d.phone));
  fleetDrivers.forEach((d) => add(d.name, d.phone));
  employees.forEach((e) => add(`${e.firstName || ''} ${e.lastName || ''}`.trim(), e.phone));
  vehicles.forEach((v) => { if (String(v.plateNumber || '').trim()) out.plates.add(String(v.plateNumber).trim()); });

  return { names: [...out.names], phones: [...out.phones], plates: [...out.plates] };
}

/**
 * شروطُ `$or` تُطابق الشحنةَ بأصحاب الرقم.
 * @param {string} bare
 * @param {{ name: string[], phone: string[], plate: string[] }} fields حقولُ الشحنة لكلّ صنف.
 */
async function relatedClauses(bare, fields) {
  const r = await relatedByNumber(bare);
  const { plateDigitsRegex } = module.exports;
  const or = [];
  // الاسمُ مطابقٌ بتمامه (بلا حالة أحرف ولا مسافاتٍ زائدة) — لا جزءًا منه، فلا
  // يجرّ «محمد» كلَّ محمد.
  for (const n of r.names) {
    const nameRx = new RegExp(`^\\s*${esc(n).replace(/\s+/g, '\\s+')}\\s*$`, 'i');
    fields.name.forEach((f) => or.push({ [f]: nameRx }));
  }
  for (const t of r.phones) fields.phone.forEach((f) => or.push({ [f]: new RegExp(`${esc(t)}$`) }));
  for (const p of r.plates) {
    const prx = plateDigitsRegex(p);
    if (prx) fields.plate.forEach((f) => or.push({ [f]: prx }));
  }
  return or;
}

/** أرقامُ اللوحة وحدها، محفوفةً بحدٍّ يمنع «1082» من مطابقة «21082». */
const plateDigitsRegex = (plate) => {
  const d = String(plate || '').replace(/\D/g, '');
  return d.length >= 3 ? new RegExp(`(^|\\D)${d}(\\D|$)`) : null;
};

module.exports = { relatedByNumber, relatedClauses, plateDigitsRegex, phoneTail };
