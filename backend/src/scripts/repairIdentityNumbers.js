/**
 * repairIdentityNumbers — رقمُ هويّة السعوديّ يُنسَخ إلى العمود الذي يُقرأ.
 *
 *   node src/scripts/repairIdentityNumbers.js --dry
 *   node src/scripts/repairIdentityNumbers.js
 *
 * السببُ مشروحٌ عند `mirrorNationalId` في models/Employee: الرقمُ مكتوبٌ في
 * `nationalId` والشاشاتُ تقرأ `iqamaNumber`، فيظهر الموظّفُ «بلا رقم هويّة»
 * ويُعَدّ نقصًا في قائمة عمل الموارد البشريّة. الخطّافُ يمنعها من الآن، وهذا
 * يُصلح المكتوبَ قبله.
 *
 * ولا يُكتب فوق قيمةٍ مخالفة: صفٌّ عمودُه مملوءٌ برقمٍ آخرَ يُعرَض ولا يُمَسّ —
 * رقمان مختلفان لشخصٍ واحد سؤالٌ لبشرٍ لا لسكربت.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Employee = require('../models/Employee');
  const rows = await Employee.find({ idType: 'national_id', nationalId: { $nin: ['', null] } })
    .select('employeeNumber arabicName firstName lastName idType iqamaNumber nationalId').lean();
  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  console.log(`أصحابُ الهويّة الوطنيّة ومعهم رقمُها: ${rows.length}`);

  const ops = []; const conflicts = []; let same = 0;
  for (const e of rows) {
    const nid = String(e.nationalId).trim();
    const cur = String(e.iqamaNumber || '').trim();
    if (cur === nid) { same += 1; continue; }
    if (cur) { conflicts.push(`${e.employeeNumber || e._id} ${e.arabicName || ''} — العمود «${cur}» والهويّة «${nid}»`); continue; }
    ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { iqamaNumber: nid } } } });
  }

  if (!DRY && ops.length) await Employee.bulkWrite(ops, { ordered: false });
  console.log(`عليه الرقمُ نفسُه سلفًا: ${same}`);
  console.log(`${DRY ? 'سيُنسَخ' : 'نُسِخ'} إلى «رقم الهوية/الإقامة»: ${ops.length}`);
  if (conflicts.length) {
    console.log(`\nرقمان مختلفان — تُترك للمراجعة (${conflicts.length}):`);
    for (const c of conflicts) console.log('    ' + c);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
