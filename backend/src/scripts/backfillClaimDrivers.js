/**
 * ملءُ «مَن كان يقود» في المطالبات القائمة.
 *
 *   node src/scripts/backfillClaimDrivers.js            # تقرير
 *   node src/scripts/backfillClaimDrivers.js --write    # يكتب
 *
 * الخانةُ جديدة، والمطالباتُ الستُّ والعشرون سُجِّلت قبلها. والسائقُ معروفٌ من
 * سجلَّين: مَن يركب المركبةَ في قسم النقل الخفيف، أو مَن هي مفوَّضةٌ له. فيُملأ
 * منهما، ويُترك فارغًا حيث لا يُعرَف — ولا يُخمَّن اسمٌ في سجلٍّ يُحتَجّ به.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  require('../models/VehicleMaster');
  const VehicleClaim = require('../models/VehicleClaim');
  const { suggestDriver } = require('../controllers/vehicleRegistryController');
  const write = process.argv.includes('--write');

  const rows = await VehicleClaim.find({ isActive: { $ne: false } });
  let found = 0; const samples = [];
  for (const d of rows) {
    if (String(d.driverNameAr || '').trim()) continue;
    const before = d.driverNameAr;
    if (await suggestDriver(d)) {
      found += 1;
      if (samples.length < 8) samples.push(`${d.claimId} · ${d.vehiclePlate || '—'} → ${d.driverNameAr} (${d.driverIdNumber || 'بلا هوية'})`);
      if (write) await d.save(); else d.driverNameAr = before;
    }
  }
  console.log('مطالبات:', rows.length, '· عُرف سائقُها:', found, '· بقيت بلا سائق:', rows.length - found);
  samples.forEach((x) => console.log('   ', x));
  if (!write) console.log('\n(تقريرٌ فقط — أضِف --write)');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
