/**
 * restoreHrBackup: roll back from the rebuildHrFromMaster backup.
 * Usage: node src/scripts/restoreHrBackup.js backups/hr-rebuild-<timestamp>
 * Restores only documents that do not exist now, so it is safe to run twice and does not overwrite anything created after the backup.
 * The backup was written with JSON.stringify, so ObjectIds and dates became strings. Restore converts them back by shape: 24 hex characters = id, ISO format = date. Without this, references stay strings and mongoose cannot resolve them.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const COLLECTIONS = {
  Employee: 'employees', LeaveRequest: 'leaverequests', EmployeeDocument: 'employeedocuments',
  EmployeeRenewal: 'employeerenewals', HRRequest: 'hrrequests', Contract: 'contracts',
};

const isOid = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(v);

/** Walks the whole document and converts strings back to their types. */
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = revive(v[k]);
    return v;
  }
  if (isOid(v)) return new mongoose.Types.ObjectId(v);
  if (isIso(v)) return new Date(v);
  return v;
}

(async () => {
  const dir = path.resolve(process.argv[2] || '');
  if (!dir || !fs.existsSync(dir)) { console.error('محتاج مسار النسخة الاحتياطية'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`الرجوع من: ${dir}\n`);

  for (const [model, coll] of Object.entries(COLLECTIONS)) {
    const file = path.join(dir, `${model}.json`);
    if (!fs.existsSync(file)) continue;
    const docs = JSON.parse(fs.readFileSync(file, 'utf8')).map(revive);
    if (!docs.length) { console.log(`${model.padEnd(20)} 0`); continue; }
    const db = mongoose.connection.db.collection(coll);
    const have = new Set((await db.find({}, { projection: { _id: 1 } }).toArray()).map((x) => String(x._id)));
    const add = docs.filter((d) => !have.has(String(d._id)));
    if (add.length) await db.insertMany(add, { ordered: false });
    console.log(`${model.padEnd(20)} رجع ${add.length} · كان موجود ${docs.length - add.length}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
