/**
 * repairIdentityNumbers: copy a Saudi national ID into the column that is read.
 * Usage: node src/scripts/repairIdentityNumbers.js [--dry]
 * See `mirrorNationalId` in models/Employee: the number was written to `nationalId` but screens read `iqamaNumber`, so the employee showed as having no identity number and counted as a gap in HR's worklist. The hook prevents it from now on; this fixes earlier data.
 * A differing existing value is never overwritten: a row whose column holds another number is shown and left alone, since two numbers for one person is a question for a human.
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
