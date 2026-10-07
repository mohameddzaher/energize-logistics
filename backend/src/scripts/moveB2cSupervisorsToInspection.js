/**
 * نقلُ مشرفي المناديب القائمين إلى الدور التفقّديّ.
 *
 * ── لماذا نقلٌ لا إنشاءٌ من جديد ────────────────────────────────────────────
 * كان في القسم دورُ إشرافٍ واحد (`b2c_rep_supervisor`) يجمع عملين لا يتقاطعان:
 * يومَ المندوب (الإدخالُ اليوميّ وأوامرُ التشغيل والعهدة) ولحظةَ بداية الدوام
 * (التفقّدُ بالكاميرا الحيّة). فصار دورين — راجع config/roles.js — و**من كان
 * مشرفًا اليوم هو مشرفُ تفقّد**: ذاك عملُه فعلًا، وشاشاتُه هي التي كانت
 * مفتوحةً له وحدَها قبل الفصل.
 *
 * والحسابُ لا يُحذَف ولا يُعاد إنشاؤه: يُغيَّر دورُه فحسب، فيبقى اسمُه وكلمتُه
 * وما أُسنِد إليه من مناديب (`B2CRep.supervisor` يشير إلى المستخدم لا إلى
 * دوره) كما هو.
 *
 *   node src/scripts/moveB2cSupervisorsToInspection.js            عرضٌ فقط
 *   node src/scripts/moveB2cSupervisorsToInspection.js --apply
 *   node src/scripts/moveB2cSupervisorsToInspection.js --undo --apply
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const User = require(`${ROOT}/models/User`);
const { REP_SUPERVISOR, INSPECTION_SUPERVISOR } = require(`${ROOT}/middleware/b2cGuards`);
const { invalidateUserCache } = require(`${ROOT}/middleware/auth`);
const logAudit = require(`${ROOT}/utils/auditLogger`);

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const FROM = UNDO ? INSPECTION_SUPERVISOR : REP_SUPERVISOR;
const TO = UNDO ? REP_SUPERVISOR : INSPECTION_SUPERVISOR;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({ role: FROM }).select('firstName lastName username email isActive').lean();
  const name = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || u.email;

  console.log(`\n${APPLY ? '⚙️  تطبيق' : '👁️  عرضٌ فقط'} — «${FROM}» ← «${TO}» · ${users.length} حساب\n`);
  users.forEach((u) => console.log(`   ${name(u).padEnd(26)} ${u.username || u.email}${u.isActive === false ? ' (معطّل)' : ''}`));
  if (!users.length) { console.log('   لا أحد.'); await mongoose.disconnect(); process.exit(0); }

  if (APPLY) {
    for (const u of users) {
      // eslint-disable-next-line no-await-in-loop
      await User.updateOne({ _id: u._id }, { $set: { role: TO } });
      invalidateUserCache(u._id);
      // eslint-disable-next-line no-await-in-loop
      await logAudit({
        action: 'update', entity: 'User', entityId: u._id,
        changes: { before: { role: FROM }, after: { role: TO } },
      }).catch(() => {});
    }
    const left = await User.countDocuments({ role: FROM });
    const now = await User.countDocuments({ role: TO });
    console.log(`\n✓ نُقل ${users.length} · بقي على «${FROM}»: ${left} · على «${TO}»: ${now}`);
    if (left !== 0) { console.log('✗ بقي من لم يُنقَل'); process.exitCode = 1; }
  } else {
    console.log('\nأعِدها مع --apply');
  }
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
