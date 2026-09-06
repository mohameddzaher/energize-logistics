require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const users = await User.find({ role: { $in: ['workshop_manager', 'workshop_employee'] } })
    .select('username firstName lastName role isActive').lean();
  console.log('مستخدمون بأدوار الورشة:', users.length);
  users.forEach((u) => console.log(`  ${u.username} · ${u.firstName || ''} ${u.lastName || ''} · ${u.role} · ${u.isActive ? 'نشط' : 'موقوف'}`));

  for (const [name, coll] of [['أوامر شغل', 'WorkshopTask'], ['طلبات صيانة', 'MaintenanceRequest'], ['طلبات شراء الورشة', 'WorkshopPurchaseRequest']]) {
    try {
      const M = require(`../models/${coll}`);
      const Model = M.default || (M.modelName ? M : Object.values(M)[0]);
      console.log(`${name}: ${await Model.countDocuments({})} صفًّا`);
    } catch (e) { console.log(`${name}: تعذّر العدّ — ${e.message}`); }
  }

  // صلاحياتٌ محفوظةٌ على قسم الورشة
  try {
    const P = require('../models/RolePermission');
    const rows = await P.find({ section: 'Workshop' }).lean();
    console.log('صلاحيات محفوظة على قسم الورشة:', rows.length, rows.map((r) => `${r.role}=${r.access}`).join(', '));
  } catch (e) { console.log('صلاحيات: ', e.message); }
  await mongoose.disconnect();
})();
