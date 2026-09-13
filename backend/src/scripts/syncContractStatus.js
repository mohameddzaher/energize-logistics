/**
 * syncContractStatus — «حالة العقد» في ملفّ الموظّف تُقرأ من عقده.
 *
 *   node src/scripts/syncContractStatus.js --dry
 *   node src/scripts/syncContractStatus.js --apply
 *
 * ── ما يصلحه ────────────────────────────────────────────────────────────────
 * الحالةُ كانت مكتوبةً في موضعين بمفردتين: صفحةُ العقود تقول «مفسوخ» من
 * `Contract.status`، وعمودُ الموظّف يقول «تم انهاء العقد» من ملفّ الاستيراد.
 * والمعنى واحد، فلا يُفلتَر عليهما معًا ولا يُعَدّان واحدًا.
 *
 * ويفترقان في المعنى أيضًا لا في اللفظ وحده: موظّفٌ عقدُه سارٍ وخانتُه تقول
 * «تم انهاء العقد»، وأربعةٌ عقودُهم ساريةٌ وخاناتُهم فارغة.
 *
 * فالعقدُ هو الحَكَم — هو المستند — والخانةُ صورةٌ منه. وقد صارت تُحدَّث مع كلّ
 * تغيّرٍ في العقود (إنشاءً وتعديلًا وتجديدًا وفسخًا وحذفًا)؛ وهذا للماضي.
 *
 * ── ومَن لا عقدَ له في النظام ──────────────────────────────────────────────
 * مئةٌ وسبعةٌ وثلاثون موظّفًا لا عقدَ لهم مسجَّلًا. خانتُهم كلُّ ما يُعرَف عنهم،
 * فلا تُمحى — يُوحَّد لفظُها فقط: «تم انهاء العقد» تصير «مفسوخ» و«غير ساري»
 * تصير «منتهي»، فيقرأ العمودُ كلُّه بمفرداتٍ واحدة. و«لا يوجد» تبقى: هي نفيُ
 * وجود عقدٍ لا حالةٌ له.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const Employee = require('../models/Employee');
  const Contract = require('../models/Contract');
  const { CONTRACT_STATUS_AR, normaliseContractStatus } = require('../utils/contractStatus');

  // العقدُ الحاكم لكلّ موظّف — استعلامٌ واحدٌ لا واحدٌ لكلّ صفّ.
  const contracts = await Contract.find({}).select('employee status createdAt').sort({ createdAt: -1 }).lean();
  const govern = new Map();
  for (const c of contracts) {
    const k = String(c.employee);
    const cur = govern.get(k);
    if (!cur || (cur.status !== 'active' && c.status === 'active')) govern.set(k, c);
  }

  const emps = await Employee.find({ isHrRecord: { $ne: false } })
    .select('employeeNumber arabicName contractStatusText').lean();

  const fromContract = []; const normalised = []; let same = 0; let untouched = 0;
  for (const e of emps) {
    const has = String(e.contractStatusText || '').trim();
    const c = govern.get(String(e._id));
    if (c) {
      const want = CONTRACT_STATUS_AR[c.status] || c.status;
      if (has === want) { same += 1; continue; }
      fromContract.push({ e, has, want, src: c.status });
    } else {
      const want = normaliseContractStatus(has);
      if (!has || want === has) { untouched += 1; continue; }
      normalised.push({ e, has, want });
    }
  }

  console.log(`\n  موظفون: ${emps.length}${APPLY ? '' : '   — تجربة، بلا كتابة —'}`);
  console.log(`  ✔ مطابقٌ لعقده أصلًا            ${same}`);
  console.log(`  → يُقرأ من العقد                ${fromContract.length}`);
  console.log(`  → يُوحَّد لفظُه (لا عقدَ له)      ${normalised.length}`);
  console.log(`  · لا يُمَسّ                      ${untouched}\n`);

  if (fromContract.length) {
    console.log('  ── من العقد ──');
    const g = {};
    for (const x of fromContract) { const k = `«${x.has || 'فارغ'}» ← «${x.want}»  (العقد ${x.src})`; g[k] = (g[k] || 0) + 1; }
    for (const [k, n] of Object.entries(g).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
  }
  if (normalised.length) {
    console.log('\n  ── توحيدُ اللفظ ──');
    const g = {};
    for (const x of normalised) { const k = `«${x.has}» ← «${x.want}»`; g[k] = (g[k] || 0) + 1; }
    for (const [k, n] of Object.entries(g).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
  }

  if (APPLY) {
    const ops = [...fromContract, ...normalised].map((x) => ({
      updateOne: { filter: { _id: x.e._id }, update: { $set: { contractStatusText: x.want } } },
    }));
    if (ops.length) {
      const r = await Employee.bulkWrite(ops, { ordered: false });
      console.log(`\n  ✔ كُتبت لـ ${r.modifiedCount} موظّفًا.`);
    } else console.log('\n  لا شيءَ يُكتب.');
  } else if (fromContract.length || normalised.length) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.');
  }

  // والتحقّق: لا موظّفَ له عقدٌ وخانتُه تخالفه
  const after = await Employee.find({ isHrRecord: { $ne: false } }).select('contractStatusText').lean();
  const words = {};
  for (const e of after) { const t = String(e.contractStatusText || '').trim() || '(فارغ)'; words[t] = (words[t] || 0) + 1; }
  console.log('\n  ── مفردات العمود بعد ذلك ──');
  for (const [k, n] of Object.entries(words).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
