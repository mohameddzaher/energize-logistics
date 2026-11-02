/**
 * backfillContractStatus: contract status for terminated employees that lack one.
 * Usage: node src/scripts/backfillContractStatus.js --dry | --apply
 * Why empty: contractStatusText was filled only by the import; terminating from the screen did not write it, so terminated employees kept an empty column, which the "not on the job" list reads to tell a terminated contract from an active one. Termination now writes it (see terminateEmployee), so this only covers the past.
 * Only empty values are written: an existing status, even "active" on a terminated employee, may be correct (contract not yet cancelled) or an error to review, and either is a human decision. Those are printed.
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

  // Only terminated staff get "contract terminated". Someone on leave does not have an ended contract: leave them and report, since writing termination would flip the meaning.
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
    try { require('../controllers/hrController'); } catch (_) { /* Invalidate the cache on first read */ }
  } else if (!APPLY) {
    console.log('\n  لم يُكتب شيء. أضف --apply للتنفيذ.');
  }
  console.log('');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
