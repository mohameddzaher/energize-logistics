/**
 * backfillContractStatus — حالةُ العقد لمن أُنهيت خدمتُه ولم تُكتب له.
 *
 *   node src/scripts/backfillContractStatus.js --dry
 *   node src/scripts/backfillContractStatus.js --apply
 *
 * ── لماذا هي فارغة ─────────────────────────────────────────────────────────
 * `contractStatusText` كان يُملأ من ملفّ الاستيراد وحدَه؛ وإنهاءُ الخدمة من
 * الشاشة لا يكتبه. فمن أُنهيت خدمتُه في النظام بقي عمودُه فارغًا — وهو العمودُ
 * الذي يُقرأ في قائمة «ليس على رأس العمل» ليُعرَف أمفسوخٌ عقدُه أم ساري.
 *
 * وقد صار الإنهاءُ يكتبها (راجع `terminateEmployee`)، فهذا للماضي وحدَه.
 *
 * ── ولا يُكتب إلّا على الفارغ ───────────────────────────────────────────────
 * من كُتبت له حالةٌ — ولو «ساري» على منهيّ الخدمة — لا تُمَسّ: قد تكون صحيحةً
 * (عقدٌ لم يُفسَخ بعدُ وإن غادر) وقد تكون خطأً يُراجَع، وكلاهما قرارُ إنسانٍ لا
 * سكربت. تُطبَع ليقرأها من يعنيه.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const ENDED = 'تم انهاء العقد';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Employee = require('../models/Employee');

  const notActive = { isHrRecord: { $ne: false }, employmentStatus: { $ne: 'active' } };
  const all = await Employee.find(notActive)
    .select('employeeNumber arabicName employmentStatus contractStatusText terminatedAt').lean();

  const blank = all.filter((e) => !String(e.contractStatusText || '').trim());
  const written = all.filter((e) => String(e.contractStatusText || '').trim());

  console.log(`\n  ليسوا على رأس العمل: ${all.length}${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  بلا حالةِ عقدٍ مكتوبة: ${blank.length}   ← تُكتب «${ENDED}»`);
  console.log(`  لها حالةٌ مكتوبة: ${written.length}   ← لا تُمَسّ\n`);

  // والمنهيّةُ خدمتُه وحدَها تأخذ «تم انهاء العقد». من هو «في إجازة» ليس عقدُه
  // منتهيًا — يُترك ويُقال، فكتابةُ الإنهاء عليه تقلب معناه.
  const toWrite = blank.filter((e) => e.employmentStatus === 'terminated');
  const skipped = blank.filter((e) => e.employmentStatus !== 'terminated');

  for (const e of toWrite.slice(0, 60)) {
    console.log(`    ${String(e.employeeNumber || '—').padEnd(8)} ${e.arabicName || ''}`);
  }
  if (toWrite.length > 60) console.log(`    … و${toWrite.length - 60} غيرهم`);
  if (skipped.length) {
    console.log(`\n  ⚠ ${skipped.length} ليسوا على رأس العمل ولم تُنهَ خدمتُهم (إجازة/إيقاف) — لا تُكتب لهم:`);
    for (const e of skipped) console.log(`    ${String(e.employeeNumber || '—').padEnd(8)} ${e.arabicName || ''}  (${e.employmentStatus})`);
  }

  if (APPLY && toWrite.length) {
    const r = await Employee.updateMany(
      { _id: { $in: toWrite.map((e) => e._id) } },
      { $set: { contractStatusText: ENDED } },
    );
    console.log(`\n  ✔ كُتبت لـ ${r.modifiedCount} موظّفًا.`);
    try { require('../controllers/hrController'); } catch (_) { /* الكاش يُبطَل عند أوّل قراءة */ }
  } else if (!APPLY) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.');
  }
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
