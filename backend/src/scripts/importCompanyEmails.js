/**
 * importCompanyEmails — تحميل قائمة بريد الشركة من data/masters/company_emails.json.
 *
 *   node src/scripts/importCompanyEmails.js            (تشغيل فعلي)
 *   node src/scripts/importCompanyEmails.js --dry      (عرض بس، من غير كتابة)
 *
 * idempotent: البريد هو المفتاح، فإعادة التشغيل بتحدّث ولا بتكرّر. وما بيمسّش
 * كلمة المرور إطلاقًا — الملف مفيهوش كلمات مرور أصلاً، وتقنية المعلومات هي اللي
 * بتضيفها من الصفحة، فأي تشغيل تاني للسكربت ما يضيّعش شغلهم.
 *
 * الربط بالموظف: الملف فيه `hr_match.employee_number` لـ 58 صف — بنستخدمه لأنه
 * رقم مطابقة صريح، مش تخمين من الاسم. الباقي بيتسجّل من غير ربط ويتربط يدويًا
 * من الصفحة بعدين.
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const CompanyEmail = require('../models/CompanyEmail');
  const Employee = require('../models/Employee');

  const file = path.join(__dirname, '..', 'data', 'masters', 'company_emails.json');
  const raw = require(file);
  const entries = raw.entries || [];
  console.log(`المصدر: ${entries.length} صف${DRY ? '  (تجربة — لن يُكتب شيء)' : ''}\n`);

  // رقم الموظف → _id، استعلام واحد بدل واحد لكل صف.
  const numbers = [...new Set(entries.map((e) => e.hr_match?.employee_number).filter(Boolean).map(String))];
  const emps = await Employee.find({ employeeNumber: { $in: numbers } })
    .select('employeeNumber firstName lastName arabicName department').lean();
  const byNumber = new Map(emps.map((e) => [String(e.employeeNumber), e]));
  console.log(`أرقام موظفين في الملف: ${numbers.length} · موجودة فعلاً في الموارد البشرية: ${byNumber.size}\n`);

  let created = 0; let updated = 0; let linked = 0; let skipped = 0;
  const problems = [];

  for (const row of entries) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email || !row.syntax_valid) { skipped++; problems.push(`صيغة غير صالحة: ${row.email || '(فارغ)'} (صف ${row.source_row})`); continue; }

    const emp = row.hr_match?.employee_number ? byNumber.get(String(row.hr_match.employee_number)) : null;
    const doc = {
      email,
      displayName: (row.display_name || '').trim(),
      mailboxType: row.mailbox_type === 'functional' ? 'functional' : 'personal',
      functionAr: (row.function_ar || '').trim(),
      status: 'active',
      employee: emp ? emp._id : null,
      employeeNumber: emp ? String(emp.employeeNumber || '') : (row.hr_match?.employee_number ? String(row.hr_match.employee_number) : ''),
      employeeName: emp ? (emp.arabicName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim()) : (row.hr_match?.full_name_ar || ''),
      department: emp ? (emp.department || '') : (row.hr_match?.department_ar || ''),
      createdByName: 'استيراد قائمة البريد',
    };
    if (emp) linked++;

    if (DRY) { created++; continue; }

    const existing = await CompanyEmail.findOne({ email });
    if (existing) {
      // لا نلمس كلمة المرور ولا سجل الكشف — ديه شغل تقنية المعلومات بعد الاستيراد.
      Object.assign(existing, { ...doc, createdByName: existing.createdByName || doc.createdByName });
      await existing.save();
      updated++;
    } else {
      await CompanyEmail.create(doc);
      created++;
    }
  }

  const total = DRY ? 0 : await CompanyEmail.countDocuments({});
  const withPw = DRY ? 0 : await CompanyEmail.countDocuments({ passwordEnc: { $nin: ['', null] } });

  console.log(`جديد: ${created} · محدَّث: ${updated} · مربوط بموظف: ${linked} · متخطّى: ${skipped}`);
  if (problems.length) { console.log('\nصفوف بها مشكلة:'); problems.forEach((p) => console.log('  · ' + p)); }
  if (!DRY) {
    console.log(`\nالإجمالي في السجل: ${total} · منها ${withPw} بكلمة مرور مسجّلة و${total - withPw} بدونها.`);
    const byDomain = await CompanyEmail.aggregate([{ $group: { _id: '$domain', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
    console.log('حسب الدومين: ' + byDomain.map((d) => `${d._id} (${d.n})`).join(' · '));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
