/**
 * unmakeLoginEmployees — حساباتُ دخولٍ صارت موظّفين، وليست كذلك.
 *
 *   node src/scripts/unmakeLoginEmployees.js            تجربة
 *   node src/scripts/unmakeLoginEmployees.js --yes      تنفيذ
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * إنشاءُ حسابِ دخولٍ يُنشئ معه ملفَّ خدمةٍ ذاتيّةٍ ليطلب صاحبُه إجازةً ويرى ملفَّه
 * (`utils/ensureSelfEmployee`) — وهو مُعلَّمٌ `isHrRecord: false` فلا يُعَدُّ
 * موظّفًا ولا يظهر في قائمةٍ. هذا صحيح.
 *
 * والخطأ أنّ سجلَّين من هذه الظلال حملا العَلَمَ `true`، فظهرا في الموارد
 * البشريّة موظّفَين كاملَين بأرقامٍ وظيفيّةٍ وأقسامٍ ومهن — وليسا في ماستر
 * الموظّفين (`inCurrentMaster: false`)، أي أنّ الموارد البشريّة لم تسجّلهما قطّ.
 * وصاحبُ الشركة عرفهما فورًا: «مش موظفين حقيقيين».
 *
 * ── ولماذا لا يُحذَف الصفّ ─────────────────────────────────────────────────
 * لأنّ حسابَ الدخول قائمٌ ويعمل، وملفُّ الخدمة الذاتيّة هو ما يجعل صاحبَه يطلب
 * إجازةً ويوقّع. فيُعاد العَلَمُ إلى `false`: يخرج من كلّ قائمةٍ وعدّادٍ في
 * الموارد البشريّة، ويبقى دخولُه وخدمتُه الذاتيّةُ كما هي.
 *
 * والقاعدةُ التي تُميّزه: ليس في الماستر، وله حسابُ دخول، ولم تُدخِله الموارد
 * البشريّة من شاشتها. ورقمُه الوظيفيُّ وحدَه ليس دليلًا — وهذا بالضبط ما ضلّل
 * `repairEmployeeVisibility` فأعادهما إلى الظهور.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const YES = process.argv.includes('--yes');
const NUMBERS = process.argv.includes('--numbers')
  ? process.argv[process.argv.indexOf('--numbers') + 1].split(',')
  : ['EMP-0434', 'EMP-0419'];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Employee = require('../models/Employee');
  const User = require('../models/User');

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  const rows = await Employee.find({ employeeNumber: { $in: NUMBERS } }).lean();
  if (!rows.length) { console.log('لا سجلّات مطابقة.'); await mongoose.disconnect(); return; }

  for (const e of rows) {
    const u = e.user ? await User.findById(e.user).select('email role').lean() : null;
    const name = (e.arabicName || `${e.firstName || ''} ${e.lastName || ''}`).trim();
    console.log(`${e.employeeNumber} · ${name}`);
    console.log(`   في الماستر: ${e.inCurrentMaster ? 'نعم' : 'لا'} · القسم: ${e.department || '—'} · الحالة: ${e.employmentStatus}`);
    console.log(`   حسابُ الدخول: ${u ? `${u.email} (${u.role}) — يبقى كما هو` : 'لا يوجد'}`);
    // ── ولا يُلمَس سجلٌّ في الماستر ──────────────────────────────────────────
    // الماستر هو مصدرُ الموظّفين. ومن كان فيه فهو موظّفٌ مهما بدا غيرَ ذلك.
    if (e.inCurrentMaster) console.log('   ⚠︎ هذا في الماستر — لن يُمسّ.');
  }

  const targets = rows.filter((e) => !e.inCurrentMaster);
  console.log(`\nيُخرَج من الموارد البشريّة: ${targets.length} من ${rows.length}`);
  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  const r = await Employee.updateMany(
    { _id: { $in: targets.map((e) => e._id) } },
    { $set: { isHrRecord: false, inCurrentMaster: false } },
  );
  console.log(`✓ أُخرج ${r.modifiedCount} سجلًّا — الحساباتُ تعمل كما هي`);
  console.log(`الموظّفون الظاهرون الآن: ${await Employee.countDocuments({ isHrRecord: { $ne: false } })}`);
  await mongoose.disconnect();
})();
