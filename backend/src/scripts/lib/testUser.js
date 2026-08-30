/**
 * مستخدمٌ اصطناعيّ لسكربتات الفحص.
 *
 * ── لماذا لا يُؤخذ حسابٌ حقيقيّ ─────────────────────────────────────────────
 * كانت السكربتاتُ تفعل `User.findOne({ role: 'super_admin' })` لتملأ `req.user`
 * الذي يحتاجه المتحكّم. والنتيجةُ أنّ كلَّ ما يفعله السكربتُ يُقيَّد في سجلّ
 * المراجعة باسم ذلك الإنسان: مئتان واثنان من إنشاء حساباتِ اختبارٍ وحذفِها
 * نُسبت إلى موظّفةٍ لم تفتح الشاشة، فسأل صاحبُ الشركة عنها بحقّ.
 *
 * فهذا مستخدمٌ لا وجودَ له في القاعدة: له معرّفٌ صالحٌ يرضي `populate`، ودورٌ
 * يُمرّره من الحرّاس، ولا سجلَّ يُنسب إليه. ومعه `AUDIT_SUPPRESS` فلا يُكتب
 * قيدُ مراجعةٍ أصلًا.
 */
const mongoose = require('mongoose');

process.env.AUDIT_SUPPRESS = '1';

const testUser = (role = 'super_admin', extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  firstName: 'فحص',
  lastName: 'آليّ',
  email: `zz-harness-${role}@example.invalid`,
  role,
  isActive: true,
  ...extra,
});

module.exports = { testUser };
