/**
 * Links fleet management to the two registries (truck to vehicle registry, driver to HR file) and unifies duplicated trucks.
 * FleetVehicle held copied plate/brand/color unrelated to VehicleMaster, and some plates were written twice with different spellings. FleetDriver held name/mobile/iqama copies unrelated to Employee.
 * Trucks are grouped by canonicalPlateKey; duplicates merge into one (active first, then the one with drivers and references, then oldest) and all references move to it (FleetShipment, FleetRequest, FleetVehicleLog, drivers); waybill snapshots are untouched as legal documents. Then each truck links to its vehicleMaster and fills empty registry brand/color. Drivers link by identity number (iqamaNumber, nationalId), then by exact full name matching one employee; archived employees and employees with two live drivers are skipped, and the rest are printed.
 * Usage: node src/scripts/linkFleetIdentity.js [--apply]; prints only without --apply.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { canonicalPlateKey } = require(`${ROOT}/utils/plateKey`);
const { nameKey } = require(`${ROOT}/utils/nameKey`);
const FI = require(`${ROOT}/utils/fleetIdentity`);

const APPLY = process.argv.includes('--apply');
const S = (v) => String(v == null ? '' : v).trim();
const idNorm = (v) => S(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, '');
// Cleanest plate in the group: no dashes or symbols.
const plateClean = (p) => /^[0-9A-Z؀-ۿ ]+$/.test(S(p));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { FleetVehicle, FleetDriver, FleetShipment } = require(`${ROOT}/models/FleetModels`);
  const FleetRequest = require(`${ROOT}/models/FleetRequest`);
  const FleetVehicleLog = require(`${ROOT}/models/FleetVehicleLog`);
  const { VehicleMaster } = require(`${ROOT}/models/VehicleMaster`);
  const Employee = require(`${ROOT}/models/Employee`);
  const { ARCHIVED } = require(`${ROOT}/utils/hrEngagement`);
  const vehicleRef = require(`${ROOT}/utils/vehicleRef`);

  console.log(APPLY ? '── تطبيق ──' : '── قراءة فقط (أضف --apply للتطبيق) ──');

  // 1. Trucks.
  const REFS = [
    ['الحمولات', FleetShipment, 'vehicle'],
    ['طلبات الأسطول', FleetRequest, 'vehicle'],
    ['سجلّات السيّارة', FleetVehicleLog, 'vehicle'],
    ['السائقون', FleetDriver, 'vehicle'],
  ];
  const vehicles = await FleetVehicle.find({}).lean();
  const groups = new Map();
  const noKey = [];
  for (const v of vehicles) {
    const k = canonicalPlateKey(v.plate);
    if (!k) { noKey.push(v); continue; }
    (groups.get(k) || groups.set(k, []).get(k)).push(v);
  }
  console.log(`\nشاحنات الأسطول: ${vehicles.length} · لوحات مختلفة: ${groups.size} · بلا مفتاح: ${noKey.length}`);

  const refCount = async (id) => {
    const out = {};
    for (const [label, M, f] of REFS) out[label] = await M.countDocuments({ [f]: id });
    return out;
  };

  let merged = 0;
  const survivors = [];
  for (const [key, list] of groups) {
    if (list.length === 1) { survivors.push(list[0]); continue; }
    const scored = [];
    for (const v of list) {
      const refs = await refCount(v._id);
      scored.push({ v, refs, active: v.isActive !== false, drivers: refs['السائقون'], total: Object.values(refs).reduce((a, b) => a + b, 0) });
    }
    scored.sort((a, b) => (b.active - a.active) || (b.drivers - a.drivers) || (b.total - a.total)
      || (new Date(a.v.createdAt) - new Date(b.v.createdAt)));
    const keep = scored[0];
    const drop = scored.slice(1);
    const cleanPlate = [keep.v, ...drop.map((d) => d.v)].map((v) => v.plate).find(plateClean) || keep.v.plate;
    console.log(`\nمكرَّرة ${key}: تبقى ${keep.v._id} «${keep.v.plate}»${keep.active ? '' : ' (مُزالة)'} ← اللوحة «${cleanPlate}»`);
    for (const d of drop) console.log(`   تُدمَج ${d.v._id} «${d.v.plate}»${d.active ? '' : ' (مُزالة)'} مراجعها ${JSON.stringify(d.refs)}`);

    // Carry values from the merged copy into the survivor where it has none.
    const fill = {};
    for (const f of ['brand', 'color', 'name', 'notes', 'supervisor', 'supervisorName', 'trailerType', 'gpsType']) {
      if (!keep.v[f]) { const from = drop.find((d) => d.v[f]); if (from) fill[f] = from.v[f]; }
    }
    if (Object.keys(fill).length) console.log(`   يُكمَّل من المُدمَجة: ${JSON.stringify(fill)}`);
    const seatedAfter = keep.drivers + drop.reduce((a, d) => a + d.drivers, 0);
    if (seatedAfter > 2) console.log(`   ⚠ ${seatedAfter} سائقين بعد الدمج — يُنزَل الزائد إلى المخزون`);

    if (APPLY) {
      for (const d of drop) {
        for (const [, M, f] of REFS) {
          if (M === FleetDriver) continue;
          await M.updateMany({ [f]: d.v._id }, { $set: { [f]: keep.v._id } });
        }
        // Drivers: two seats is a rule, so extras go back to stock instead of forcing a third.
        const seated = await FleetDriver.countDocuments({ vehicle: keep.v._id, isActive: { $ne: false } });
        const incoming = await FleetDriver.find({ vehicle: d.v._id }).sort({ seat: 1 }).lean();
        let room = Math.max(0, 2 - seated);
        for (const x of incoming) {
          if (x.isActive !== false && room > 0) {
            // Seat order is fixed after the merge (below).
            await FleetDriver.updateOne({ _id: x._id }, { $set: { vehicle: keep.v._id, seat: 2 } });
            room -= 1;
          } else {
            await FleetDriver.updateOne({ _id: x._id }, { $set: { vehicle: null, seat: 1 } });
          }
        }
        await FleetVehicle.deleteOne({ _id: d.v._id });
      }
      // Seats stay ordered: first then second, never a second without a first.
      const crew = await FleetDriver.find({ vehicle: keep.v._id, isActive: { $ne: false } }).sort({ seat: 1, createdAt: 1 }).lean();
      for (let i = 0; i < crew.length; i += 1) await FleetDriver.updateOne({ _id: crew[i]._id }, { $set: { seat: i === 0 ? 1 : 2 } });
      await FleetVehicle.updateOne({ _id: keep.v._id }, { $set: { ...fill, plate: cleanPlate, isActive: keep.active || drop.some((d) => d.active) } });
    }
    keep.v.plate = cleanPlate;
    Object.assign(keep.v, fill);
    survivors.push(keep.v);
    merged += drop.length;
  }
  survivors.push(...noKey);

  // Link to the registry.
  const resolved = await vehicleRef.resolveMany(survivors.map((v) => v.plate), '_id plateNumber canonKey brandAr colorAr');
  let linked = 0; let already = 0; let unresolved = 0; let pushBrand = 0; let pushColor = 0; let differ = 0;
  const unresolvedList = [];
  const usedVm = new Map();
  for (const v of survivors) {
    const vm = resolved.get(canonicalPlateKey(v.plate));
    if (!vm) { unresolved += 1; unresolvedList.push(v.plate); continue; }
    if (usedVm.has(String(vm._id))) { console.log(`⚠ ${v.plate} و${usedVm.get(String(vm._id))} على مركبةٍ واحدة في السجلّ`); continue; }
    usedVm.set(String(vm._id), v.plate);
    if (v.vehicleMaster && String(v.vehicleMaster) === String(vm._id)) already += 1; else linked += 1;
    const set = {};
    if (!S(vm.brandAr) && S(v.brand)) { set.brandAr = S(v.brand); pushBrand += 1; }
    if (!S(vm.colorAr) && S(v.color)) { set.colorAr = S(v.color); pushColor += 1; }
    if ((S(v.brand) && S(vm.brandAr) && S(v.brand) !== S(vm.brandAr)) || (S(v.color) && S(vm.colorAr) && S(v.color) !== S(vm.colorAr))) {
      differ += 1;
      console.log(`   يختلف عن السجلّ (السجلّ يغلب): ${v.plate} «${v.brand || ''}/${v.color || ''}» ← «${vm.brandAr || ''}/${vm.colorAr || ''}»`);
    }
    if (APPLY) {
      await FleetVehicle.updateOne({ _id: v._id }, { $set: { vehicleMaster: vm._id } });
      if (Object.keys(set).length) await VehicleMaster.findByIdAndUpdate(vm._id, { $set: set }, { new: true });
    }
  }
  console.log(`\nالشاحنات: دُمجت ${merged} مكرَّرة · رُبطت ${linked} · مربوطة من قبل ${already} · بلا مركبةٍ في السجلّ ${unresolved}${unresolvedList.length ? ` (${unresolvedList.join('، ')})` : ''}`);
  console.log(`          تختلف نسختُها عن السجلّ ${differ} · تُكتب في السجلّ: ماركة ${pushBrand} · لون ${pushColor}`);

  // 2. Drivers.
  const drivers = await FleetDriver.find({}).lean();
  const emps = await Employee.find({ $nor: [ARCHIVED] }).select(FI.HR_SELECT).lean();
  const byId = new Map();
  const byName = new Map();
  for (const e of emps) {
    for (const n of [e.iqamaNumber, e.nationalId]) {
      const k = idNorm(n);
      if (k) (byId.get(k) || byId.set(k, []).get(k)).push(e);
    }
    const names = new Set([nameKey(`${e.firstName || ''} ${e.lastName || ''}`), nameKey(e.arabicName)].filter(Boolean));
    for (const k of names) (byName.get(k) || byName.set(k, []).get(k)).push(e);
  }
  const uniq = (list) => [...new Map((list || []).map((e) => [String(e._id), e])).values()];

  // An employee cannot be two live drivers.
  const takenActive = new Map();
  for (const d of drivers) if (d.employee && d.isActive !== false) takenActive.set(String(d.employee), d);

  const stats = { total: drivers.length, active: drivers.filter((d) => d.isActive !== false).length, already: 0, byId: 0, byName: 0, conflict: 0, ambiguous: 0, unmatched: 0 };
  const unmatched = [];
  const plates = new Map(vehicles.map((v) => [String(v._id), v.plate]));
  for (const d of drivers) {
    if (d.employee) { stats.already += 1; continue; }
    let hit = null; let how = '';
    const idk = idNorm(d.iqama);
    if (idk) {
      const l = uniq(byId.get(idk));
      if (l.length === 1) { hit = l[0]; how = 'id'; } else if (l.length > 1) { stats.ambiguous += 1; }
    }
    if (!hit) {
      const nk = nameKey(d.name);
      const l = nk ? uniq(byName.get(nk)) : [];
      if (l.length === 1) { hit = l[0]; how = 'name'; } else if (l.length > 1) { stats.ambiguous += 1; }
    }
    if (hit && d.isActive !== false) {
      const t = takenActive.get(String(hit._id));
      if (t && String(t._id) !== String(d._id)) {
        stats.conflict += 1;
        console.log(`   ⚠ «${d.name}» يطابق ${FI.hrName(hit)} المربوط بـ«${t.name}» — يُترك`);
        hit = null;
      }
    }
    if (!hit) {
      if (d.isActive !== false) {
        stats.unmatched += 1;
        unmatched.push({ name: d.name, iqama: d.iqama || '', plate: plates.get(String(d.vehicle)) || '' });
      }
      continue;
    }
    stats[how === 'id' ? 'byId' : 'byName'] += 1;
    if (d.isActive !== false) takenActive.set(String(hit._id), d);
    console.log(`   ${how === 'id' ? 'بالهوية' : 'بالاسم '}  «${d.name}»${d.isActive === false ? ' (مُزال)' : ''} ← ${FI.hrName(hit)} · ${FI.hrIdNumber(hit) || '—'} · ${hit.department || '—'}`);
    if (APPLY) {
      const set = { employee: hit._id };
      if (FI.hrName(hit)) set.name = FI.hrName(hit);
      if (S(hit.phone)) set.phone = S(hit.phone);
      if (FI.hrIdNumber(hit)) set.iqama = FI.hrIdNumber(hit);
      if (S(hit.nationality)) set.nationality = S(hit.nationality);
      if (S(hit.iban)) set.iban = S(hit.iban);
      await FleetDriver.updateOne({ _id: d._id }, { $set: set });
    }
  }
  console.log(`\nالسائقون: ${stats.total} (قائمون ${stats.active}) · مربوطون من قبل ${stats.already} · بالهوية ${stats.byId} · بالاسم ${stats.byName} · تعارض ${stats.conflict} · مبهم ${stats.ambiguous} · بلا ربط (قائمون) ${stats.unmatched}`);
  if (unmatched.length) {
    console.log('\nبلا ربط — يُربطون من «ربط بموظف» في صفحة السائقين:');
    for (const u of unmatched) console.log(`   ${u.name}${u.iqama ? ` · ${u.iqama}` : ''}${u.plate ? ` · ${u.plate}` : ''}`);
  }

  if (APPLY) {
    // The two unique indexes (registry vehicle to one truck, employee to one live driver) are built after the merge, since duplicates would block them.
    await FleetVehicle.createIndexes();
    await FleetDriver.createIndexes();
    const cache = require(`${ROOT}/utils/ttlCache`);
    await cache.clearShared('fleet:');
    console.log('\nطُبِّق. الفهارس مبنيّة، ومخزنُ الأسطول ممسوح.');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
