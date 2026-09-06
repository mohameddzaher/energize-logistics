require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/collectionsDeptController');
  const run = (query) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    c.listParties({ query, params: {}, user: { _id: null, role: 'super_admin' } }, res).catch((e) => resolve({ code: 500, body: { err: e.message } }));
  });

  const CollectionsParty = require('../models/CollectionsParty');
  const byOfficer = await CollectionsParty.aggregate([
    { $match: { kind: 'customer', code: { $gt: '' } } },
    { $group: { _id: { $ifNull: ['$collectionOfficer', ''] }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log('حسابات العملاء حسب المسؤول (من القاعدة):');
  byOfficer.forEach((r) => console.log(`  «${r._id || '(بلا مسؤول)'}» → ${r.n}`));

  console.log('\nوما تردّه الصفحةُ عند الضغط:');
  for (const o of [...byOfficer.map((r) => r._id || 'none')]) {
    const r = await run({ kind: 'customer', officer: o, hasCode: 'true', limit: '500' });
    console.log(`  officer=${String(o).padEnd(10)} → ${r.body.total} حسابًا`);
  }
  await mongoose.disconnect();
})();
