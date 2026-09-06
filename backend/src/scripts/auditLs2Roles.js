require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const User = require('../models/User');
  const rows = await User.find({ role: { $in: ['location_manager', 'location_staff'] } })
    .select('firstName lastName email role isActive lastLogin').lean();
  console.log('مَن يحمل أدوارَ لوكيشن سوليوشن اليوم:', rows.length);
  rows.forEach((u) => console.log(`  ${u.firstName} ${u.lastName} · ${u.email} · ${u.role} · ${u.isActive === false ? 'موقوف' : 'نشط'}`));
  await mongoose.disconnect();
})();
