require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/collectionsDeptController');
  const CollectionsParty = require('../models/CollectionsParty');
  const run = (id) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    c.getPartyProfile({ params: { id }, query: {}, user: { _id: null, role: 'super_admin' } }, res).catch((e) => resolve({ code: 500, body: { err: e.message, stack: e.stack } }));
  });
  for (const n of ['Branch of Arctech Investment HK Ltd', 'شركة ابازا', 'روابي التسويق العالمية']) {
    const p = await CollectionsParty.findOne({ kind: 'customer', name: n }).select('_id name').lean();
    if (!p) { console.log(`«${n}» → لا ملفّ`); continue; }
    const r = await run(String(p._id));
    if (r.code !== 200) { console.log(`«${n}» → خطأ: ${r.body.err}`); continue; }
    const m = r.body.money.totals;
    console.log(`«${n}»`);
    console.log(`   فواتير: ${m.count} · مفوتر: ${m.invoiced.toLocaleString()} · محصَّل: ${m.collected.toLocaleString()} · باقٍ: ${m.outstanding.toLocaleString()} (${m.openCount} فاتورة، أقدمها ${m.oldestOpenDays} يومًا)`);
    console.log(`   كشوف التشغيل في الملفّ: ${r.body.reportsTotal}`);
  }
  await mongoose.disconnect();
})();
