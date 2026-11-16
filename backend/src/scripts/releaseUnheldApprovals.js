/**
 * One-time: requests that waited for the sales manager under the old rule (every rep's request) while their customer is not on «وقف طلبات».
 * Under the new rule they would never have waited, so they are approved and announced to the vendors team.
 * Dry run by default; `--apply` writes. Each released request gets an `approved` log entry naming this release.
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const ShipmentRequest = require('../models/ShipmentRequest');
  const ShipmentOrderCustomer = require('../models/ShipmentOrderCustomer');
  const waiting = await ShipmentRequest.find({ approvalStatus: 'pending', status: { $in: ['pending', 'in_progress'] } })
    .select('number customer customerName createdByName').lean();
  const held = new Set((await ShipmentOrderCustomer.find({ _id: { $in: waiting.map((r) => r.customer).filter(Boolean) }, ordersHold: true }).select('_id').lean()).map((c) => String(c._id)));
  const release = waiting.filter((r) => !held.has(String(r.customer)));
  console.log(`waiting: ${waiting.length} · customer on hold (stay): ${waiting.length - release.length} · to release: ${release.length}`);
  for (const r of release) console.log(`  #${r.number}  ${r.customerName}  (${r.createdByName})`);
  if (apply && release.length) {
    const res = await ShipmentRequest.updateMany({ _id: { $in: release.map((r) => r._id) }, approvalStatus: 'pending' }, {
      $set: { approvalStatus: 'approved' },
      $push: { log: { action: 'approved', byName: 'النظام', note: 'أُلغي اعتمادُ الطلبات إلّا للعملاء الموقوفة طلباتهم', at: new Date() } },
    });
    console.log(`released: ${res.modifiedCount}`);
    try { require('../utils/ttlCache').clear('so:analytics:'); } catch (_) { /* */ }
  } else if (!apply) console.log('dry run — pass --apply to release');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
