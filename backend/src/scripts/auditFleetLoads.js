require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const { FleetShipment } = require('../models/FleetModels');
  console.log('إجمالي الحمولات:', await FleetShipment.countDocuments({}));
  console.log('بلا loadDate:', await FleetShipment.countDocuments({ $or: [{ loadDate: null }, { loadDate: { $exists: false } }] }));
  const byMonth = await FleetShipment.aggregate([
    { $group: { _id: { $dateToString: { date: { $ifNull: ['$loadDate', '$createdAt'] }, format: '%Y-%m', timezone: 'Asia/Riyadh' } }, n: { $sum: 1 } } },
    { $sort: { _id: -1 } }, { $limit: 8 },
  ]);
  console.log('\nبالشهر (loadDate أو createdAt):');
  byMonth.forEach((r) => console.log(`  ${r._id}: ${r.n}`));
  const withPlate = await FleetShipment.countDocuments({ vehiclePlate: { $nin: [null, ''] } });
  const withDriver = await FleetShipment.countDocuments({ driverName: { $nin: [null, ''] } });
  console.log(`\nعليها لوحة: ${withPlate} · عليها سائق: ${withDriver}`);
  await mongoose.disconnect();
})();
