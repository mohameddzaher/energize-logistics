/**
 * reconcileHrMaster — مطابقة سجل الموظفين مع الماستر النهائي.
 *
 *   node src/scripts/reconcileHrMaster.js --dry
 *   node src/scripts/reconcileHrMaster.js
 *
 * الماستر (data/masters/hr_master_final.json) هو **قائمة الموظفين الحقيقية**.
 * اللي مش فيه مش موظف حالي.
 *
 * ── الترتيب مهم ─────────────────────────────────────────────────────────────
 * الملف نفسه فيه `cross_references.previous_master_file.dropped_since_previous`
 * — قائمة **مَن خرج**، مكتوبة صراحةً. دي المرجع، مش الاستنتاج.
 *
 * والمطابقة بتتم **برقم الهوية**، مش بالرقم الوظيفي: الأرقام الوظيفية بتتعاد
 * تدويرها. أسماء جميل خرجت ورقمها ١٢٢٥ اتدّى لإبراهيم، فمطابقة بالرقم كانت
 * بتقول إنها لسه موجودة وهي مشيت — وده اللي حصل فعلاً قبل الإصلاح ده.
 *
 * ── تلات فئات، وكل واحدة ليها تصرّف مختلف ───────────────────────────────────
 *
 * ١) سجلات اتعملت تلقائيًا مع حسابات الدخول (لا رقم وظيفي ولا رقم هوية).
 *    دي **مش موظفين** — يوزر على السيستم مش معناه موظف. بتتعلّم `isHrRecord:
 *    false` فتخرج من عدّادات الموارد البشرية، وبتفضل موجودة عشان الحساب اللي
 *    مربوط بيها يفضل شغّال.
 *
 * ٢) موظف بيطابق بالاسم بس رقمه مختلف — بيتحدَّث من الماستر (الماستر هو
 *    المرجع)، وبيتطبع عشان عين بشرية تشوفه. فرق رقم واحد في الهوية ممكن يكون
 *    غلطة كتابة وممكن يكون شخصين، والفرق ده مش قرار سكربت.
 *
 * ٣) موظف حقيقي مش في الماستر → **منتهية خدمته**، مش محذوف. عنده تفاويض مركبات
 *    وحسابات دخول بتشاور عليه؛ المسح بيكسرها والرجوع بيبقى مستحيل. الإنهاء
 *    بيشيله من الأرقام وبيسيب التاريخ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const AR = '٠١٢٣٤٥٦٧٨٩';
const digits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[^0-9]/g, '');
const nz = (s) => digits(s).replace(/^0+/, '');
const nameKey = (s) => String(s || '').replace(/[\s‎‏؜]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const Employee = require('../models/Employee');
  const src = require('../data/masters/hr_master_final.json');

  const mNums = new Set(src.employees.map((e) => nz(e.employee_number)).filter(Boolean));
  const mIds = new Set(src.employees.map((e) => nz(e.identity?.id_number)).filter(Boolean));
  // قائمة الخارجين الرسمية — بالهوية، لأن الرقم الوظيفي بيتعاد استخدامه.
  const droppedIds = new Set((src.cross_references?.previous_master_file?.dropped_since_previous || [])
    .map((x) => nz(x.id_number)).filter(Boolean));
  const mNames = new Map(src.employees.map((e) => [nameKey(e.identity?.full_name), e]).filter((x) => x[0]));

  const all = await Employee.find({})
    .select('_id employeeNumber iqamaNumber nationalId arabicName firstName lastName user employmentStatus department project isHrRecord')
    .lean();

  const stubs = []; const renumbered = []; const gone = []; const dropped = [];
  for (const x of all) {
    // الخارجون أولًا: الملف قال عليهم صراحةً، فما ينفعش أي مطابقة تانية تنقذهم.
    // لو مشينا بالرقم الوظيفي الأول كان اللي رقمه اتعاد استخدامه هيفضل «موجود».
    if (droppedIds.has(nz(x.iqamaNumber))) { dropped.push(x); continue; }
    if (mIds.has(nz(x.iqamaNumber)) || mIds.has(nz(x.nationalId))) continue;
    if (mNums.has(nz(x.employeeNumber))) continue;
    if (!digits(x.employeeNumber) && !digits(x.iqamaNumber)) { stubs.push(x); continue; }
    const row = mNames.get(nameKey(x.arabicName)) || mNames.get(nameKey(`${x.firstName || ''} ${x.lastName || ''}`));
    // مطابقة بالاسم مقبولة بس لو الاسم كامل (أكتر من كلمتين) — «MUHAMMAD»
    // لوحده بيطابق نص الشركة.
    const fullEnough = (x.arabicName || '').trim().split(/\s+/).length >= 3;
    if (row && fullEnough) { renumbered.push({ emp: x, row }); continue; }
    gone.push(x);
  }

  console.log(`إجمالي السجلات: ${all.length} · في الماستر: ${all.length - stubs.length - renumbered.length - gone.length}${DRY ? '   (تجربة)' : ''}\n`);

  console.log(`⓪ في قائمة الخارجين الرسمية (dropped_since_previous): ${dropped.length}`);
  dropped.forEach((x) => console.log(`     ${(x.arabicName || `${x.firstName} ${x.lastName}`).slice(0, 34).padEnd(36)}#${x.employeeNumber || '—'}`));
  if (!DRY && dropped.length) {
    await Employee.updateMany({ _id: { $in: dropped.map((x) => x._id) } },
      { $set: { employmentStatus: 'terminated', isHrRecord: true, terminationReason: 'خارج حسب قائمة الماستر الرسمية (dropped_since_previous)' } });
  }

  console.log(`\n① سجلات حسابات دخول — مش موظفين: ${stubs.length}`);
  stubs.forEach((s) => console.log(`     ${(s.arabicName || `${s.firstName} ${s.lastName}`).slice(0, 34)}`));
  if (!DRY && stubs.length) {
    await Employee.updateMany({ _id: { $in: stubs.map((s) => s._id) } }, { $set: { isHrRecord: false } });
  }

  console.log(`\n② رقمهم اتغيّر في الماستر — بيتحدّثوا منه: ${renumbered.length}`);
  for (const { emp, row } of renumbered) {
    // نعرض اللي هيحصل فعلاً: الماستر لو عنده قيمة، وإلا بنسيب اللي عندنا.
    const newNum = String(row.employee_number || emp.employeeNumber || '');
    const newId = String(row.identity?.id_number || emp.iqamaNumber || '');
    console.log(`     ${(emp.arabicName || '').slice(0, 30).padEnd(32)}#${emp.employeeNumber || '—'} → #${newNum || '—'}   ID ${emp.iqamaNumber || '—'} → ${newId || '—'}`);
    if (!DRY) {
      await Employee.updateOne({ _id: emp._id }, { $set: { employeeNumber: newNum, iqamaNumber: newId, isHrRecord: true } });
    }
  }

  console.log(`\n③ مش في الماستر ومش في قائمة الخارجين — **استنتاج** يحتاج تأكيد: ${gone.length}`);
  const byDept = {};
  gone.forEach((g) => { byDept[g.department || g.project || '—'] = (byDept[g.department || g.project || '—'] || 0) + 1; });
  console.log(`     حسب القسم: ${Object.entries(byDept).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  gone.forEach((g) => console.log(`     ${(g.arabicName || `${g.firstName} ${g.lastName}`).slice(0, 34).padEnd(36)}#${g.employeeNumber || '—'}`));
  if (!DRY && gone.length) {
    await Employee.updateMany(
      { _id: { $in: gone.map((g) => g._id) } },
      { $set: { employmentStatus: 'terminated', isHrRecord: true, terminationReason: 'غير موجود في الماستر النهائي (استنتاج — يحتاج تأكيد)' } },
    );
  }

  if (!DRY) {
    const active = await Employee.countDocuments({ isHrRecord: { $ne: false }, employmentStatus: 'active' });
    const hrRecords = await Employee.countDocuments({ isHrRecord: { $ne: false } });
    console.log(`\n✓ سجلات موارد بشرية: ${hrRecords} · على رأس العمل: ${active} · مستبعَد كحسابات دخول: ${stubs.length}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
