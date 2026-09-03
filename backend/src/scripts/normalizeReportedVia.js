/**
 * normalizeReportedVia — «تم الإبلاغ عبر» صار قائمةً، فتُوحَّد قيمُه القديمة.
 *
 *   node src/scripts/normalizeReportedVia.js --dry
 *   node src/scripts/normalizeReportedVia.js
 *
 * كان الحقلُ خانةً حرّة: ستٌّ وعشرون واقعةً كُتب فيها «Najm» وإحدى وعشرون
 * «المرور». والجهةُ جهتان لا أكثرُ في السعوديّة كلِّها، فصارت قائمةً تُدار من
 * «إعدادات القسم ← القوائم المنسدلة» (`vehicle_reported_via`). وهذا يُلحق
 * المكتوبَ سلفًا بها، وإلّا فتحَ نموذجُ التعديل قائمةً لا تحوي قيمةَ الصفّ.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

// كلُّ ما رأيناه مكتوبًا، إلى الاسم الواحد الذي في القائمة.
const MAP = [
  [/^\s*(najm|nagm|نجم)\s*$/i, 'نجم'],
  [/^\s*(traffic|المرور|مرور|ادارة\s*المرور|إدارة\s*المرور)\s*$/i, 'المرور'],
];
const normalize = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  for (const [rx, out] of MAP) if (rx.test(s)) return out;
  return null;   // غيرُ معروف — يُترك ويُعرَض
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const VehicleClaim = require('../models/VehicleClaim');
  const rows = await VehicleClaim.find({}).select('_id accidentNumber reportedViaAr').lean();
  console.log(DRY ? '— تجربة، بلا كتابة —\n' : '');
  console.log(`الحوادث: ${rows.length}`);

  const ops = []; const unknown = []; let same = 0; let blank = 0;
  for (const r of rows) {
    const cur = String(r.reportedViaAr || '').trim();
    if (!cur) { blank += 1; continue; }
    const out = normalize(cur);
    if (out === null) { unknown.push(`${r.accidentNumber || r._id}: «${cur}»`); continue; }
    if (out === cur) { same += 1; continue; }
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { reportedViaAr: out } } } });
  }

  if (!DRY && ops.length) await VehicleClaim.bulkWrite(ops, { ordered: false });

  console.log(`${DRY ? 'ستُحوَّل' : 'حُوِّلت'}: ${ops.length}`);
  console.log(`عليها الصيغةُ الصحيحة سلفًا: ${same}`);
  console.log(`فارغة (تُترك): ${blank}`);
  if (unknown.length) { console.log(`\nقيمٌ لم أعرفها — تُترك كما هي (${unknown.length}):`); for (const u of unknown) console.log('    ' + u); }

  const after = await VehicleClaim.aggregate([{ $group: { _id: '$reportedViaAr', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
  console.log('\nالسجلُّ الآن:');
  for (const a of after) console.log(`  ${String(a.n).padStart(4)}  ${a._id || '(فارغ)'}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
