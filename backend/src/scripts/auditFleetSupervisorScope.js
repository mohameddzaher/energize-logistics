/** المشرفُ يرى الكلَّ ولا يكتب إلّا في سياراته. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const { FleetVehicle } = require('../models/FleetModels');
  const User = require('../models/User');
  const fleet = require('../controllers/fleetController');

  const sup = await User.findOne({ role: 'fleet_supervisor', isActive: { $ne: false } }).lean();
  if (!sup) { console.log('لا مشرفَ أسطولٍ للاختبار'); process.exit(0); }
  const total = await FleetVehicle.countDocuments({});
  const mine = await FleetVehicle.countDocuments({ supervisor: sup._id });
  const others = await FleetVehicle.findOne({ supervisor: { $nin: [sup._id, null] } }).lean();
  console.log(`\n  المشرف: ${sup.firstName} ${sup.lastName}`);
  console.log(`  سياراتُ الأسطول: ${total} · سياراتُه: ${mine}\n`);

  const call = (fn, req) => new Promise((r) => {
    const res = { statusCode: 200, status(s){this.statusCode=s;return this;}, json(b){ r({code:this.statusCode, body:b}); } };
    fn({ query:{}, params:{}, body:{}, ip:'', user: sup, ...req }, res).catch((e)=>r({code:500,body:{err:e.message}}));
  });

  const list = await call(fleet.listVehicles, {});
  const seen = (list.body?.vehicles || []).length;
  console.log(`  القراءة — قائمة السيارات: يرى ${seen} من ${total}  ${seen >= total ? '✓ الكلّ' : '✗ محجوب'}`);
  const withNames = (list.body?.vehicles || []).filter((v) => v.supervisorName).length;
  console.log(`             وفيها اسمُ المشرف على ${withNames} سيارة ${withNames ? '✓ يُعرَف صاحبُ كلٍّ' : '(لا أسماء مُسنَدة)'}`);

  const dash = await call(fleet.getDashboard, {});
  console.log(`  القراءة — اللوحة: ${dash.code === 200 ? '✓ فُتحت' : '✗ ' + dash.code}`);

  if (others) {
    const w = await call(fleet.createVehicleLog, { body: { vehicle: String(others._id), date: '2027-01-01', note: 'اختبار' } });
    const blocked = w.code === 403;
    console.log(`\n  الكتابة — سجلُّ سيارةِ مشرفٍ آخر (${others.plate}): ${w.code} ${blocked ? '✓ مُنعت' : '✗ نفذت!'}`);
    if (!blocked && w.body?.log?._id) {
      const Log = require('../models/FleetVehicleLog');
      await Log.deleteOne({ _id: w.body.log._id });
      console.log('    (حُذف ما كُتب بالخطأ)');
    }
  } else console.log('\n  (لا سيارةَ مُسنَدةٌ لمشرفٍ آخر لاختبار الكتابة)');
  console.log('');
  await mongoose.disconnect();
})();
