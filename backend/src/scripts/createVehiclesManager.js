/* eslint-disable no-console */
/**
 * createVehiclesManager — حساب مسؤول قسم المركبات والتفاويض.
 *
 *   node src/scripts/createVehiclesManager.js --dry
 *   node src/scripts/createVehiclesManager.js --yes
 *
 * الدور `vehicles_manager` معرّف أصلاً في config/roles.js (ومنه بيتولد enum
 * الموديل وقايمة الاختيار في صفحة المستخدمين). السكربت ده بيعمل الحساب وبس —
 * ما بيضيفش دور جديد.
 *
 * idempotent: لو الحساب موجود بيحدّث اسمه ودوره ويعيد تعيين كلمة السر، مش
 * بيعمل حساب تاني بنفس الإيميل.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = !process.argv.includes('--yes');

const ACCOUNT = {
  email: 'mohamed.abdeulaal@energize.com',
  password: 'Mohamedenergize',
  firstName: 'Mohamed',
  lastName: 'Abdulaal',
  role: 'vehicles_manager',
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const R = require('../config/roles');

  // الدور لازم يكون معروف قبل أي حاجة — لو اتغيّر اسمه، نقف هنا مش بعد الحفظ.
  if (!R.ALL_ROLES.includes(ACCOUNT.role)) {
    console.error(`الدور ${ACCOUNT.role} مش موجود في config/roles.js`);
    process.exit(1);
  }
  console.log(`الدور: ${ACCOUNT.role} — ${R.LABELS_AR[ACCOUNT.role]} / ${R.LABELS_EN[ACCOUNT.role]}`);
  console.log(`أدوار قسم المركبات: ${R.rolesOfSection('Vehicles').join(' · ')}\n`);

  const existing = await User.findOne({ email: ACCOUNT.email });
  console.log(existing ? `الحساب موجود (${existing.role}) — هيتحدّث` : 'حساب جديد');
  console.log(`   ${ACCOUNT.firstName} ${ACCOUNT.lastName}  ·  ${ACCOUNT.email}  ·  ${ACCOUNT.role}`);

  if (DRY) { console.log('\n(تجربة) — للتنفيذ: --yes'); process.exit(0); }

  let user;
  if (existing) {
    // كلمة السر بتتحطّ على المستند وتتحفظ بـ save() عشان الـ pre-save hook
    // بتاع التشفير يشتغل. updateOne كان هيخزّنها نص صريح.
    existing.set({ ...ACCOUNT, isActive: true, isLocked: false });
    await existing.save();
    user = existing;
  } else {
    user = await User.create({ ...ACCOUNT, isActive: true });
  }

  const check = await User.findById(user._id).select('+password').lean();
  console.log(`\n✓ ${check.firstName} ${check.lastName}`);
  console.log(`   الإيميل:  ${check.email}`);
  console.log(`   الدور:    ${check.role} — ${R.LABELS_AR[check.role]}`);
  console.log(`   نشط:      ${check.isActive}`);
  console.log(`   كلمة السر متشفّرة: ${String(check.password || '').startsWith('$2') ? 'أيوه' : '✗ لأ — مشكلة'}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
