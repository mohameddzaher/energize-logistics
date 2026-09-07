require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { FleetDriver, FleetVehicle } = require('../models/FleetModels');
  const agg = await FleetDriver.aggregate([
    { $match: { isActive: { $ne: false }, vehicle: { $ne: null } } },
    { $group: { _id: '$vehicle', n: { $sum: 1 }, names: { $push: '$name' } } },
    { $group: { _id: '$n', vehicles: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  console.log('عددُ السائقين على المركبة الواحدة:');
  agg.forEach((r) => console.log(`   ${r._id} سائق → ${r.vehicles} مركبة`));
  const two = await FleetDriver.aggregate([
    { $match: { isActive: { $ne: false }, vehicle: { $ne: null } } },
    { $group: { _id: '$vehicle', n: { $sum: 1 }, names: { $push: '$name' } } },
    { $match: { n: { $gte: 2 } } }, { $limit: 3 },
  ]);
  for (const t of two) {
    const v = await FleetVehicle.findById(t._id).select('plate').lean();
    console.log(`   مثال: ${v?.plate} → ${t.names.join(' · ')}`);
  }
  console.log('\n(seatDriver يمنع الثالثَ فقط — الاثنان مسموحان)');
  await mongoose.disconnect();
})();
