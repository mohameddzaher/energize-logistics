/**
 * استخدامُ المورّدين من الحمولات الفعليّة — لا من ورقةٍ شهريّة.
 *
 * ── العلّة ──────────────────────────────────────────────────────────────────
 * كان تحليلُ المورّدين ولوحةُ العقود ومؤشّراتُ المورّدين تقرأ `VendorUtilisation`:
 * صفٌّ لكلّ مورّدٍ في كلّ شهر، يُستورَد من شيت القسم أو يُكتب بيد. فتوقّف عند
 * آخر شيتٍ رُفع (مايو ٢٠٢٦) والحمولاتُ جاريةٌ بعده، وأرقامُه لا تطابق الكشوف.
 *
 * فالصفُّ نفسُه يُبنى الآن من الكشوف (`OperationsWorkflow`): كلُّ كشفٍ غيرِ
 * ملغًى حمولةٌ لمالك السيّارة في شهر تاريخه. وصفاتُ المورّد — العقدُ ونوعُه
 * وأسطولُه ومندوبُه — من سجلّ المورّدين (`ContractVendor`) الآن، لا لقطةً
 * من شهر الاستيراد: من وقّع اليوم يُقرأ موقِّعًا في كلّ الأشهر.
 *
 * ومالكٌ لا سجلَّ له في المورّدين «خارجيّ» — بلا عقدٍ ولا سجلّ — ويُعرض باسمه.
 *
 * والشكلُ هو شكلُ صفّ `VendorUtilisation` حرفًا بحرف، فلا يتغيّر مستهلكوه.
 */
const cache = require('./ttlCache');

const TTL = 60000;
const PREFIX = 'contracts:liveutil:';

async function liveUtilisationRows({ nameKey: onlyKey = null } = {}) {
  const ck = `${PREFIX}all`;
  let rows = cache.get(ck);
  if (rows === undefined) {
    const mongoose = require('mongoose');
    const { ContractVendor } = require('../models/ContractModels');
    const { nameKey } = require('../controllers/contractsController');
    const [agg, vendors] = await Promise.all([
      mongoose.connection.collection('operationsworkflows').aggregate([
        { $match: { reportDate: { $ne: null }, carOwner: { $nin: [null, ''] }, executionStatus: { $ne: 'cancelled' } } },
        { $group: {
          _id: { owner: '$carOwner', y: { $year: { date: '$reportDate', timezone: 'Asia/Riyadh' } }, m: { $month: { date: '$reportDate', timezone: 'Asia/Riyadh' } } },
          n: { $sum: 1 },
          reps: { $push: '$representativeName' },
        } },
      ], { allowDiskUse: true }).toArray(),
      ContractVendor.find({}).select('name nameKey fleetSize avgMonthlyLoadsPerVehicle monthlyCapacity vendorSideContract ourSideContract vendorType operationsRep').lean(),
    ]);
    const byKey = new Map(vendors.map((v) => [v.nameKey, v]));
    const merged = new Map();
    for (const a of agg) {
      const k = nameKey(a._id.owner);
      if (!k) continue;
      const id = `${k}|${a._id.y}|${a._id.m}`;
      if (!merged.has(id)) merged.set(id, { k, owner: a._id.owner, year: a._id.y, month: a._id.m, orders: 0, reps: {}, names: {} });
      const x = merged.get(id);
      x.orders += a.n;
      x.names[a._id.owner] = (x.names[a._id.owner] || 0) + a.n;
      for (const r of a.reps) if (r) x.reps[r] = (x.reps[r] || 0) + 1;
    }
    const top = (o) => Object.entries(o).sort((p, q) => q[1] - p[1])[0]?.[0] || '';
    rows = [...merged.values()].map((x) => {
      const v = byKey.get(x.k);
      const fleet = v?.fleetSize || 0;
      return {
        vendor: v?._id || null,
        vendorName: v?.name || top(x.names),
        nameKey: x.k,
        year: x.year,
        month: x.month,
        orders: x.orders,
        fleetSize: fleet,
        expectedMonthlyCapacity: v ? (v.monthlyCapacity || fleet * (v.avgMonthlyLoadsPerVehicle || 15)) : 0,
        hasContract: !!(v && v.vendorSideContract && v.ourSideContract),
        vendorType: v?.vendorType || '',
        operationsRep: v?.operationsRep || top(x.reps),
        isExternal: !v,
        source: 'operations',
      };
    }).sort((p, q) => (p.year - q.year) || (p.month - q.month) || (q.orders - p.orders));
    cache.set(ck, rows, TTL);
  }
  return onlyKey ? rows.filter((r) => r.nameKey === onlyKey) : rows;
}

const invalidateLiveUtilisation = () => cache.clear(PREFIX);

module.exports = { liveUtilisationRows, invalidateLiveUtilisation };
