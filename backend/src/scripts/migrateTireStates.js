/* eslint-disable no-console */
/**
 * migrateTireStates — يفصل «تحت التجديد» عن «في المصنع» ويُعيد الدرجة وصفًا.
 *
 *   node src/scripts/migrateTireStates.js --dry
 *   node src/scripts/migrateTireStates.js --yes
 *
 * كان المكان على محورين: الحالة `in_repair` والدرجة `at_factory` تصفان موضعًا
 * واحدًا، وكانت الشاشة تسمّيه «في المصنع» — وهو في الحقيقة «تحت التجديد»:
 * الفردة نزلت وتقرّر تجديدها وهي في عهدة الورشة، لم تخرج إلى المصنع بعد.
 *
 * فتُنقل الستّ والثلاثون إلى `under_renewal` باسمها الصحيح، وتُفرَّغ خانة
 * «في المصنع» لتبدأ من الصفر بمعناها الحقيقيّ. والدرجة تعود وصفًا للفردة:
 * جديدةٌ أو مستعملة، لا ثالث.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const YES = process.argv.includes('--yes');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  // يُقرأ بالسائق مباشرةً: النموذج صار enum جديدًا، فالقيم القديمة لا تمرّ منه.
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
