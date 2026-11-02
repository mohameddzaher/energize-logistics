/**
 * reconcileLtRiders: make the vehicle's actual driver match its rider from the department register. The rider has one definition (utils/ltRider): the light-transport staff row linked to the vehicle; `VehicleMaster.actualDriver`
 * mirrors it. This fixes stale text left on vehicles: 1) non-name placeholder text on a vehicle with no rider is cleared. 2) a mirror that disagrees with the real rider is rewritten with the rider's name and identity.
 * 3) an active department employee with no vehicle, whose named vehicle has no other rider, is linked via utils/ltRider.setRider. 4) a name belonging to an employee riding another vehicle, or an ended employee with
 * no vehicle, has the old mirror cleared. 5) a name matching nobody in the register is reported and left untouched. Usage: node src/scripts/reconcileLtRiders.js [--apply] (dry run by default).
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const S = (v) => (v == null ? '' : String(v).trim());

async function main() {
  if (!APPLY) { mongoose.set('autoIndex', false); mongoose.set('autoCreate', false); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, ...(APPLY ? {} : { autoIndex: false, autoCreate: false }) });
  require('../models/Employee');
  const { LightTransportEmployee } = require('../models/LightTransport');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const PR = require('../utils/personRef');
  const VP = require('../utils/vehiclePerson');
  const { setRider, announce } = require('../utils/ltRider');

  const lts = await LightTransportEmployee.find({ isActive: { $ne: false } })
    .select('name idNumber vehicle vehiclePlate employee workStatusAr').populate('employee', 'employmentStatus').lean();
  const ended = (l) => (l.employee && typeof l.employee === 'object' ? l.employee.employmentStatus === 'terminated' : /انهاء|إنهاء/.test(S(l.workStatusAr)));
  const onVehicle = new Map();
  for (const l of lts) if (l.vehicle) { const k = String(l.vehicle); if (!onVehicle.has(k)) onVehicle.set(k, []); onVehicle.get(k).push(l); }
  const byId = new Map(lts.map((l) => [VP.idKey(l.idNumber), l]));
  const byName = new Map();
  for (const l of lts) { const k = PR.foldName(l.name); byName.set(k, byName.has(k) ? null : l); } // null = duplicate name

  const vms = await VehicleMaster.find({}).select('plateNumber actualDriver isActive').lean();
  const out = { placeholder: [], mirrorFixed: [], linked: [], staleCleared: [], unmatched: [], ambiguous: [] };
  const clear = async (v) => { if (APPLY) await VehicleMaster.updateOne({ _id: v._id }, { $set: { 'actualDriver.name': '', 'actualDriver.idNumber': '' } }); };
  const linkedNow = new Set();

  for (const v of vms) {
    const name = S(v.actualDriver?.name); const id = VP.idKey(v.actualDriver?.idNumber);
    const here = onVehicle.get(String(v._id)) || [];
    const rider = here.find((l) => !ended(l)) || here[0] || null; // the rider, otherwise the holder awaiting handover
    const row = { plate: v.plateNumber, mirror: [name, id].filter(Boolean).join(' · ') || '—' };
    if (rider) {
      if (name !== S(rider.name) || id !== VP.idKey(rider.idNumber)) {
        out.mirrorFixed.push({ ...row, to: `${rider.name} · ${rider.idNumber}` });
        if (APPLY) await VehicleMaster.updateOne({ _id: v._id }, { $set: { 'actualDriver.name': S(rider.name), 'actualDriver.idNumber': VP.idKey(rider.idNumber) } });
      }
      continue;
    }
    if (!name && !id) continue;
    // The placeholder text is also written to the identity field: a number without digits is not an identity.
    if (VP.isPlaceholder(name) && (!/\d/.test(id) || VP.isPlaceholder(id))) { out.placeholder.push(row); await clear(v); continue; }
    const k = PR.foldName(name);
    const l = (id && byId.get(id)) || (byName.has(k) ? byName.get(k) : undefined);
    if (l === null) { out.ambiguous.push(row); continue; }
    if (!l) { out.unmatched.push(row); continue; }
    if (l.vehicle && String(l.vehicle) !== String(v._id)) {
      out.staleCleared.push({ ...row, why: `يركب ${S(l.vehiclePlate) || 'مركبةً أخرى'}` }); await clear(v); continue;
    }
    if (ended(l)) { out.staleCleared.push({ ...row, why: 'منتهي الخدمة ولا مركبةَ معه' }); await clear(v); continue; }
    if (linkedNow.has(String(l._id))) { out.staleCleared.push({ ...row, why: 'رُبط بمركبةٍ أخرى في هذا التشغيل' }); await clear(v); continue; }
    out.linked.push({ ...row, to: `${l.name} · ${l.idNumber}` });
    linkedNow.add(String(l._id));
    if (APPLY) await setRider(v._id, l._id, { announce: false, note: 'مطابقة القائد الفعلي (reconcileLtRiders)' });
  }
  if (APPLY) announce();

  const show = (title, list, fmt) => {
    console.log(`\n── ${title}: ${list.length}`);
    for (const x of list) console.log(`   ${fmt(x)}`);
  };
  console.log(APPLY ? '[APPLY] كُتبت التغييرات' : '[DRY-RUN] عرضٌ فقط — لا يُكتب شيء (أضِف --apply)');
  show('نصٌّ ليس اسمًا يُمسَح (مركبةٌ بلا راكب)', out.placeholder, (x) => `${x.plate}: «${x.mirror}»`);
  show('مرآةٌ تُكتب باسم راكبها الفعليّ', out.mirrorFixed, (x) => `${x.plate}: «${x.mirror}» ← ${x.to}`);
  show('يُربط الموظّفُ بالمركبة (كان بلا مركبة)', out.linked, (x) => `${x.plate}: ${x.to}`);
  show('مرآةٌ قديمةٌ تُمسَح', out.staleCleared, (x) => `${x.plate}: «${x.mirror}» — ${x.why}`);
  show('اسمٌ مكرَّرٌ في سجلّ القسم — يُراجَع بيد', out.ambiguous, (x) => `${x.plate}: «${x.mirror}»`);
  show('لا يطابق أحدًا في سجلّ القسم — يُراجَع بيد (لا يُمَسّ)', out.unmatched, (x) => `${x.plate}: «${x.mirror}»`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
