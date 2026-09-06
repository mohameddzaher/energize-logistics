require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/performanceController');
  const User = require('../models/User');
  const sa = await User.findOne({ role: 'super_admin' }).select('_id role').lean();

  const run = (query) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    c.getTeam({ query, params: {}, user: sa }, res).catch((e) => resolve({ code: 500, body: { err: e.message } }));
  });

  for (const s of ['Operations', 'Collections', 'Fleet Management', 'HR', 'Accounting', 'B2C', 'Customs']) {
    const r = await run({ section: s, period: '2026-M9' });
    const members = r.body.members || r.body.team || [];
    const depts = [...new Set(members.map((m) => m.department))].slice(0, 3);
    console.log(`${s.padEnd(18)} → ${String(members.length).padStart(3)} موظفًا  ${depts.join(' , ') || ''}`);
  }
  console.log('\nبلا قسم (الصفحة المركزيّة — المديرون):');
  const r = await run({ period: '2026-M9' });
  const m = r.body.members || r.body.team || [];
  console.log(`  ${m.length} — ${m.slice(0, 5).map((x) => x.name).join(' | ')}`);
  await mongoose.disconnect();
})();
