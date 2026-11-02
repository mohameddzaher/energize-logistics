/**
 * backfillClaimDrivers: fill "who was driving" on existing claims.
 * Usage: node src/scripts/backfillClaimDrivers.js (report) | --write
 * The field is new and the 26 claims predate it. The driver is known from two registers: who rides the vehicle in light transport, or who it is authorized to. It is filled from them and left empty where unknown; a name is never guessed in a record used as evidence.
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
