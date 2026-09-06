require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const c = require('../controllers/fleetController');
  const run = (query) => new Promise((resolve) => {
    const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    c.getDriverKpis({ query, user: { _id: null, role: 'super_admin' } }, res).catch((e) => resolve({ code: 500, body: { err: e.message, stack: e.stack } }));
  });
  const r = await run({ month: '2026-09' });
  if (r.code !== 200) { console.log('خطأ:', r.body.err, '\n', r.body.stack); process.exit(1); }
  const s = r.body.summary;
  console.log(`سائقون: ${s.drivers} · حقّقوا: ${s.driversAchieved} · دونه: ${s.driversBelow} · بلا هدف: ${s.driversNoTarget}`);
  console.log(`الهدف الافتراضي: ${s.defaultDriverMonthlyLoads} حمولة · ${s.defaultDriverMonthlyKm} كم`);
  console.log(`منسوبٌ لسائقين: ${s.kmAttributed.toLocaleString()} كم · بلا نسبة: ${s.kmUnattributed.toLocaleString()} كم · حمولات: ${s.totalTrips}`);
  console.log(`التغطية: ${Math.round((s.kmAttributed / (s.kmAttributed + s.kmUnattributed)) * 100)}%\n`);
  console.log('أعلى ١٠ بالمسافة:');
  [...r.body.items].sort((a, b) => b.km - a.km).slice(0, 10).forEach((i) => {
    console.log(`  ${String(i.name).padEnd(28)} حمولات ${String(i.trips).padStart(2)}/${i.targetLoads}  كم ${String(i.km).padStart(6)}/${i.targetKm} (منها ${i.kmFromLoads} بحمولة)  تحقيق ${i.targetPct ?? '—'}%  ${i.achieved === true ? '✓' : i.achieved === false ? '✕' : '—'}`);
  });
  await mongoose.disconnect();
})();
