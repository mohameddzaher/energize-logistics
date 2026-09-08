require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const hrm = require('../controllers/hrMasterController');
  try { require('../utils/ttlCache').clear('hrm:'); } catch (_) {}
  const run = () => new Promise((r) => {
    const t = Date.now();
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { r({ ms: Date.now() - t, code: this.statusCode, body: b }); } };
    hrm.overview({ query: {}, params: {}, user: { role: 'super_admin' } }, res).catch((e) => r({ code: 500, body: { err: e.message, stack: e.stack } }));
  });
  const a = await run();
  if (a.code !== 200) { console.log('خطأ:', a.body.err, '\n', a.body.stack); process.exit(1); }
  console.log(`overview: ${a.ms}ms · حالة ${a.code}`);
  console.log('totals:', JSON.stringify(a.body.totals));
  console.log('\nالمجموعات:');
  (a.body.groups || []).forEach((g) => console.log(`   ${String(g.ar).padEnd(28)} required=${String(g.required).padStart(4)}  needsAttention=${g.needsAttention ?? '—'}`));
  const out = '/tmp/hr-overview-new.json';
  fs.writeFileSync(out, JSON.stringify(a.body, null, 1));
  console.log(`\nحُفظ في ${out}`);
  await mongoose.disconnect();
})();
