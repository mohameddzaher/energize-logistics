/**
 * repairEmploymentFromContract — العقدُ السارِي يعني موظّفًا على رأس العمل.
 *
 *   node src/scripts/repairEmploymentFromContract.js --dry
 *   node src/scripts/repairEmploymentFromContract.js --yes
 *
 * ── القاعدة ────────────────────────────────────────────────────────────────
 * الخدمةُ لا تنتهي بأن يُكتب في ورقةٍ أنّها انتهت — تنتهي بإنهاءٍ يُجرى، ويُقفَل
 * معه العقد. فما دام للموظّف عقدٌ ساري المفعول فهو على رأس العمل.
 *
 * ── ما وقع ─────────────────────────────────────────────────────────────────
 * أربعون موظّفًا حالتُهم «منتهي» وعقودُهم «ساري». والملفّان مصدرُهما مختلف:
 * الحالةُ من ماستر الموارد البشريّة، والعقدُ من ملفّ العقود — وملفُّ العقود
 * يقول «ساري» في الأربعين كلِّهم. فالتعارضُ حقيقيّ، والعقدُ أرجح: هو المستندُ
 * الذي يُوقَّع ويُودَع، والحالةُ خانةٌ تُكتب بيدٍ في كشف.
 *
 * ولا يُقلَب العكس: مَن لا عقدَ ساريًا له لا يُنهى بهذا السكربت — قد يكون
 * عقدُه ينتظر التجديدَ لا أنّ خدمتَه انتهت. يُسمَّون ويُترك القرارُ لأهله.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');

  console.log(DRY ? '── تجربة، بلا كتابة ──\n' : '── تنفيذ ──\n');

  const terminated = await Employee.find({ employmentStatus: 'terminated', isHrRecord: { $ne: false } })
    .select('arabicName firstName lastName employeeNumber department terminatedAt').lean();
  const live = await Contract.find({ employee: { $in: terminated.map((e) => e._id) }, status: 'active' })
    .select('employee startDate endDate contractNumber').lean();
  const liveBy = new Map(live.map((c) => [String(c.employee), c]));

  const fix = terminated.filter((e) => liveBy.has(String(e._id)));
  console.log(`منتهون وعقدُهم ساري — يعودون إلى «على رأس العمل»: ${fix.length}`);
  for (const e of fix) {
    const c = liveBy.get(String(e._id));
    const nm = e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`.trim();
    console.log(`   ${nm.padEnd(34)} رقم ${String(e.employeeNumber || '—').padEnd(9)} عقد ${c.startDate}→${c.endDate}  ${c.contractNumber || ''}`);
  }

  // ── والعكسُ يُسمَّى ولا يُنفَّذ ───────────────────────────────────────────
  const active = await Employee.find({ employmentStatus: 'active', isHrRecord: { $ne: false } }).select('_id arabicName firstName lastName').lean();
  const anyLive = new Set((await Contract.find({ employee: { $in: active.map((e) => e._id) }, status: 'active' }).select('employee').lean()).map((c) => String(c.employee)));
  const hasContract = new Set((await Contract.find({ employee: { $in: active.map((e) => e._id) } }).select('employee').lean()).map((c) => String(c.employee)));
  const noLive = active.filter((e) => hasContract.has(String(e._id)) && !anyLive.has(String(e._id)));
  console.log(`\nعلى رأس العمل ولا عقدَ ساريًا لهم (يُسمَّون ولا يُمَسّون): ${noLive.length}`);
  for (const e of noLive.slice(0, 15)) console.log(`   ${e.arabicName || `${e.firstName} ${e.lastName}`}`);
  if (noLive.length > 15) console.log(`   … و${noLive.length - 15} غيرهم`);
  console.log('   (قد يكون عقدُ أحدهم ينتظر التجديد — والتجديدُ قرارٌ لا استنتاج.)');

  if (DRY) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  if (fix.length) {
    const r = await Employee.updateMany(
      { _id: { $in: fix.map((e) => e._id) } },
      { $set: { employmentStatus: 'active' }, $unset: { terminatedAt: 1, terminationReason: 1 } },
    );
    console.log(`\n✓ أُعيد ${r.modifiedCount} موظّفًا إلى «على رأس العمل»`);
  }
  const now = await Employee.aggregate([
    { $match: { isHrRecord: { $ne: false } } },
    { $group: { _id: '$employmentStatus', n: { $sum: 1 } } },
  ]);
  console.log('الحالة الآن:', now.map((x) => `${x._id || '(بلا)'}=${x.n}`).join(' · '));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
