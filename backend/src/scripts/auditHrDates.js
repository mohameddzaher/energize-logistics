/** تواريخُ الموظّفين: أيُّها خارجُ المعقول (هجريٌّ خُزّن كأنّه ميلاديّ). */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const paths = Object.entries(Employee.schema.paths)
    .filter(([, p]) => p.instance === 'Date')
    .map(([k]) => k);
  console.log(`حقولُ التاريخ في الموظّف: ${paths.length}\n`);

  const LOW = new Date('1900-01-01');
  const HIGH = new Date('2100-01-01');
  let totalBad = 0;
  for (const f of paths) {
    const filled = await Employee.countDocuments({ [f]: { $ne: null } });
    if (!filled) continue;
    const bad = await Employee.countDocuments({ [f]: { $ne: null }, $or: [{ [f]: { $lt: LOW } }, { [f]: { $gt: HIGH } }] });
    if (bad) {
      totalBad += bad;
      const ex = await Employee.find({ [f]: { $ne: null }, $or: [{ [f]: { $lt: LOW } }, { [f]: { $gt: HIGH } }] })
        .select(`employeeNumber name ${f}`).limit(3).lean();
      console.log(`✗ ${f.padEnd(26)} ممتلئ=${String(filled).padStart(4)} · خارجُ المعقول=${bad}`);
      ex.forEach((e) => console.log(`     ${e.employeeNumber} ${String(e.name).slice(0, 24).padEnd(24)} ${new Date(e[f]).toISOString().slice(0, 10)}`));
    } else {
      console.log(`  ${f.padEnd(26)} ممتلئ=${String(filled).padStart(4)} · سليم`);
    }
  }
  console.log(`\nالإجمالي خارجَ المعقول: ${totalBad}`);
  await mongoose.disconnect();
})();
