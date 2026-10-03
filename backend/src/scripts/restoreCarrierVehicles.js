/**
 * إرجاعُ شاحنات الناقلين التي أُوقفت بغير حقّ.
 *
 * ── ما حدث ─────────────────────────────────────────────────────────────────
 * استيرادُ الناقلين من منصّة الأوبريشن نسخ حالةَ المنصّة كما هي
 * (`active` و`deleted_at`)، فأُوقفت سبعُمئةٍ وأربعٌ وخمسون شاحنة. ثمّ قيست:
 *
 *   • سبعُمئةٍ وأربعون منها حملت لنا ألفين ومئتين وتسعًا وستّين شحنة.
 *   • خمسُمئةٍ وأربعٌ وعشرون منها عملت في آخر ستّة أشهر.
 *   • وبعضُها حمل في اليوم نفسِه الذي أُوقفت فيه.
 *
 * فحالةُ المنصّة ليست خبرًا عن وجود الشاحنة: تُعلَّم فيها المركبةُ محذوفةً
 * لأسبابها هي، والشاحنةُ تسير وتُحمَّل عندنا.
 *
 * ── وما يبقى موقوفًا ───────────────────────────────────────────────────────
 * واحدٌ وخمسون صفًّا لها نسخةٌ أخرى نشطةٌ بنفس اللوحة: هذه صفوفٌ مكرّرةٌ
 * وإيقافُها صوابٌ — لوحةٌ واحدةٌ في صفّين تعني سجلَّين لشاحنةٍ واحدة، ولكلٍّ
 * سائقُه وتاريخُه، ولا يعرف أحدٌ أيُّهما الشاحنة.
 *
 * الاستعمال:  node src/scripts/restoreCarrierVehicles.js [--apply]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ShipmentOrderVehicle = require(`${ROOT}/models/ShipmentOrderVehicle`);
const ShipmentOrder = require(`${ROOT}/models/ShipmentOrder`);
const { registryPlateKey } = require(`${ROOT}/utils/plateKey`);

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const all = await ShipmentOrderVehicle.find({}).select('plate isActive').lean();
  const byKey = new Map();
  for (const v of all) {
    const k = registryPlateKey(v.plate);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(v);
  }

  const off = all.filter((v) => v.isActive === false);
  const restore = [];
  const keepOff = [];
  for (const v of off) {
    const k = registryPlateKey(v.plate);
    const twinAlive = (byKey.get(k) || []).some((x) => String(x._id) !== String(v._id) && x.isActive !== false);
    (twinAlive ? keepOff : restore).push(v);
  }

  // وكم منها عمل لنا فعلًا — تُقاس باللوحة لا بالمرجع: طلباتُنا تحمل اللوحةَ
  // لقطةً، ومرجعُ الشاحنة لم يكن يُكتب فيها قبل هذا الأسبوع.
  const worked = await ShipmentOrder.aggregate([
    { $match: { vehiclePlate: { $nin: ['', null] } } },
    { $group: { _id: '$vehiclePlate', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
  ]);
  const workedKeys = new Map();
  for (const w of worked) {
    const k = registryPlateKey(w._id);
    if (!k) continue;
    const prev = workedKeys.get(k);
    workedKeys.set(k, { n: (prev?.n || 0) + w.n, last: prev && prev.last > w.last ? prev.last : w.last });
  }
  const cut = Date.now() - 180 * 86400000;
  const did = restore.filter((v) => workedKeys.has(registryPlateKey(v.plate)));
  const recent = did.filter((v) => new Date(workedKeys.get(registryPlateKey(v.plate)).last).getTime() > cut);

  console.log(`الموقوفة: ${off.length}`);
  console.log(`   تُرجَع (النسخةُ الوحيدة للوحتها): ${restore.length}`);
  console.log(`      منها حملت لنا فعلًا: ${did.length} · وفي آخر ٦ أشهر: ${recent.length}`);
  console.log(`   تبقى موقوفةً (لها نسخةٌ نشطةٌ بنفس اللوحة): ${keepOff.length}`);

  if (APPLY && restore.length) {
    const ids = restore.map((v) => v._id);
    for (let i = 0; i < ids.length; i += 500) {
      // eslint-disable-next-line no-await-in-loop
      await ShipmentOrderVehicle.updateMany({ _id: { $in: ids.slice(i, i + 500) } }, { $set: { isActive: true } });
    }
    const live = await ShipmentOrderVehicle.countDocuments({ isActive: { $ne: false } });
    console.log(`\nأُرجعت. شاحناتُ الناقلين النشطةُ الآن: ${live}`);
  } else {
    console.log('\n(عرضٌ فقط — أضِف --apply)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
