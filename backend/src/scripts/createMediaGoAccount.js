/**
 * createMediaGoAccount — حسابُ Media Go: يرى «شكاوى Media Go» وحدَها.
 *
 *   node src/scripts/createMediaGoAccount.js --password <كلمة المرور>            معاينة (لا يكتب شيئًا)
 *   node src/scripts/createMediaGoAccount.js --password <كلمة المرور> --apply    يُنشئ الحساب
 *
 * خيارات:
 *   --email <بريد>      الافتراضيّ mediago@energize-logistics.com (هو اسمُ الدخول)
 *   --first <اسم>       الافتراضيّ «Media Go»
 *   --last <اسم>        الافتراضيّ «Account Manager»
 *   --uri <mongodb uri> بدلَ MONGODB_URI من .env (للتجربة على قاعدةٍ محلّيّة)
 *
 * كلمةُ المرور لا تُكتب في الملفّ: تُمرَّر وقتَ التشغيل (ثمانيةُ أحرفٍ على الأقلّ
 * — حدُّ نموذج المستخدم). وإن وُجد الحسابُ مسبقًا فـ`--apply` يعيده إلى الدور
 * ويفعّله ويضع كلمةَ المرور الجديدة؛ والمعاينةُ تقول ذلك قبل أن يحدث.
 *
 * الدورُ `mediago_account` محصورٌ في الخادم (config/scopedRoles): لا يصل إلّا
 * نقاطَ تلك الشاشة، فلا حاجةَ إلى ضبطٍ في صفحة الصلاحيّات.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const APPLY = process.argv.includes('--apply');

(async () => {
  const { MEDIAGO_ROLE, MEDIAGO_PAGE } = require('../config/scopedRoles');
  const email = String(arg('email', 'mediago@energize-logistics.com')).trim().toLowerCase();
  const password = arg('password');
  const firstName = arg('first', 'Media Go');
  const lastName = arg('last', 'Account Manager');
  const uri = arg('uri', process.env.MONGODB_URI);

  if (!password) {
    console.error('✗ مرّر كلمة المرور: --password <كلمة المرور>  (لا تُكتب في الملف)');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('✗ كلمة المرور ثمانية أحرف على الأقلّ (حدّ نموذج المستخدم).');
    process.exit(1);
  }
  if (!uri) { console.error('✗ لا MONGODB_URI ولا --uri'); process.exit(1); }

  await mongoose.connect(uri);
  const User = require('../models/User');
  const host = (() => { try { return new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).host; } catch (_) { return '?'; } })();

  console.log(`\nقاعدة البيانات: ${host}`);
  console.log(`الوضع: ${APPLY ? 'تنفيذ (--apply)' : 'معاينة — لن يُكتب شيء'}\n`);

  const existing = await User.findOne({ email }).select('+password');
  if (existing) {
    console.log(`الحساب موجود: ${existing.email} — الدور الحالي «${existing.role}»، ${existing.isActive ? 'مفعّل' : 'معطّل'}`);
    console.log(`  سيُضبط: الدور → ${MEDIAGO_ROLE}، مفعّل، كلمة مرور جديدة`);
    if (APPLY) {
      existing.role = MEDIAGO_ROLE;
      existing.isActive = true;
      existing.isLocked = false;
      existing.password = password;
      existing.accountType = 'employee';
      await existing.save();
      console.log('✓ حُدِّث الحساب');
    }
  } else {
    console.log('سيُنشأ حساب:');
    console.log(`  البريد (اسم الدخول): ${email}`);
    console.log(`  الاسم: ${firstName} ${lastName}`);
    console.log(`  الدور: ${MEDIAGO_ROLE} — مدير حساب Media Go`);
    console.log(`  صفحته الوحيدة: ${MEDIAGO_PAGE}`);
    console.log(`  كلمة المرور: ${'•'.repeat(password.length)} (${password.length} أحرف)`);
    // يُتحقَّق قبل الكتابة — دورٌ لا يعرفه هذا الإصدارُ يُرفَض هنا لا عند الدخول.
    const probe = new User({ email, password, firstName, lastName, role: MEDIAGO_ROLE, isActive: true });
    await probe.validate();
    console.log('  ✓ يجتاز تحقّق نموذج المستخدم');
    if (APPLY) {
      await probe.save();
      console.log(`✓ أُنشئ الحساب (${probe._id})`);
    }
  }
  if (!APPLY) console.log('\nللتنفيذ أضِف --apply');
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error('✗', e.message);
  try { await mongoose.disconnect(); } catch (_) { /* */ }
  process.exit(1);
});
