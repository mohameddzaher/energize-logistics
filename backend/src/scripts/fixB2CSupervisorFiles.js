/**
 * B2C supervisor files: fix the source of their Arabic names, read from the HR file linked via User.linkedEmployee.
 * Two accounts were linked to an empty shell row, so the register showed an English name.
 * Ahmed Younis is relinked to his real HR file; Ahmed Elsharqawy has no HR file, so the Arabic name is written on his linked row (HR still needs to open a file). Then the register name snapshot is rewritten.
 * Usage: node src/scripts/fixB2CSupervisorFiles.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const User = require(`${ROOT}/models/User`);
const Employee = require(`${ROOT}/models/Employee`);
const { LightTransportEmployee } = require(`${ROOT}/models/LightTransport`);
const { listSupervisors } = require(`${ROOT}/utils/b2cSupervisors`);

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Ahmed Younis: link to his real file
  const younis = await User.findOne({ email: 'ahmed.y@energize.com' }).select('firstName lastName linkedEmployee');
  const realYounis = await Employee.findOne({ employeeNumber: '1224' }).select('arabicName employeeNumber employmentStatus department').lean();
  if (younis && realYounis) {
    const cur = String(younis.linkedEmployee || '');
    console.log(`أحمد يونس: الربطُ الحاليُّ ${cur || '—'} → ${realYounis._id} («${realYounis.arabicName}» #${realYounis.employeeNumber} · ${realYounis.department} · ${realYounis.employmentStatus})`);
    if (APPLY && cur !== String(realYounis._id)) {
      younis.linkedEmployee = realYounis._id;
      await younis.save();
      console.log('  ✓ صُوِّب');
    }
  } else console.log('أحمد يونس: لم يُعثَر على الحساب أو على الملفّ #1224 — تُرك');

  // 2. Ahmed Elsharqawy: Arabic name on the row linked to his account
  const shark = await User.findOne({ email: 'ahmed.sh@energize.com' }).select('linkedEmployee').lean();
  if (shark?.linkedEmployee) {
    const emp = await Employee.findById(shark.linkedEmployee).select('arabicName firstName lastName employeeNumber employmentStatus');
    console.log(`أحمد الشرقاوي: ملفُّه ${emp._id} ar="${emp.arabicName || ''}" #${emp.employeeNumber || '—'} ${emp.employmentStatus} — لا ملفَّ حقيقيًّا له في الموارد البشريّة`);
    if (APPLY && !String(emp.arabicName || '').trim()) {
      emp.arabicName = 'أحمد الشرقاوي';
      await emp.save();
      console.log('  ✓ كُتب الاسمُ العربيّ (ويبقى الملفُّ نفسُه على الموارد البشريّة أن تفتحه)');
    }
  }

  // 3. name snapshot in register rows is rewritten from the account
  const sups = await listSupervisors();
  console.log('\n=== لقطاتُ الأسماء بعد التصويب:');
  let writes = 0;
  for (const s of sups) {
    const n = await LightTransportEmployee.countDocuments({ supervisorUser: s._id });
    if (!n) continue;
    console.log(`  ${s.nameEn.padEnd(22)} → «${s.name}» على ${n} صفًّا`);
    if (APPLY) {
      const r = await LightTransportEmployee.updateMany(
        { supervisorUser: s._id },
        { $set: { supervisorName: s.name, supervisor: s.employee || null } },
      );
      writes += r.modifiedCount ?? 0;
    }
  }
  console.log(APPLY ? `\nكُتب ${writes} صفًّا.` : '\n(عرضٌ فقط — أضِف --apply)');
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
