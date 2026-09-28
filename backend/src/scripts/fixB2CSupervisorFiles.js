/**
 * ملفّاتُ مشرفي قطاع الأفراد — تصحيحُ ما يُقرأ منه اسمُهم العربيّ.
 *
 * ── لماذا ─────────────────────────────────────────────────────────────────
 * الاسمُ العربيُّ للمشرف يُقرأ من ملفّه في الموارد البشريّة المربوط بحسابه
 * (`User.linkedEmployee`). وحسابان من التسعة كانا مربوطَين بـ**قوقعة**: صفٌّ
 * أُنشئ يومَ أُنشئ الحساب، بلا اسمٍ عربيٍّ ولا رقمٍ وظيفيّ، حالتُه «منتهي
 * الخدمة»، ولا شيءَ في النظام يشير إليه.
 *
 * فكان سجلُّ النقل الخفيف — وهو عربيٌّ — يعرض «Ahmed Younis» بعد الربط، بعد أن
 * كان يعرض «احمد يونس». والاسمُ لقطةٌ تُقرأ في الجداول والتصدير، فوجب أن يجيء
 * من ملفٍّ صحيح.
 *
 *   · أحمد يونس — له ملفٌّ حقيقيٌّ في الموارد البشريّة (#1224 «احمد محمد محمد
 *     يونس»، قسم ادارة B2C، على رأس العمل)، وصفوفُ السجلّ مربوطةٌ به أصلًا.
 *     فيُصوَّب ربطُ حسابه إليه — ويُصلح معه ملفَّه الشخصيَّ في «ملفي».
 *   · أحمد الشرقاوي — لا ملفَّ له في الموارد البشريّة (الشرقاويُّ الموجود هو
 *     «فايز عبدالهادي عبدالفتاح الشرقاوي»، رجلٌ آخر). فيُكتب الاسمُ العربيُّ
 *     على الصفّ المربوط بحسابه كي تُقرأ الشاشاتُ بالعربيّة — ويبقى أنّ الموارد
 *     البشريّة تحتاج أن تفتح له ملفًّا حقيقيًّا.
 *
 * ثمّ تُعاد كتابةُ لقطةِ الاسم في صفوف السجلّ من الحساب المصحَّح.
 *
 * الاستعمال:  node src/scripts/fixB2CSupervisorFiles.js [--apply]
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

  // ١. أحمد يونس → ملفُّه الحقيقيّ
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

  // ٢. أحمد الشرقاوي → اسمٌ عربيٌّ على الصفّ المربوط بحسابه
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

  // ٣. لقطةُ الاسم في صفوف السجلّ تُعاد من الحساب
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
