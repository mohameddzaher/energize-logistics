require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { FleetDriver, FleetVehicle } = require('../models/FleetModels');
  const User = require('../models/User');
  const c = require('../controllers/fleetController');

  const total = await FleetDriver.countDocuments({ isActive: { $ne: false } });
  const noVeh = await FleetDriver.countDocuments({ isActive: { $ne: false }, $or: [{ vehicle: null }, { vehicle: { $exists: false } }] });
  console.log(`سائقون نشطون: ${total} · منهم بلا سيارة: ${noVeh}`);

  const run = (user) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve(b); } };
    c.listDrivers({ query: {}, params: {}, user }, res).catch((e) => resolve({ err: e.message }));
  });

  const sa = await User.findOne({ role: 'super_admin' }).select('_id role').lean();
  const sup = await User.findOne({ role: 'fleet_supervisor', isActive: { $ne: false } }).select('_id role firstName lastName').lean();
  const mgr = await User.findOne({ role: 'fleet_manager', isActive: { $ne: false } }).select('_id role firstName lastName').lean();

  for (const [label, u] of [['super_admin', sa], ['fleet_manager', mgr], ['fleet_supervisor', sup]]) {
    if (!u) { console.log(`${label}: لا مستخدم`); continue; }
    const r = await run(u);
    const list = r.drivers || [];
    const without = list.filter((d) => !d.vehicle).length;
    console.log(`${label.padEnd(18)} يرى ${String(list.length).padStart(3)} سائقًا · منهم بلا سيارة: ${without}`);
  }
  console.log('\n← لو رأى المشرفُ صفرًا بلا سيارة، فالسائقُ يختفي لحظةَ إنزاله.');
  await mongoose.disconnect();
})();
