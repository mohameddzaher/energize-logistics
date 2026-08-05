/**
 * restoreHrBackup — رجوع من نسخة rebuildHrFromMaster الاحتياطية.
 *
 *   node src/scripts/restoreHrBackup.js backups/hr-rebuild-2026-08-05T10-25-47
 *
 * بيرجّع المستندات اللي مش موجودة دلوقتي بس — فآمن لو اتنفّذ مرتين، ومش
 * بيدوس على أي حاجة اتعملت بعد النسخة.
 *
 * النسخة اتكتبت بـ JSON.stringify، فالـ ObjectId والتواريخ بقوا نصوص. الرجوع
 * بيحوّلهم تاني حسب الشكل: ٢٤ خانة hex = معرّف، وصيغة ISO = تاريخ. من غير
 * التحويل ده الروابط بتفضل نصوص وmongoose مش بيلاقيها.
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

/** بيمشي على المستند كله ويرجّع النصوص لأنواعها. */
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
