/**
 * auditBusinessReviewVisibility: is the business review section visible to every user, and what exactly does each see?
 * node src/scripts/auditBusinessReviewVisibility.js
 * Runs against the database itself (not HTTP) to cover every role in the User enum and every real existing user, not a sample. Prints a matrix per role:
 * - is the section visible in the sidebar (effectivePermissions)   - which links it sees (same isBrRunner/isBrParticipant rule as the UI)   - is a saved override from the permissions page locking it Throws if any role is locked out, since the requirement is that the section reaches all employees, each within his limits. Strictly read-only: writes nothing.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const GREEN = '\x1b[32m'; const RED = '\x1b[31m'; const DIM = '\x1b[2m'; const OFF = '\x1b[0m';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/User');
  const RolePermission = require('../models/RolePermission');
  const { effectivePermissions } = require('../utils/permissions');
  const brCfg = require('../config/businessReview');

  const SECTION = 'Business Review';

  // Same rules the UI uses to decide links (frontend/src/lib/businessReview.ts).
  const isRunner = (role) => brCfg.isExecutive({ role }) || brCfg.isSecretary({ role });
  const isParticipant = (role) => brCfg.isParticipant({ role });

  const linksFor = (role, access) => {
    if (access === 'none') return [];
    const links = [];
    if (isParticipant(role)) links.push('اجتماعات المراجعة');
    if (isRunner(role)) links.push('سجل البنود');
    if (isParticipant(role)) links.push('البنود المسندة إليّ');
    links.push('مهامي من الاجتماعات'); // Each employee sees his own work.
    return links;
  };

  const roles = require('../config/roles').ALL_ROLES;
  const overrides = new Map((await RolePermission.find({}).lean())
    .map((d) => [d.role, d.sections ? Object.fromEntries(Object.entries(d.sections)) : {}]));
  const counts = Object.fromEntries((await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]))
    .map((c) => [c._id, c.n]));

  console.log(`\n${'الدور'.padEnd(24)}${'مستخدمين'.padStart(8)}  ${'الوصول'.padEnd(8)} الروابط اللي بيشوفها`);
  console.log('─'.repeat(100));

  const blocked = [];
  for (const role of roles) {
    const perms = await effectivePermissions(role);
    const access = perms[SECTION] || 'none';
    const links = linksFor(role, access);
    const n = counts[role] || 0;
    const bad = role !== 'client' && (access === 'none' || !links.length);
    if (bad) blocked.push(role);
    const mark = role === 'client' ? `${DIM}—${OFF}` : (bad ? `${RED}✗${OFF}` : `${GREEN}✓${OFF}`);
    console.log(
      `${mark} ${role.padEnd(22)}${String(n).padStart(8)}  ${access.padEnd(8)} ${links.join(' · ') || (role === 'client' ? DIM + 'شريك خارجي — خارج القسم عمدًا' + OFF : RED + 'لا شيء' + OFF)}`
    );
  }

  // Real users.
  console.log(`\n${'─'.repeat(100)}\nالمستخدمون الحقيقيون على هذه القاعدة:\n`);
  const users = await User.find({ isActive: { $ne: false } }).select('firstName lastName email role').sort({ role: 1 }).lean();
  const byTier = { board: [], secretariat: [], managers: [], staff: [], partners: [] };
  for (const u of users) {
    const tier = u.role === 'client' ? 'partners'
      : brCfg.isExecutive({ role: u.role }) ? 'board'
        : brCfg.isSecretary({ role: u.role }) ? 'secretariat'
          : isParticipant(u.role) ? 'managers' : 'staff';
    byTier[tier].push(`${(u.firstName || '') + ' ' + (u.lastName || '')}`.trim() + ` ${DIM}(${u.role})${OFF}`);
  }
  const label = {
    board: 'الإدارة العليا — تشوف كل الاجتماعات وكل البنود',
    secretariat: 'الشؤون الإدارية — تدير الاجتماعات وتكتب المحاضر',
    managers: 'مديرو الأقسام — اجتماعاتهم اللي حضروها + بنودهم',
    staff: 'الموظفون — التكليفات المسندة إليهم فقط',
    partners: 'شركاء خارجيون — خارج القسم عمدًا',
  };
  for (const k of ['board', 'secretariat', 'managers', 'staff', 'partners']) {
    console.log(`  ${label[k]}  ${DIM}(${byTier[k].length})${OFF}`);
    byTier[k].forEach((n) => console.log(`      · ${n}`));
    if (!byTier[k].length) console.log(`      ${DIM}(لا أحد)${OFF}`);
    console.log('');
  }

  console.log('─'.repeat(100));
  if (blocked.length) {
    console.log(`${RED}✗ أدوار مقفول عليها القسم: ${blocked.join(', ')}${OFF}`);
    console.log('  المفروض كل دور (غير client) يوصل للقسم — راجع صفحة الصلاحيات.');
    process.exit(1);
  }
  console.log(`${GREEN}✓ كل الأدوار (${roles.length - 1} عدا client) القسم واصل لها، وكل واحد بحدّه.${OFF}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
