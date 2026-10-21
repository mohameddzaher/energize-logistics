/**
 * reconcileLtRiders — «القائد الفعلي» على المركبة يطابق راكبَها من سجلّ القسم.
 *
 * ── لماذا (صاحبُ الشركة، ٢٠٢٦/١٠/٢٢) ───────────────────────────────────────
 * «مركبات بلا راكب» في لوحة B2C فتحت مركباتٍ عليها أسماءٌ في «اسم القائد الفعلي».
 * فالراكبُ صار تعريفًا واحدًا (utils/ltRider): صفُّ «موظفي النقل الخفيف» المربوطُ
 * بالمركبة، و`VehicleMaster.actualDriver` مرآتُه. وهذا السكربت يُصلح ما بقي من
 * نصوصٍ قديمةٍ على المركبات:
 *   ١) نصٌّ ليس اسمًا («غيرمستخدم»، «لا يوجد»، «-») على مركبةٍ بلا راكب ← يُمسَح.
 *   ٢) مرآةٌ تخالف راكبَ المركبة الفعليّ ← تُكتب باسمه وهويّته.
 *   ٣) اسمٌ لموظّفٍ نشطٍ في القسم بلا مركبة، والمركبةُ بلا راكبٍ آخر ← يُربط بها
 *      (بأمر تشغيلٍ كأيّ ربط — utils/ltRider.setRider) فتتبعه المرآة.
 *   ٤) اسمٌ لموظّفٍ يركب مركبةً أخرى، أو منتهي الخدمة بلا مركبة ← تُمسَح المرآةُ القديمة.
 *   ٥) اسمٌ لا يطابق أحدًا في سجلّ القسم ← يُذكَر في التقرير ولا يُمَسّ.
 *
 *   node src/scripts/reconcileLtRiders.js            # عرضٌ فقط (لا يكتب)
 *   node src/scripts/reconcileLtRiders.js --apply    # يكتب
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
  for (const l of lts) { const k = PR.foldName(l.name); byName.set(k, byName.has(k) ? null : l); } // null = اسمٌ مكرَّر

  const vms = await VehicleMaster.find({}).select('plateNumber actualDriver isActive').lean();
  const out = { placeholder: [], mirrorFixed: [], linked: [], staleCleared: [], unmatched: [], ambiguous: [] };
  const clear = async (v) => { if (APPLY) await VehicleMaster.updateOne({ _id: v._id }, { $set: { 'actualDriver.name': '', 'actualDriver.idNumber': '' } }); };
  const linkedNow = new Set();

  for (const v of vms) {
    const name = S(v.actualDriver?.name); const id = VP.idKey(v.actualDriver?.idNumber);
    const here = onVehicle.get(String(v._id)) || [];
    const rider = here.find((l) => !ended(l)) || here[0] || null; // الراكب، وإلّا صاحبُ «بانتظار التسليم»
    const row = { plate: v.plateNumber, mirror: [name, id].filter(Boolean).join(' · ') || '—' };
    if (rider) {
      if (name !== S(rider.name) || id !== VP.idKey(rider.idNumber)) {
        out.mirrorFixed.push({ ...row, to: `${rider.name} · ${rider.idNumber}` });
        if (APPLY) await VehicleMaster.updateOne({ _id: v._id }, { $set: { 'actualDriver.name': S(rider.name), 'actualDriver.idNumber': VP.idKey(rider.idNumber) } });
      }
      continue;
    }
    if (!name && !id) continue;
    // و«غيرمستخدم» يُكتب في خانة الهويّة أيضًا — رقمٌ بلا أرقامٍ ليس هويّة.
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
