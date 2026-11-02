/* eslint-disable no-console */
/**
 * Separates under-renewal from at-factory and makes grade a description again.
 * Usage: node src/scripts/migrateTireStates.js --dry | --yes
 * Place was on two axes (status in_repair and grade at_factory) describing one position, shown as at the factory though the tire was in the workshop's custody awaiting renewal. So those tires move to under_renewal, at-factory is emptied to restart with its true meaning, and grade returns to new or used.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  // Read through the driver: the model is now a new enum and old values would not pass it.
  const col = mongoose.connection.collection('ls2tireassets');

  const inRepair = await col.countDocuments({ status: 'in_repair' });
  const gradeAtFactory = await col.countDocuments({ condition: 'at_factory' });
  const retired = await col.countDocuments({ status: 'retired' });

  console.log('\n  الحالة الآن:');
  console.log(`    status = in_repair       : ${inRepair}  → تصير under_renewal (تحت التجديد)`);
  console.log(`    condition = at_factory   : ${gradeAtFactory}  → تصير used (الدرجة وصفٌ لا مكان)`);
  console.log(`    status = retired (موروث) : ${retired}  → تُترك كما هي، وتُقرأ سكرابًا`);
  console.log('    status = at_factory      : 0  → الخانة تبدأ فارغةً بمعناها الصحيح');

  if (DRY || !YES) { console.log(`\n  ${DRY ? '— تجربةٌ فقط.' : '— لم يُمرَّر --yes.'}\n`); process.exit(0); }

  const a = await col.updateMany({ status: 'in_repair' }, { $set: { status: 'under_renewal' } });
  const b = await col.updateMany({ condition: 'at_factory' }, { $set: { condition: 'used' } });
  console.log(`\n  ✓ ${a.modifiedCount} فردةً صارت «تحت التجديد» · ${b.modifiedCount} درجةً عادت «مستعملة».\n`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
