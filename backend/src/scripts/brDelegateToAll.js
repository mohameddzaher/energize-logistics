/**
 * Delegates one account in business review by every section head at once (the same grant each manager would give from
 * «تفويض الفريق»). Dry run by default; --apply writes. Pick the account with --email=… or --user=<id>.
 *   node src/scripts/brDelegateToAll.js --email=someone@example.com [--apply]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

(async () => {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');
  const { isManagerRole, canRunMeetings } = require('../config/businessReview');
  const { sectionsOfUserIds } = require('../utils/userSection');
  const { orgSectionOfRole } = require('../config/roles');
  const target = arg('user') ? await User.findById(arg('user')).lean() : await User.findOne({ email: arg('email').toLowerCase() }).lean();
  if (!target) { console.error('account not found'); process.exit(1); }
  console.log(`account: ${target.firstName} ${target.lastName} <${target.email}> role=${target.role}`);

  const heads = (await User.find({ isActive: { $ne: false }, _id: { $ne: target._id } }).select('firstName lastName role email').lean())
    .filter((u) => isManagerRole(u.role) && !canRunMeetings(u));
  const secs = await sectionsOfUserIds(heads.map((u) => u._id));
  const { setDelegation } = require('../controllers/brDelegationController');
  for (const m of heads) {
    const sec = secs.get(String(m._id)) || orgSectionOfRole(m.role) || '—';
    if (!apply) { console.log(`would delegate by ${m.firstName} ${m.lastName} (${m.role}, ${sec})`); continue; }
    // eslint-disable-next-line no-await-in-loop
    const r = await setDelegation(m, target._id, true);
    console.log(`${r.status ? `REFUSED ${r.status} ${r.message}` : r.changed ? 'delegated' : 'already'} by ${m.firstName} ${m.lastName} (${m.role}, ${sec})`);
  }
  const after = await User.findById(target._id).select('brActsFor').lean();
  console.log(`acts for ${(after.brActsFor || []).length} managers${apply ? '' : ' (dry run, nothing written)'}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
