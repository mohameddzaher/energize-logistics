/**
 * Moves workshop users to Location Solutions (LS2).
 * The workshop section was removed because its work happens in LS2; three users kept a role with no definition, so they log in and see nothing (an unknown role reads as no permission). Level is preserved: manager stays manager, technician stays staff.
 * Usage: --yes to apply, otherwise a trial.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const YES = process.argv.includes('--yes');
const MAP = { workshop_manager: 'location_manager', workshop_employee: 'location_staff' };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const { ALL_ROLE_DEFS } = require('../config/roles');

  // Never write a nonexistent role: a typo would leave the user without permission as now, while appearing fixed.
  const known = new Set((ALL_ROLE_DEFS || []).map((r) => r.key));
  for (const to of Object.values(MAP)) {
    if (!known.has(to)) { console.error(`الدورُ «${to}» غيرُ معرَّف — أُوقف.`); process.exit(1); }
  }

  console.log(YES ? '── تنفيذ ──\n' : '── تجربة، بلا كتابة ──\n');
  const users = await User.find({ role: { $in: Object.keys(MAP) } })
    .select('firstName lastName email role').lean();

  if (!users.length) { console.log('لا مستخدمَ بدورِ ورشة.'); await mongoose.disconnect(); return; }

  for (const u of users) {
    const to = MAP[u.role];
    console.log(`  ${`${u.firstName || ''} ${u.lastName || ''}`.trim().padEnd(22)} ${u.email.padEnd(24)} ${u.role} → ${to}`);
    if (YES) await User.updateOne({ _id: u._id }, { $set: { role: to } });
  }

  if (!YES) { console.log('\n— تجربةٌ فقط. أضف --yes للتنفيذ.\n'); await mongoose.disconnect(); return; }

  // Role permissions are cached in both workers; invalidate them or one keeps reading the old role until expiry.
  try { require('../utils/ttlCache').clear('perm:'); } catch (_) {}
  console.log(`\n✓ نُقل ${users.length} مستخدمًا`);
  console.log('  (يلزمهم تسجيلُ خروجٍ ودخولٍ ليُقرأ الدورُ الجديد في المتصفّح)');
  await mongoose.disconnect();
})();
