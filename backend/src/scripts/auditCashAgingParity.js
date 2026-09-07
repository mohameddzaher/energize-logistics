/** يقارن التجميعَ الجديد بالحساب القديم سطرًا سطرًا — لا كتابة. */
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const CollectionsParty = require('../models/CollectionsParty');
  const OperationsWorkflow = require('../models/OperationsWorkflow');
  const { fold } = CollectionsParty;
  const startOfToday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

  const parties = await CollectionsParty.find({ kind: 'customer' }).select('_id name nameKey').lean();
  const byKey = new Map();
  for (const p of parties) { const k = p.nameKey || fold(p.name || ''); if (k) byKey.set(k, String(p._id)); }

  // الطريقةُ القديمة: تُقرأ الصفوفُ وتُجمَع في العقدة
  const rows = await OperationsWorkflow.find({
    paymentType: 'cash', collectionDate: null, cashCollectionStatus: { $ne: 'collected' }, username: { $nin: [null, ''] },
  }).select('username sellingValue reportDate paymentDate').lean();
  const today = startOfToday();
  const oldMap = new Map();
  for (const w of rows) {
    const id = byKey.get(fold(w.username || '')); if (!id) continue;
    const base = w.reportDate || w.paymentDate || null;
    const days = base ? Math.floor((today - new Date(base)) / 86400000) : null;
    const band = days === null ? 'noDate' : days >= 365 ? '1Y+' : days >= 120 ? '120+' : days >= 90 ? '90+'
      : days >= 60 ? '60+' : days >= 45 ? '60-' : days >= 30 ? '45-' : days >= 15 ? '30-' : '15-';
    if (!oldMap.has(id)) oldMap.set(id, { outstanding: 0, count: 0, bands: {} });
    const e = oldMap.get(id);
    e.outstanding += Number(w.sellingValue) || 0; e.count += 1;
    e.bands[band] = (e.bands[band] || 0) + (Number(w.sellingValue) || 0);
  }

  // الجديدة
  const led = require('../controllers/collectionsLedgerController');
  const newMap = await led.__cashAgingByParty
    ? led.__cashAgingByParty(parties)
    : null;
  if (!newMap) { console.log('الدالّةُ غيرُ مُصدَّرة — تُقارَن عبر النقطة نفسِها بدلًا من ذلك.'); }
  const nm = await newMap;

  let checked = 0, mismatch = 0;
  for (const [id, o] of oldMap) {
    const n = nm.get(id);
    checked += 1;
    if (!n) { mismatch += 1; console.log(`  ✗ ${id}: غائبٌ في الجديد`); continue; }
    if (Math.abs(n.outstanding - o.outstanding) > 0.01 || n.count !== o.count) {
      mismatch += 1;
      console.log(`  ✗ ${id}: قديم=${o.outstanding.toFixed(2)}/${o.count} جديد=${n.outstanding.toFixed(2)}/${n.count}`);
    }
    for (const [b, v] of Object.entries(o.bands)) {
      if (Math.abs((n.bands[b] || 0) - v) > 0.01) { mismatch += 1; console.log(`  ✗ ${id} شريحة ${b}: قديم=${v.toFixed(2)} جديد=${(n.bands[b] || 0).toFixed(2)}`); }
    }
  }
  console.log(`\nقُورن ${checked} طرفًا · اختلافات: ${mismatch}`);
  console.log(`أطرافٌ في الجديد وليست في القديم: ${[...nm.keys()].filter((k) => !oldMap.has(k)).length}`);
  const sumOld = [...oldMap.values()].reduce((a, x) => a + x.outstanding, 0);
  const sumNew = [...nm.values()].reduce((a, x) => a + x.outstanding, 0);
  console.log(`الإجمالي: قديم=${Math.round(sumOld).toLocaleString()} جديد=${Math.round(sumNew).toLocaleString()}`);
  await mongoose.disconnect();
})();
