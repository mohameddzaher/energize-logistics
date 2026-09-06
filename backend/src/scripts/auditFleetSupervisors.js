require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const { FleetVehicle } = require('../models/FleetModels');
  const sups = await User.find({ role: { $in: ['fleet_supervisor', 'fleet_manager'] }, isActive: { $ne: false } })
    .select('firstName lastName role').lean();
  const total = await FleetVehicle.countDocuments({});
  console.log('مركبات الأسطول:', total);
  for (const u of sups) {
    const n = await FleetVehicle.countDocuments({ supervisor: u._id });
    console.log(`  ${u.firstName} ${u.lastName} · ${u.role} · مُسند إليه: ${n}`);
  }
  console.log('غير مُسند:', await FleetVehicle.countDocuments({ $or: [{ supervisor: null }, { supervisor: { $exists: false } }] }));
  await mongoose.disconnect();
})();
