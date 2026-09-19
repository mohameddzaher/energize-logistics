/**
 * يعيد اشتقاقَ ما يُشتقّ من كلّ مركبة (plateKey، missingItems) من حالها الآن
 * في السجلّ — لا من الشيت — ثمّ يعيد عدَّ حوادثها. تشغيلٌ تجريبيّ افتراضًا؛
 * `--apply` للكتابة. راجع deriveVehicle في models/VehicleMaster.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { VehicleMaster } = require('../models/VehicleMaster');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const apply = process.argv.includes('--apply');
  const VehicleClaim = require('../models/VehicleClaim');
  const all = await VehicleMaster.find({}).lean();
  let keyFix = 0; let missFix = 0; let accFix = 0;
  for (const v of all) {
    const set = VehicleMaster.deriveVehicle(v);
    if (set.plateKey) { keyFix++; console.log('plateKey', v.plateNumber, `«${v.plateKey}» → «${set.plateKey}»`); }
    if (set.missingItems) {
      missFix++;
      const f = (a) => (a || []).map((m) => `${m.item}:${m.reason}`).join('، ') || '—';
      console.log('missing', v.plateNumber, f(v.missingItems), '→', f(set.missingItems));
    }
    if (set.logistiGaps) console.log('logisti', v.plateNumber, (v.logistiGaps || []).join('، '), '→', set.logistiGaps.join('، ') || '—');
    const key = set.plateKey || v.plateKey;
    if (key) {
      const n = await VehicleClaim.countDocuments({ vehiclePlateKey: key, isActive: true });
      if (n !== (v.accidentCount || 0)) { accFix++; set.accidentCount = n; console.log('accidents', v.plateNumber, v.accidentCount || 0, '→', n); }
    }
    if (apply && Object.keys(set).length) await VehicleMaster.updateOne({ _id: v._id }, { $set: set });
  }
  console.log({ vehicles: all.length, keyFix, missFix, accFix, applied: apply });
  process.exit(0);
})();
