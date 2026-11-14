/* eslint-disable no-console */
// Copies every exceptional repair (Ls2Repair) into a maintenance record of its new type (preventive / roadside /
// accident, see services/ls2MaintenanceLedger REPAIR_TYPE_OF). The repair is never changed or deleted; the record
// keeps `sourceRepair`, and a unique index on it makes a second run create nothing. The repair's single cost goes to
// `unsplitCost` because it was never split into parts and labour. Dry run unless --apply; --apply writes a JSON backup
// of the repairs first.
//   node src/scripts/migrateLs2RepairsToRecords.js [--apply] [--backup-dir=./backups]
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Ls2Repair = require('../models/Ls2Repair');
const Ls2Vehicle = require('../models/Ls2Vehicle');
const { Ls2MaintenanceRecord } = require('../models/Ls2MaintenanceRecord');
const { repairType, REPAIR_CATEGORY_AR } = require('../services/ls2MaintenanceLedger');
const { dayKeyOf } = require('../utils/companyDay');

const argOf = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const STATUS_AR = { open: 'مفتوح', in_progress: 'قيد التنفيذ', done: 'منتهٍ' };

/** The record a repair becomes; exported so the test reads the same mapping. */
function recordOf(rep, vehicle) {
  const cost = r2(rep.cost);
  const notes = [
    rep.description,
    rep.partsReplaced ? `القطع المستبدلة: ${rep.partsReplaced}` : '',
    `منقول من الإصلاحات الاستثنائية (${REPAIR_CATEGORY_AR[rep.category] || rep.category} · ${STATUS_AR[rep.status] || rep.status})`,
  ].filter(Boolean).join(' · ');
  return {
    unitId: rep.unitId, plate: rep.plate || (vehicle && (vehicle.plate || vehicle.name)) || '', driver: rep.driver || '',
    type: repairType(rep.category), date: dayKeyOf(rep.repairDate || rep.createdAt), odometerKm: rep.odometerKm ?? null,
    title: rep.title || '', location: rep.workshop || '', parts: [], work: [],
    partsCost: 0, labourCost: 0, towingCost: 0, unsplitCost: cost, totalCost: cost, notes: notes.slice(0, 1000),
    sourceRepair: rep._id, repairCategory: rep.category || '',
    createdBy: rep.performedBy || null, createdByName: rep.performedByName || '',
    createdAt: rep.createdAt, updatedAt: new Date(),
  };
}

async function run({ apply = false, backupDir = path.join(__dirname, '../../backups') } = {}) {
  const [repairs, done, vehicles] = await Promise.all([
    Ls2Repair.find({}).lean(),
    Ls2MaintenanceRecord.find({ sourceRepair: { $ne: null } }).select('sourceRepair').lean(),
    Ls2Vehicle.find({}).select('unitId plate name').lean(),
  ]);
  const migrated = new Set(done.map((d) => String(d.sourceRepair)));
  const vById = new Map(vehicles.map((v) => [v.unitId, v]));
  const todo = repairs.filter((r) => !migrated.has(String(r._id)));
  const plan = todo.map((r) => recordOf(r, vById.get(r.unitId)));
  const byType = plan.reduce((a, p) => { a[p.type] = (a[p.type] || { count: 0, cost: 0 }); a[p.type].count += 1; a[p.type].cost = r2(a[p.type].cost + p.totalCost); return a; }, {});
  console.log(`repairs: ${repairs.length} · already migrated: ${migrated.size} · to migrate: ${todo.length}`);
  console.log('by type:', JSON.stringify(byType));
  if (!apply || !todo.length) { if (!apply) console.log('dry run — pass --apply to write'); return { repairs: repairs.length, migrated: migrated.size, created: 0, plan }; }

  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `ls2-repairs-before-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(repairs, null, 1));
  console.log(`backup: ${file}`);
  let created = 0;
  for (const doc of plan) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await Ls2MaintenanceRecord.collection.insertOne({ ...doc, _id: new mongoose.Types.ObjectId(), status: 'active', cancelledAt: null, cancelledByName: '', cancelReason: '', serviceLog: null, intervalId: null, intervalName: '', issueRequest: null, issueRequestNo: '' });
      created += 1;
    } catch (e) {
      if (e.code !== 11000) throw e; // a concurrent run took it
    }
  }
  console.log(`created ${created} records`);
  require('../utils/ls2Touch').clearLs2Derived();
  return { repairs: repairs.length, migrated: migrated.size, created, plan, backup: file };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    await Ls2MaintenanceRecord.createIndexes();
    await run({ apply: process.argv.includes('--apply'), backupDir: argOf('backup-dir', undefined) || path.join(__dirname, '../../backups') });
    await mongoose.disconnect();
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, recordOf };
