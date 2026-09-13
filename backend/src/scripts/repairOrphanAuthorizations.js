/**
 * repairOrphanAuthorizations — تفاويضُ أُلغيت بالمسح ولم تُغلَق في ملفّ الموظّف.
 *
 *   node src/scripts/repairOrphanAuthorizations.js --dry
 *   node src/scripts/repairOrphanAuthorizations.js --apply
 *
 * ── ما جرى ──────────────────────────────────────────────────────────────────
 * التفويضُ مسجَّلٌ في سجلَّين: ورقةٌ على المركبة (`VehicleMaster.authorizedPerson`)
 * وإسنادٌ يربط المركبةَ بالموظّف (`VehicleAuthorization`) يقرؤه ملفُّه في الموارد
 * البشريّة. ولم يكن في صفحة التفاويض زرٌّ اسمُه «إلغاء التفويض» — كان فيها
 * «مسح بيانات المستند». فمن أراد الإلغاءَ ضغطه: فُرِّغت الورقةُ وبقي الإسناد.
 *
 * فبقي أصحابُها «مفوَّضين على سيّارة» في ملفّاتهم وليسوا كذلك. وهو شرطٌ في
 * إخلاء الطرف، فلا يُخلى طرفُ الواحد منهم حتى يُكتشَف الأمرُ بيد.
 *
 * ── وما يُصلَح هنا وما لا يُصلَح ────────────────────────────────────────────
 * يُصلَح المقطوعُ وحدَه: إسنادٌ نشطٌ ومركبتُه في السجلّ وورقتُها **فارغة**. ذاك
 * إلغاءٌ وقع ولم يكتمل، وإتمامُه ليس قرارًا.
 *
 * ولا يُمَسّ ما اختلف فيه الاسمان (ثلاثةٌ وسبعون) ولا ما لا مركبةَ له في السجلّ
 * (تسعةٌ وأربعون): الأوّلُ قد يكون تحويلًا لم يُسجَّل، والثاني مركبةٌ خرجت من
 * الأسطول أو لوحةٌ كُتبت بصيغتين. وكلاهما يحتاج من يقرؤه، لا سكربتًا يخمّن.
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
        // السببُ يُكتب صراحةً: من يقرأ السجلَّ بعد سنةٍ يعرف أنّ الإغلاق تصحيحٌ
        // لإلغاءٍ وقع من قبل، لا إلغاءٌ جديدٌ وقع اليوم.
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
