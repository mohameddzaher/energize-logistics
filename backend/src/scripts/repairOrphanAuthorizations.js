/**
 * repairOrphanAuthorizations: authorizations cancelled by wiping that were never closed on the employee file. Usage: node src/scripts/repairOrphanAuthorizations.js [--dry|--apply] An authorization lives in two registers: the paper on the vehicle (`VehicleMaster.authorizedPerson`)
 * and an assignment linking vehicle to employee (`VehicleAuthorization`), which the HR file reads. The authorizations page had no 'cancel authorization' button, only 'clear document data'. Cancelling that way emptied the paper and left the assignment,
 * so people still appear authorized on a car, which blocks their clearance. Only the severed case is fixed: an active assignment whose vehicle is in the registry and whose paper is empty. That is a cancellation that happened and did not finish; completing
 * it is not a decision. Not touched: rows where the two names differ (may be an unrecorded transfer) and rows whose vehicle is not in the registry (left the fleet, or a plate written two ways). Those need a human.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const S = (v) => (v == null ? '' : String(v).trim());

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  require('../models/Vehicle');
  require('../models/Employee');
  const VehicleAuthorization = require('../models/VehicleAuthorization');
  const { VehicleMaster } = require('../models/VehicleMaster');
  const { registryPlateKey } = require('../utils/plateKey');

  const active = await VehicleAuthorization.find({ status: 'active' })
    .populate('vehicle', 'plateNumber')
    .populate('employee', 'arabicName englishName employeeNumber')
    .lean();
  const masters = await VehicleMaster.find({}).select('plateNumber authorizedPerson').lean();
  const byKey = new Map();
  for (const m of masters) { const k = registryPlateKey(m.plateNumber); if (k) byKey.set(k, m); }

  const orphan = []; const nameDiff = []; const noMaster = []; let agree = 0;
  for (const a of active) {
    const plate = S(a.vehicle?.plateNumber);
    const m = plate ? byKey.get(registryPlateKey(plate)) : null;
    if (!m) { noMaster.push({ a, plate }); continue; }
    const who = S(m.authorizedPerson?.name);
    if (!who) { orphan.push({ a, plate }); continue; }
    const emp = S(a.employee?.arabicName) || S(a.employee?.englishName);
    const fold = (x) => x.replace(/\s+/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
    if (emp && fold(who) !== fold(emp)) nameDiff.push({ a, plate, who, emp }); else agree += 1;
  }

  console.log(`\n  تفاويضُ نشطةٌ في سجلّ الإسناد: ${active.length}${APPLY ? '' : '   — تجربة، بلا كتابة —'}\n`);
  console.log(`  ✔ متّفقةٌ مع سجلّ المركبات                 ${agree}`);
  console.log(`  ✘ ورقةُ المركبة فارغة — إلغاءٌ لم يكتمل    ${orphan.length}   ← يُصلَح`);
  console.log(`  ⚠ الاسمان مختلفان                         ${nameDiff.length}   ← يُعرَض ولا يُمَسّ`);
  console.log(`  ⚠ المركبةُ ليست في سجلّ المركبات           ${noMaster.length}   ← يُعرَض ولا يُمَسّ\n`);

  if (orphan.length) {
    console.log('  ── ستُغلَق (الموظّف يظهر مفوَّضًا وليس كذلك) ──\n');
    for (const o of orphan) {
      const e = o.a.employee;
      console.log(`    ${String(o.plate).padEnd(16)} ${S(e?.arabicName) || S(e?.englishName) || '—'} (${S(e?.employeeNumber) || '—'})  منذ ${o.a.startDate}`);
    }
  }

  if (APPLY && orphan.length) {
    const today = new Date().toISOString().slice(0, 10);
    const ids = orphan.map((o) => o.a._id);
    const r = await VehicleAuthorization.updateMany({ _id: { $in: ids } }, {
      $set: {
        status: 'revoked', endDate: today, endReason: 'revoked',
        // The reason is written explicitly so a later reader knows the closure corrects an earlier cancellation rather than being a new one.
        revokedReason: 'إغلاقُ إسنادٍ بقي مفتوحًا بعد إلغاءِ التفويض من سجلّ المركبات',
      },
    });
    console.log(`\n  ✔ أُغلق ${r.modifiedCount} إسنادًا.`);
  } else if (!APPLY) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.');
  }

  if (nameDiff.length) {
    console.log('\n  ── اختلافُ الاسم — يُراجَع بيد ──\n');
    for (const x of nameDiff.slice(0, 80)) {
      console.log(`    ${String(x.plate).padEnd(16)} الإسناد «${x.emp}»   سجلُّ المركبات «${x.who}»`);
    }
    if (nameDiff.length > 80) console.log(`    … و${nameDiff.length - 80} غيرها`);
  }
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
