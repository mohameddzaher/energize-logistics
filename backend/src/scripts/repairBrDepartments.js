/* eslint-disable no-console */
// Restates the department stored on business review tasks (and the copy on their delegated parts) from the owner:
// his role's section, else his HR department (utils/userSection). Tasks given to a super admin were filed under the
// department a form defaulted to. Dry run unless --apply.
//   node src/scripts/repairBrDepartments.js [--apply]
require('dotenv').config();
const mongoose = require('mongoose');
const { BrAction, BrAssignment } = require('../models/BusinessReview');
const { sectionsOfUserIds } = require('../utils/userSection');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const actions = await BrAction.find({}).select('title assignee assigneeName department').lean();
  const sec = await sectionsOfUserIds(actions.map((a) => a.assignee));
  let n = 0;
  for (const a of actions) {
    const want = sec.get(String(a.assignee));
    if (!want || want === a.department) continue;
    n += 1;
    console.log(`${a.title} (${a.assigneeName}): ${a.department || '-'} -> ${want}`);
    if (apply) {
      await BrAction.updateOne({ _id: a._id }, { $set: { department: want } }); // eslint-disable-line no-await-in-loop
      await BrAssignment.updateMany({ action: a._id }, { $set: { department: want } }); // eslint-disable-line no-await-in-loop
    }
  }
  console.log(apply ? `fixed ${n}` : `dry run: ${n}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
