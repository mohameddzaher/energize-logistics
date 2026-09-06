require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Od = require('../models/Ls2OdometerDaily');
  const rows = await Od.find({ date: { $gte: '2026-08-31', $lte: '2026-09-06' } })
    .select('unitId date odometerKm').sort({ unitId: 1, date: 1 }).lean();
  const byUnit = new Map();
  for (const r of rows) { if (!byUnit.has(r.unitId)) byUnit.set(r.unitId, []); byUnit.get(r.unitId).push(r); }
  let total = 0;
  for (const [, list] of byUnit) {
    for (let i = 1; i < list.length; i += 1) {
      const d = list[i].odometerKm - list[i - 1].odometerKm;
      if (d > 0 && d < 3000) total += d;
    }
  }
  console.log(`كيلومترات الأسطول كلِّه في سبتمبر حتى اليوم: ${Math.round(total).toLocaleString()} كم (${byUnit.size} مركبة)`);
  console.log('المنسوبُ إلى سائقين عبر الحمولات: 19,744 كم');
  console.log(`النسبة: ${Math.round((19744 / total) * 100)}%`);
  await mongoose.disconnect();
})();
