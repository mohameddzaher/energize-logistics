/**
 * backfillLtUserRentals: every user account in light transport staff has a linked rental.
 * Why: the dashboard said Ninja had 13 rented users while the user rental page was empty; the 13 had contract type "user accounts" on their rows but no rental record. The definition is now an active rental linked to the row (utils/ltRental). So each such row without a linked rental gets an initial one: its project is the row's project, and the renter is "to be completed", a flagged placeholder to fix from the page, not an invented name.
 * Usage: node src/scripts/backfillLtUserRentals.js (dry run) | --apply
 */
const path = require('path');
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const S = (v) => (v == null ? '' : String(v).trim());
const PLACEHOLDER = 'يُستكمل';

async function main() {
  if (!APPLY) { mongoose.set('autoIndex', false); mongoose.set('autoCreate', false); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, ...(APPLY ? {} : { autoIndex: false, autoCreate: false }) });
  require('../models/Employee');
  const { LightTransportEmployee } = require('../models/LightTransport');
  const LtUserRental = require('../models/LtUserRental');
  const { todayKey } = require('../utils/companyDay');

  const users = await LightTransportEmployee.find({ isActive: { $ne: false }, contractTypeAr: /يوزر/ })
    .select('name idNumber projectAr hireDate createdAt').sort({ projectAr: 1, name: 1 }).lean();
  const linked = new Set((await LtUserRental.find({ ltEmployee: { $in: users.map((u) => u._id) } }).distinct('ltEmployee')).map(String));
  const todo = users.filter((u) => !linked.has(String(u._id)));

  console.log(APPLY ? '[APPLY] تُنشأ التأجيرات' : '[DRY-RUN] عرضٌ فقط — لا يُكتب شيء (أضِف --apply)');
  console.log(`صفوف «يوزرات» النشطة: ${users.length} · مربوطةٌ بتأجير: ${users.length - todo.length} · يُنشأ لها: ${todo.length}`);
  for (const u of todo) {
    const start = u.hireDate ? new Date(u.hireDate).toISOString().slice(0, 10) : todayKey();
    console.log(`   ${S(u.projectAr) || '(غير محدد)'} · ${u.name} · ${u.idNumber} · من ${start}`);
    if (!APPLY) continue;
    await LtUserRental.create({
      ltEmployee: u._id, projectAr: S(u.projectAr) || '(غير محدد)', renterType: 'person', renterName: PLACEHOLDER,
      idNumber: S(u.idNumber), userAccount: S(u.name), notes: 'بيانات أولية — تُستكمل',
      startDate: start, status: 'active', prevContractTypeAr: '', createdByName: 'النظام',
    });
  }
  if (APPLY && todo.length) require('../utils/ltRental').announce();
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
