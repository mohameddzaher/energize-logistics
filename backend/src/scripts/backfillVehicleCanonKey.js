/* eslint-disable no-console */
/**
 * backfillVehicleCanonKey — يملأ `VehicleMaster.canonKey` (المفتاحُ الموحَّد للّوحة
 * عربيّةً أو لاتينيّة) لكلّ مركبة، ويُعلن التصادمات إن وُجدت.
 *
 *   node src/scripts/backfillVehicleCanonKey.js           (عرضٌ فقط)
 *   node src/scripts/backfillVehicleCanonKey.js --apply   (يكتب)
 *
 * والحقلُ يُشتقّ بعد ذلك عند كلّ حفظ (deriveVehicle) — فهذا لِما سبق وحدَه.
 * يكتب بلا طوابع زمنيّة: ليس تعديلًا على المركبة.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { canonicalPlateKey } = require('../utils/plateKey');

const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { VehicleMaster } = require('../models/VehicleMaster');
  const rows = await VehicleMaster.find({}).select('plateNumber canonKey').lean();
  const byKey = new Map();
  let change = 0; let none = 0;
  for (const r of rows) {
    const k = canonicalPlateKey(r.plateNumber);
    if (!k) { none += 1; continue; }
    (byKey.get(k) || byKey.set(k, []).get(k)).push(r.plateNumber);
    if (k !== r.canonKey) {
      change += 1;
      if (APPLY) await VehicleMaster.collection.updateOne({ _id: r._id }, { $set: { canonKey: k } });
    }
  }
  const clashes = [...byKey.entries()].filter(([, v]) => v.length > 1);
  console.log(`${APPLY ? '── كتابة ──' : '── عرضٌ فقط ──'}`);
  console.log(`مركبات: ${rows.length} · تحتاج مفتاحًا: ${change} · بلا أرقام: ${none} · تصادمات: ${clashes.length}`);
  for (const [k, v] of clashes) console.log(`  ⚠︎ ${k}: ${v.join(' / ')}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
