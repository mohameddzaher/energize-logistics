/**
 * One customer list for shipment orders and the fleet (utils/customerSync): links every fleet customer to its shipment
 * customer, adds fleet-only companies to shipment orders, and gives every shipment customer a fleet row.
 * Dry run by default (counts only); `--apply` writes after backing up both collections to /opt/energize/backups.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const apply = process.argv.includes('--apply');
  const db = mongoose.connection.db;
  const before = {
    shipment: await db.collection('shipmentordercustomers').countDocuments(),
    fleet: await db.collection('fleetcustomers').countDocuments(),
    linked: await db.collection('fleetcustomers').countDocuments({ shipmentCustomer: { $type: 'objectId' } }),
  };
  console.log('before', before);
  if (!apply) { console.log('dry run — pass --apply to write'); process.exit(0); }
  const dir = '/opt/energize/backups';
  const stamp = Date.now();
  for (const c of ['shipmentordercustomers', 'fleetcustomers']) {
    const rows = await db.collection(c).find({}).toArray();
    fs.writeFileSync(`${dir}/${c}-before-customer-sync-${stamp}.json`, JSON.stringify(rows));
  }
  console.log('backup', `${dir}/*-before-customer-sync-${stamp}.json`);
  await require('../models/FleetModels').FleetCustomer.syncIndexes();
  const r = await require('../utils/customerSync').syncAll({ force: true });
  const after = {
    shipment: await db.collection('shipmentordercustomers').countDocuments(),
    fleet: await db.collection('fleetcustomers').countDocuments(),
    linked: await db.collection('fleetcustomers').countDocuments({ shipmentCustomer: { $type: 'objectId' } }),
  };
  console.log('result', r, 'after', after);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
