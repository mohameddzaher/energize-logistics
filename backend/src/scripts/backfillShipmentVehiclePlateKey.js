/**
 * Fill plateKey on the shipment orders truck register.
 * Cause: the waybill route pulled the whole register to filter three trucks, because plate is stored in display format and the comparison runs on a normalized key that was not stored. It is now stored and indexed, and derived on every save; this fills existing rows.
 * node src/scripts/backfillShipmentVehiclePlateKey.js (preview) | --write
 * Only changed rows are written, so a second run does nothing.
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const WRITE = process.argv.includes('--write');
  await mongoose.connect(process.env.MONGODB_URI);
  const V = require('../models/ShipmentOrderVehicle');
  const { registryPlateKey } = require('../utils/plateKey');

  const rows = await V.find({}).select('plate plateKey').lean();
  const ops = [];
  let already = 0, empty = 0;
  const dupes = new Map();
  for (const r of rows) {
    const key = registryPlateKey(r.plate) || '';
    if (!key) { empty += 1; continue; }
    dupes.set(key, (dupes.get(key) || 0) + 1);
    if (r.plateKey === key) { already += 1; continue; }
    ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { plateKey: key } } } });
  }
  const collide = [...dupes.entries()].filter(([, n]) => n > 1);

  console.log(`  الصفوف ............... ${rows.length}`);
  console.log(`  مفتاحُه صحيحٌ أصلًا ... ${already}`);
  console.log(`  سيُكتَب ............... ${ops.length}`);
  console.log(`  لوحةٌ لا مفتاحَ لها ... ${empty}`);
  // Two plates that normalize to one key mean two rows competing for one waybill; the script does not prevent it but reports it.
  console.log(`  مفاتيحُ مكرَّرة ....... ${collide.length}${collide.length ? '  (' + collide.slice(0, 5).map(([k, n]) => `${k}×${n}`).join(', ') + ')' : ''}`);

  if (!WRITE) { console.log('\n  معاينةٌ فقط — أضِف --write للتنفيذ.'); await mongoose.disconnect(); return; }
  if (ops.length) {
    const r = await V.bulkWrite(ops, { ordered: false });
    console.log(`\n  كُتب: ${r.modifiedCount}`);
  }
  const left = await V.countDocuments({ $or: [{ plateKey: '' }, { plateKey: null }, { plateKey: { $exists: false } }] });
  console.log(`  بلا مفتاحٍ بعد التنفيذ: ${left}`);
  await mongoose.disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
