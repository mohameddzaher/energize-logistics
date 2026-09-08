/** أرقامُ الشريط مقابلَ أرقام الصفحات والتنبيهات. لا يكتب شيئًا. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const hrm = require('../controllers/hrMasterController');
  const user = { _id: null, role: 'super_admin' };
  const call = (fn, query = {}, params = {}) => new Promise((resolve) => {
    const t = Date.now();
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ ms: Date.now() - t, code: this.statusCode, body: b }); } };
    fn({ query, params, user }, res).catch((e) => resolve({ ms: Date.now() - t, code: 500, body: { err: e.message, stack: e.stack } }));
  });

  const ov = await call(hrm.overview, {});
  console.log(`overview: ${ov.ms}ms · حالة ${ov.code}`);
  if (ov.code !== 200) { console.log(ov.body.err); process.exit(1); }
  console.log(`totals: ${JSON.stringify(ov.body.totals)}\n`);
  console.log('المجموعاتُ كما يعرضها الشريط (required = بيانات ناقصة):');
  (ov.body.groups || []).forEach((g) => console.log(`   ${String(g.ar).padEnd(28)} key=${String(g.key).padEnd(14)} required=${g.required}`));

  // صفحةُ مجموعةٍ بعينها: كم صفًّا فيها فعلًا؟
  for (const key of ['iqama', 'passport', 'contract']) {
    const g = await call(hrm.records, {}, { group: key });
    if (g.code !== 200) { console.log(`\ngroup ${key}: خطأ ${g.body.err}`); continue; }
    const b = g.body;
    console.log(`\ngroup «${key}» (${g.ms}ms): ${JSON.stringify(Object.keys(b))}`);
    if (b.rows) console.log(`   صفوف=${b.rows.length} · إجمالي=${b.total ?? '—'}`);
    if (b.counts) console.log(`   counts=${JSON.stringify(b.counts)}`);
  }
  const ex = await call(hrm.expiring, {});
  const rows = ex.body.rows || ex.body.items || [];
  console.log(`\nexpiring (${ex.ms}ms): ${rows.length} صفًّا · totals=${JSON.stringify(ex.body.totals || {})}`);
  const byG = {};
  rows.forEach((r) => { byG[r.group || r.groupKey || '—'] = (byG[r.group || r.groupKey || '—'] || 0) + 1; });
  console.log('   حسب المجموعة:', JSON.stringify(byG));
  await mongoose.disconnect();
})();
