/**
 * createCollectionsUsers — حسابا قسم التحصيل: مديرُه وموظّفُه.
 *
 *   node src/scripts/createCollectionsUsers.js
 *
 * يُعاد تشغيلُه بلا ضرر: الحسابُ القائمُ يُحدَّث دورُه ولا تُمَسّ كلمةُ مروره،
 * فلا يُطرد من النظام مَن غيّر كلمتَه بعد إنشائه.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const USERS = [
  {
    email: 'hatim.mohamed@energize-logistics.com',
    password: 'Passenergize1!',
    firstName: 'حاتم',
    lastName: 'محمد',
    role: 'collections_manager',
  },
  {
    email: 'collections.officer@energize-logistics.com',
    password: 'Passenergize1!',
    firstName: 'موظف',
    lastName: 'التحصيل',
    role: 'collections_staff',
  },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const u of USERS) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      const before = existing.role;
      existing.role = u.role;
      existing.isActive = true;
      // كلمةُ المرور لا تُعاد: مَن غيّرها بعد الإنشاء يفقد حسابَه لو أُعيدت.
      await existing.save();
      console.log(`↻ ${u.email} — كان «${before}» فصار «${u.role}»`);
      continue;
    }
    const created = await User.create({ ...u, isActive: true });
    console.log(`✓ ${created.email} — ${created.role}`);
  }

  const all = await User.find({ role: { $in: ['collections_manager', 'collections_staff'] } })
    .select('email firstName lastName role isActive').lean();
  console.log('\nحسابات قسم التحصيل:');
  for (const a of all) console.log(`  ${a.role.padEnd(20)} ${a.email}  (${a.firstName} ${a.lastName})${a.isActive ? '' : ' — معطَّل'}`);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
