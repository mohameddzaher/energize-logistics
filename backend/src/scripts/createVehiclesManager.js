/* eslint-disable no-console */
/**
 * createVehiclesManager: account for the vehicles and authorizations manager.
 * The vehicles_manager role already exists in config/roles.js (it feeds the model enum and the users page picker); this script only creates the account.
 * Idempotent: an existing account gets its name and role updated and its password reset, never a duplicate email.
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

  // The role must be known first; if renamed, fail here rather than after saving.
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
    // Set the password on the document and use save() so the encryption pre-save hook runs; updateOne would store it as plain text.
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
