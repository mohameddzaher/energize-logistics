/**
 * Vendor utilisation from actual loads, not a monthly sheet.
 * Vendor analysis, the contracts dashboard and vendor KPIs used to read `VendorUtilisation` (a row per vendor per month, imported or hand-entered), which stopped at the last uploaded sheet and no longer matched the manifests.
 * The row is now built from the manifests (`OperationsWorkflow`): each non-cancelled manifest is a load for the vehicle owner in the month of its date. Vendor attributes (contract, type, fleet, rep) come from the vendor register (`ContractVendor`) now, not a snapshot of the import month. An owner with no vendor record is 'external': no contract, shown by name.
 * The shape matches a `VendorUtilisation` row exactly, so consumers are unchanged.
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

/**
 * Load totals per month, only what the contracts dashboard needs, without vendor rows.
 * Matches `liveUtilisationRows` summed by month, but omits owner names: that aggregation returned about 690 KB and cluster transfer was the whole cost.
 * The only difference is an owner whose name folds to empty (`nameKey`), which is dropped. A name folds to empty only if it has no letter or digit, or contains '_' (the article rule applies only after a Latin letter, digit or '_'), so just those few names are fetched, folded with the same function and subtracted from the month.
 */
async function liveUtilisationMonths() {
  const mongoose = require('mongoose');
  const { nameKey } = require('../controllers/contractsController');
  const coll = mongoose.connection.collection('operationsworkflows');
  const match = { reportDate: { $ne: null }, carOwner: { $nin: [null, ''] }, executionStatus: { $ne: 'cancelled' } };
  const ym = { y: { $year: { date: '$reportDate', timezone: 'Asia/Riyadh' } }, m: { $month: { date: '$reportDate', timezone: 'Asia/Riyadh' } } };
  const [totals, suspects] = await Promise.all([
    coll.aggregate([{ $match: match }, { $group: { _id: ym, n: { $sum: 1 } } }]).toArray(),
    coll.aggregate([
      { $match: { $and: [match, { $or: [{ carOwner: { $not: /[A-Za-z0-9؀-ۿ]/ } }, { carOwner: /_/ }] }] } },
      { $group: { _id: { owner: '$carOwner', ...ym }, n: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const byMonth = new Map(totals.map((t) => [`${t._id.y}-${t._id.m}`, { year: t._id.y, month: t._id.m, orders: t.n }]));
  for (const s of suspects) {
    if (nameKey(s._id.owner)) continue;
    const e = byMonth.get(`${s._id.y}-${s._id.m}`);
    if (e) e.orders -= s.n;
  }
  // A month whose manifests all belong to nameless owners has no row there, so it is not shown here.
  return [...byMonth.values()].filter((e) => e.orders > 0)
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));
}

const invalidateLiveUtilisation = () => cache.clear(PREFIX);

module.exports = { liveUtilisationRows, liveUtilisationMonths, invalidateLiveUtilisation };
