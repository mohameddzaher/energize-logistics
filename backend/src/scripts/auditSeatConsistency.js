require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { FleetDriver, FleetVehicle, FleetShipment } = require('../models/FleetModels');
  const c = require('../controllers/fleetController');

  const run = (user) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve(b); } };
    c.listVehicles({ query: {}, params: {}, user }, res).catch((e) => resolve({ err: e.message }));
  });
  const User = require('../models/User');
  const sa = await User.findOne({ role: 'super_admin' }).select('_id role').lean();
  const r = await run(sa);
  const vehicles = r.vehicles || [];

  // هل يذكر لوحُ مركبةٍ سائقًا لا تشير سيّارتُه إليها؟
  const drivers = await FleetDriver.find({ isActive: { $ne: false } }).select('name vehicle').lean();
  const vehOf = new Map(drivers.map((d) => [String(d._id), String(d.vehicle || '')]));
  let bad = 0;
  for (const v of vehicles) {
    for (const d of (v.drivers || [])) {
      if (vehOf.get(String(d._id)) !== String(v._id)) {
        bad += 1;
        console.log(`  ✗ ${v.plate} يذكر «${d.name}» وسيّارتُه الآن: ${vehOf.get(String(d._id)) || '(بلا)'}`);
      }
    }
  }
  console.log(`مركبات: ${vehicles.length} · مقاعدُ لا تطابق سجلَّ السائق: ${bad}`);

  // ولقطاتُ الحمولات تحمل أسماءَ سائقين — وهي تاريخٌ لا مقعدٌ حاليّ
  const withDrv = await FleetShipment.countDocuments({ driverName: { $nin: [null, ''] } });
  console.log(`لقطاتُ الحمولات التي تحمل اسمَ سائق: ${withDrv} (تاريخٌ، لا تُقرأ كمقعد)`);
  await mongoose.disconnect();
})();
