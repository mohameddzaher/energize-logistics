require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Od = require('../models/Ls2OdometerDaily');
  const Ls2Vehicle = require('../models/Ls2Vehicle');
  const { FleetShipment, FleetVehicle, FleetDriver } = require('../models/FleetModels');

  const total = await Od.countDocuments({});
  const days = await Od.distinct('date');
  const units = await Od.distinct('unitId');
  console.log(`قراءاتُ العدّاد: ${total} صفًّا · ${units.length} وحدة · ${days.length} يومًا`);
  console.log(`المدى: ${days.sort()[0]} → ${days[days.length - 1]}`);

  // تغطيةُ الشهر الجاري
  const m = '2026-09';
  const inMonth = await Od.distinct('unitId', { date: { $regex: `^${m}` } });
  console.log(`\nوحداتٌ لها قراءاتٌ في ${m}: ${inMonth.length}`);

  // هل تُطابَق لوحاتُ الأسطول بوحدات لوكيشن؟
  const fv = await FleetVehicle.find({}).select('plate').lean();
  const lv = await Ls2Vehicle.find({}).select('unitId plate').lean();
  const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  const lvByPlate = new Map(lv.map((v) => [norm(v.plate), v.unitId]));
  const matched = fv.filter((v) => lvByPlate.has(norm(v.plate)));
  console.log(`مركباتُ الأسطول: ${fv.length} · منها مطابَقةٌ بوحدة لوكيشن: ${matched.length}`);

  // وهل للسائقين مقاعد؟
  const drv = await FleetDriver.find({}).select('name vehicle').lean();
  console.log(`السائقون: ${drv.length} · منهم على مقعدٍ في مركبة: ${drv.filter((d) => d.vehicle).length}`);

  // حمولاتُ الشهر
  const sh = await FleetShipment.countDocuments({ loadDate: { $gte: new Date('2026-08-01'), $lt: new Date('2026-10-01') } });
  console.log(`حمولاتُ أغسطس–سبتمبر: ${sh}`);
  await mongoose.disconnect();
})();
