/* eslint-disable no-console */
/**
 * linkLs2VehicleMaster — يربط النقلَ الثقيل بسجلّ المركبات: وحداتُ لوكيشن
 * سوليوشن، والسطحات، وقيودُ عهدة النقل الثقيل، وحركاتُ المخزن — كلٌّ بحقل
 * `vehicleMaster`. ويعرض معه تعارضاتِ الجهاز مع السجلّ واللوحاتِ التي لا مركبةَ لها.
 *
 *   node src/scripts/linkLs2VehicleMaster.js           (عرضٌ فقط)
 *   node src/scripts/linkLs2VehicleMaster.js --apply   (يكتب)
 *
 * والربطُ يجري بعد ذلك وحدَه: عند مزامنة الهويّة، وعند كلّ حركةٍ أو قيدٍ جديد
 * (services/ls2VehicleLink) — فهذا لِما سبق. يكتب بلا طوابع زمنيّة.
 * ولا يمسّ النصوص: اللوحةُ تبقى كما كُتبت، ويُضاف إليها المرجع.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const link = require('../services/ls2VehicleLink');
  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const HtCustody = require('../models/HtCustody');
  const { Ls2StoreMovement } = require('../models/Ls2Store');

  console.log(APPLY ? '── كتابة ──' : '── عرضٌ فقط ──');

  // ١) الوحداتُ والسطحات
  const fleet = await link.linkLs2Fleet({ apply: APPLY });
  console.log(`وحدات لوكيشن: ${fleet.units} · مربوطة: ${fleet.unitsLinked} · تتغيّر: ${fleet.unitsChanged}`);
  if (fleet.unitsUnlinked.length) console.log(`  بلا مركبة في السجلّ: ${fleet.unitsUnlinked.join(' / ')}`);
  console.log(`سطحات: ${fleet.flatbeds} · مربوطة: ${fleet.flatbedsLinked} · تتغيّر: ${fleet.flatbedsChanged}`);
  if (fleet.flatbedsUnlinked.length) console.log(`  بلا مركبة: ${fleet.flatbedsUnlinked.join(' / ')}`);

  // ٢) قيودُ عهدة النقل الثقيل — من الوحدة إلى مركبتها
  const entries = await HtCustody.find({ vehicleUnitId: { $ne: null } }).select('vehicleUnitId vehicleMaster').lean();
  let custodyChange = 0; let custodyNone = 0;
  const custodyOps = [];
  for (const e of entries) {
    const id = fleet.unitMap.get(e.vehicleUnitId) || null;
    if (!id) custodyNone += 1;
    if (String(e.vehicleMaster || '') !== String(id || '')) {
      custodyChange += 1;
      custodyOps.push({ updateOne: { filter: { _id: e._id }, update: { $set: { vehicleMaster: id } } } });
    }
  }
  if (APPLY && custodyOps.length) await HtCustody.bulkWrite(custodyOps, { ordered: false, timestamps: false });
  console.log(`قيود عهدة النقل الثقيل بسيّارة: ${entries.length} · تتغيّر: ${custodyChange} · بلا مركبة: ${custodyNone}`);

  // ٣) حركاتُ المخزن — اللوحةُ نصًّا، تُحلّ لكلّ مخزنٍ بقاعدته
  const unknown = [];
  for (const wh of ['heavy', 'light']) {
    const match = wh === 'light' ? { warehouse: 'light' } : { warehouse: { $ne: 'light' } };
    const groups = await Ls2StoreMovement.aggregate([
      { $match: { ...match, vehiclePlate: { $nin: ['', null] } } },
      { $group: { _id: '$vehiclePlate', n: { $sum: 1 }, linked: { $sum: { $cond: [{ $ifNull: ['$vehicleMaster', false] }, 1, 0] } } } },
    ]);
    const resolved = await link.resolveLs2Plates(groups.map((g) => g._id), { heavy: wh === 'heavy' });
    let plates = 0; let plateHit = 0; let rows = 0; let rowHit = 0; let write = 0;
    for (const g of groups) {
      const id = resolved.get(String(g._id).trim()) || null;
      plates += 1; rows += g.n;
      if (id) { plateHit += 1; rowHit += g.n; } else unknown.push({ wh, plate: g._id, n: g.n });
      if (id && g.linked < g.n) {
        write += g.n - g.linked;
        // eslint-disable-next-line no-await-in-loop
        if (APPLY) await Ls2StoreMovement.updateMany({ ...match, vehiclePlate: g._id, vehicleMaster: null }, { $set: { vehicleMaster: id } }, { timestamps: false });
      }
    }
    console.log(`مخزن ${wh === 'heavy' ? 'النقل الثقيل' : 'النقل الخفيف'}: لوحات ${plates} (تُحلّ ${plateHit}) · حركات ${rows} (تُحلّ ${rowHit}) · تُكتب ${write}`);
  }
  unknown.sort((a, b) => b.n - a.n);
  console.log(`لوحاتٌ غير معروفة: ${unknown.length} (حركاتها ${unknown.reduce((s, u) => s + u.n, 0)})`);
  for (const u of unknown) console.log(`  [${u.wh}] ${u.plate} ×${u.n}`);

  // ٤) تعارضاتُ الجهاز مع السجلّ
  const units = await Ls2Vehicle.find({}).select('unitId plate name profile.vin profile.modelYear profile.registrationPlate vehicleMaster').lean();
  const rows = await link.attachRegistry(units.map((u) => ({ ...u, vehicleMaster: fleet.unitMap.get(u.unitId) || null })));
  const year = rows.filter((r) => r.conflicts.year);
  const vin = rows.filter((r) => r.conflicts.vin);
  console.log(`تعارضات: سنة الصنع ${year.length} · رقم الشاسيه ${vin.length} (منها جزئيّ ${vin.filter((r) => r.conflicts.vin.partial).length})`);
  for (const r of year) console.log(`  سنة  ${r.plate || link.unitPlate(r)}: السجلّ ${r.conflicts.year.registry} · الجهاز ${r.conflicts.year.device}`);
  for (const r of vin) console.log(`  شاسيه ${r.plate || link.unitPlate(r)}: السجلّ ${r.conflicts.vin.registry} · الجهاز ${r.conflicts.vin.device}${r.conflicts.vin.partial ? ' (جزئيّ)' : ''}`);

  // ٥) أسماءُ السائقين — للعرض فقط، لا تُربط هنا
  const Employee = require('../models/Employee');
  const emps = await Employee.find({}).select('firstName lastName arabicName').lean();
  const fold = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const names = new Map();
  for (const e of emps) {
    for (const n of [fold(e.arabicName), fold(`${e.firstName || ''} ${e.lastName || ''}`)]) {
      if (n) names.set(n, (names.get(n) || 0) + 1);
    }
  }
  const drvUnits = await Ls2Vehicle.find({}).select('driver').lean();
  const allDrivers = [...new Set(drvUnits.map((u) => fold(u.driver)).filter(Boolean))];
  const unique = allDrivers.filter((n) => names.get(n) === 1);
  const ambiguous = allDrivers.filter((n) => (names.get(n) || 0) > 1);
  console.log(`سائقون (نصّ Wialon): ${allDrivers.length} · يطابق موظّفًا واحدًا بالاسم حرفيًّا: ${unique.length} · أكثر من موظّف: ${ambiguous.length} · لا يطابق: ${allDrivers.length - unique.length - ambiguous.length}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
