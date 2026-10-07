/**
 * إعادةُ اشتقاق `staffKind` لموظّفي النقل الخفيف.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كان النوعان `rep` و`admin` فقط، و«إداريّ» فرعَ الـelse. فمن لا وظيفةَ مكتوبةً
 * له صار إداريًّا، وقالت الشاشةُ «إداريّون وفنيّون: ٣٨» وفيها تسعةَ عشرَ بلا
 * وظيفة. صار `unknown` نوعًا ثالثًا، وهذا يُعيد الحسابَ لما سبق.
 *
 *   node src/scripts/recomputeLightTransportStaffKind.js          # معاينة
 *   node src/scripts/recomputeLightTransportStaffKind.js --write  # تنفيذ
 *
 * ولا يُكتَب إلّا ما تغيّر.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const REP_TITLES = ['مندوب', 'مندوب توصيل', 'rep', 'delivery rep'];
const DRIVER_TITLES = ['سائق', 'سايق', 'driver'];
const kindOf = (title) => {
  const j = String(title || '').trim().toLowerCase();
  if (!j) return 'unknown';
  if (REP_TITLES.some((t) => j === t.toLowerCase())) return 'rep';
  if (DRIVER_TITLES.some((t) => j === t.toLowerCase())) return 'driver';
  return 'admin';
};

(async () => {
  const WRITE = process.argv.includes('--write');
  await mongoose.connect(process.env.MONGODB_URI);
  require('../models/LightTransport');
  const M = mongoose.model('LightTransportEmployee');

  const rows = await M.find({}).select('nameAr name jobTitleAr staffKind').lean();
  const moves = {};
  const ops = [];
  for (const r of rows) {
    const next = kindOf(r.jobTitleAr);
    if (next === r.staffKind) continue;
    moves[`${r.staffKind || '—'} → ${next}`] = (moves[`${r.staffKind || '—'} → ${next}`] || 0) + 1;
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { staffKind: next } } } });
  }
  const after = {};
  for (const r of rows) { const k = kindOf(r.jobTitleAr); after[k] = (after[k] || 0) + 1; }

  console.log(`  الصفوف ....... ${rows.length}`);
  console.log(`  سيتغيّر ....... ${ops.length}`);
  for (const [m, n] of Object.entries(moves)) console.log(`     ${m}: ${n}`);
  console.log(`  بعد التنفيذ ... ${Object.entries(after).map(([k, n]) => `${k}=${n}`).join(' · ')}`);

  if (!WRITE) { console.log('\n  معاينةٌ فقط — أضِف --write للتنفيذ.'); await mongoose.disconnect(); return; }
  if (ops.length) {
    const r = await M.bulkWrite(ops, { ordered: false });
    console.log(`\n  كُتب: ${r.modifiedCount}`);
  }
  const check = await M.aggregate([{ $group: { _id: '$staffKind', n: { $sum: 1 } } }]);
  console.log('  القراءةُ بعد الكتابة: ' + check.map((c) => `${c._id}=${c.n}`).join(' · '));
  await mongoose.disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
