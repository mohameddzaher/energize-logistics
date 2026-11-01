/* eslint-disable no-console */
// Brings shipments that came from the platform back in line with it. Reads the
// platform only, whatever UPL_DISABLED says, and leaves the link off. Rows someone
// edited here after the cutover keep our version. Customer names are left alone,
// they hold the approved spelling. Old values are saved first. Dry run unless --apply.
//   node src/scripts/resyncPlatformShipments.js [--apply] [--since=2026-10-31T20:17:00Z]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
delete process.env.UPL_DISABLED;
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
const upl = require('../services/uplClient');
const { mapShipment } = require('../services/shipmentOrderSyncService');
const ShipmentOrder = require('../models/ShipmentOrder');

const { EJSON } = mongoose.mongo.BSON;
const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const SINCE = new Date(argOf('since', '2026-10-31T20:17:00Z'));
const SKIP = new Set(['customerName', 'externalId', 'source', 'reference', 'graduationNumber']);
const same = (a, b) => {
  if (a instanceof Date || b instanceof Date) return new Date(a || 0).getTime() === new Date(b || 0).getTime();
  const blank = (v) => v === null || v === undefined || v === '';
  if (blank(a) && blank(b)) return true;
  return typeof b === 'number' ? Number(a) === b : String(a ?? '').trim() === String(b ?? '').trim();
};

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const { db } = mongoose.connection;
  const items = [];
  for (let page = 1; page < 2000; page += 1) {
    const o = await upl.get('/admin/shipments', { query: { page, limit: 100 } });
    items.push(...(o.data.items || []));
    if (!o.data.meta?.hasNextPage) break;
  }
  const live = items.filter((s) => s.id && !s.deleted_at);
  const orders = new Map((await ShipmentOrder.find({ source: 'platform' }).lean()).map((o) => [String(o.externalId), o]));
  const rows = new Map((await db.collection('operationsworkflows').find({ externalSource: 'ops_upl' }).project({ externalId: 1, applicationStatus: 1, executionStatus: 1, updatedAt: 1, driverName: 1 }).toArray()).map((w) => [String(w.externalId), w]));

  const fieldCount = {}; const orderOps = []; const rowOps = []; const saved = []; let keptOurs = 0; let rowFix = 0;
  for (const s of live) {
    const m = mapShipment(s);
    const o = orders.get(m.externalId);
    const w = rows.get(m.externalId);
    const touched = (o?.statusLog || []).some((l) => new Date(l.at) > SINCE) || (w?.updatedAt && new Date(w.updatedAt) > SINCE);
    if (touched) { keptOurs += 1; continue; }
    if (o) {
      const set = {};
      for (const [k, v] of Object.entries(m)) {
        if (SKIP.has(k) || v === undefined) continue;
        if (k === 'notes' && !String(v || '').trim()) continue;
        if (!same(o[k], v)) { set[k] = v; fieldCount[k] = (fieldCount[k] || 0) + 1; }
      }
      if (Object.keys(set).length) {
        saved.push({ col: 'shipmentorders', _id: o._id, before: Object.fromEntries(Object.keys(set).map((k) => [k, o[k] ?? null])) });
        orderOps.push({ updateOne: { filter: { _id: o._id }, update: { $set: set } } });
      }
    }
    if (w && String(s.status) !== String(w.applicationStatus)) {
      rowFix += 1;
      saved.push({ col: 'operationsworkflows', _id: w._id, before: { applicationStatus: w.applicationStatus, executionStatus: w.executionStatus } });
      rowOps.push({ updateOne: { filter: { _id: w._id }, update: { $set: { applicationStatus: s.status, executionStatus: s.status } } } });
    }
  }
  console.log({ platform: live.length, keptOurs, ordersToFix: orderOps.length, rowsToFix: rowFix });
  console.log('fields', JSON.stringify(Object.entries(fieldCount).sort((a, b) => b[1] - a[1])));
  if (!apply) { console.log('dry run: nothing written'); await mongoose.disconnect(); return; }
  const file = path.join(argOf('backup-dir', '/opt/energize/archive'), `platform-resync-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify(saved)), { mode: 0o600 });
  console.log(`backup ${file}`);
  for (let i = 0; i < orderOps.length; i += 1000) await ShipmentOrder.collection.bulkWrite(orderOps.slice(i, i + 1000), { ordered: false });
  for (let i = 0; i < rowOps.length; i += 1000) await db.collection('operationsworkflows').bulkWrite(rowOps.slice(i, i + 1000), { ordered: false });
  console.log(`done: ${orderOps.length} shipments, ${rowOps.length} workflow rows`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
