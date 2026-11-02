/**
 * repairHijriDates: Hijri dates stored as if Gregorian.
 * Usage: node src/scripts/repairHijriDates.js [--yes] (dry run by default).
 * A value like '1449-01-09' in a date field becomes Gregorian year 1449, so the screen reports a huge overdue count for a certificate not yet due. Damage is certain to identify: a working date before 1900 is not a date, and Hijri 1449 falls in 2027, next to valid values in the same field.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { parseHijri, toHijri } = require('../utils/hijri');

const YES = process.argv.includes('--yes');
const LOW = new Date('1900-01-01');
// Date fields that may hold a mistakenly written Hijri date.
const FIELDS = ['healthCertExpiry', 'iqamaExpiry', 'passportExpiry', 'licenseExpiry', 'contractEnd', 'iqamaIssueDate'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');

  let total = 0;
  for (const f of FIELDS) {
    if (!Employee.schema.paths[f] || Employee.schema.paths[f].instance !== 'Date') continue;
    const rows = await Employee.find({ [f]: { $ne: null, $lt: LOW } })
      .select(`employeeNumber nameAr ${f}`).lean();
    if (!rows.length) { console.log(`${f.padEnd(20)} سليم`); continue; }
    console.log(`\n${f} — ${rows.length} صفًّا معطوبًا:`);
    const plan = [];
    for (const r of rows) {
      const iso = new Date(r[f]).toISOString().slice(0, 10);
      const g = parseHijri(iso);                    // Interpret the stored value as Hijri
      if (!g) { console.log(`   ✗ ${r.employeeNumber} ${iso} — تعذّر التحويل`); continue; }
      plan.push({ id: r._id, from: iso, to: g });
    }
    const byPair = {};
    plan.forEach((p) => { const k = `${p.from} → ${p.to.toISOString().slice(0, 10)}`; byPair[k] = (byPair[k] || 0) + 1; });
    Object.entries(byPair).forEach(([k, n]) => console.log(`   ${k}   (${n} موظّف)`));
    total += plan.length;
    if (YES) {
      for (const p of plan) await Employee.updateOne({ _id: p.id }, { $set: { [f]: p.to } });
    }
  }

  console.log(`\n${YES ? '✓ صُحِّح' : 'سيُصحَّح'} ${total} تاريخًا`);
  if (YES) { try { require('../utils/ttlCache').clear('hr:'); } catch (_) {} }
  else console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n');
  await mongoose.disconnect();
})();
