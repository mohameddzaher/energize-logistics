require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/sectionWorkController');
  const run = (query) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve(b); } };
    c.assignees({ query, user: { role: 'super_admin' } }, res).catch((e) => resolve({ err: e.message }));
  });
  const all = await run({});
  console.log('بلا قسم (كما كان):', all.users.length, 'مستخدمًا');
  for (const s of ['operations', 'collections', 'hr', 'fleet', 'ls2', 'b2c']) {
    const r = await run({ section: s });
    console.log(`  ${s.padEnd(20)} → ${String(r.users.length).padStart(3)} — ${[...new Set(r.users.map((u) => u.role))].slice(0, 6).join(', ')}`);
  }
  await mongoose.disconnect();
})();
